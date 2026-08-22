/**
 * Bounded request controls around the public surface.
 *
 * The endpoint under real pressure is `/settle`: it spends sponsored XLM by
 * reaching submission, whether or not the transaction succeeds. Everything here
 * exists to make that spend a budget instead of an open tap, so the tests are
 * written around what an abuser would actually try — burst, oversize, spoof the
 * client address, and flood concurrently.
 *
 * Limits are injected through config rather than hard-coded in the app, so the
 * cases are deterministic and fast. The production values live in `limits.ts`
 * and are asserted separately.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { SqliteCatalogStore } from "@stellar-bazaar/catalog";
import { STELLAR_TESTNET_CAIP2 } from "@x402/stellar";
import { afterEach, describe, expect, it } from "vitest";
import { buildFacilitator, type BuiltFacilitator } from "../src/app.js";
import type { FacilitatorConfig } from "../src/config.js";
import {
  DEFAULT_RATE_POLICY,
  DEFAULT_SETTLE_MAX_INFLIGHT,
  RateLimiter,
  classify,
  clientBucket,
  parseTrustProxy,
} from "../src/limits.js";

const NETWORK = STELLAR_TESTNET_CAIP2;
const built: BuiltFacilitator[] = [];

afterEach(async () => {
  await Promise.all(built.splice(0).map((b) => b.app.close()));
});

function make(overrides: Partial<FacilitatorConfig> = {}): BuiltFacilitator {
  const config: FacilitatorConfig = {
    port: 0,
    network: NETWORK,
    signerSecrets: [Keypair.random().secret()],
    rpcUrl: "https://soroban-testnet.stellar.org",
    areFeesSponsored: true,
    catalogPath: ":memory:",
    ...overrides,
  };
  const app = buildFacilitator(config, new SqliteCatalogStore(":memory:"));
  built.push(app);
  return app;
}

/** Tight limits so a burst is a handful of requests rather than hundreds. */
const TIGHT = {
  settle: { limit: 2, windowMs: 60_000 },
  verify: { limit: 3, windowMs: 60_000 },
  search: { limit: 2, windowMs: 60_000 },
  resources: { limit: 4, windowMs: 60_000 },
};

describe("route classification", () => {
  it("prices routes by what they cost us, and exempts the rest", () => {
    expect(classify("POST", "/settle")).toBe("settle");
    expect(classify("POST", "/verify")).toBe("verify");
    expect(classify("GET", "/discovery/search?query=x")).toBe("search");
    expect(classify("GET", "/discovery/resources?limit=1")).toBe("resources");
    // A health check that gets 429'd looks like an outage.
    expect(classify("GET", "/health")).toBe("exempt");
    expect(classify("GET", "/supported")).toBe("exempt");
    // Method matters: a GET to /settle is not a settlement.
    expect(classify("GET", "/settle")).toBe("exempt");
  });
});

describe("per-IP rate limits", () => {
  it("returns 429 with Retry-After once /settle is exhausted", async () => {
    const app = make({ rateLimits: TIGHT });
    const send = () =>
      app.app.inject({ method: "POST", url: "/settle", payload: {}, remoteAddress: "203.0.113.7" });

    expect((await send()).statusCode).toBe(400); // no body → rejected, but counted
    expect((await send()).statusCode).toBe(400);

    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.json().reason).toBe("RATE_LIMITED");
    expect(limited.json().route).toBe("settle");
  });

  it("limits /verify and /discovery/search on their own budgets", async () => {
    const app = make({ rateLimits: TIGHT });
    const ip = "203.0.113.8";

    for (let i = 0; i < 3; i += 1) {
      expect(
        (await app.app.inject({ method: "POST", url: "/verify", payload: {}, remoteAddress: ip }))
          .statusCode,
      ).toBe(400);
    }
    expect(
      (await app.app.inject({ method: "POST", url: "/verify", payload: {}, remoteAddress: ip }))
        .statusCode,
    ).toBe(429);

    // search has its own counter and is untouched by the verify burst
    const search = await app.app.inject({
      method: "GET",
      url: "/discovery/search?query=weather",
      remoteAddress: ip,
    });
    expect(search.statusCode).not.toBe(429);
  });

  it("keeps route classes on separate counters", async () => {
    const app = make({ rateLimits: TIGHT });
    const ip = "203.0.113.9";

    // Exhaust settle.
    for (let i = 0; i < 3; i += 1) {
      await app.app.inject({ method: "POST", url: "/settle", payload: {}, remoteAddress: ip });
    }
    expect(
      (await app.app.inject({ method: "POST", url: "/settle", payload: {}, remoteAddress: ip }))
        .statusCode,
    ).toBe(429);

    // resources has a separate, untouched budget.
    expect(
      (await app.app.inject({ method: "GET", url: "/discovery/resources", remoteAddress: ip }))
        .statusCode,
    ).toBe(200);
  });

  it("keeps separate clients on separate counters", async () => {
    const app = make({ rateLimits: TIGHT });
    for (let i = 0; i < 3; i += 1) {
      await app.app.inject({ method: "POST", url: "/settle", payload: {}, remoteAddress: "198.51.100.1" });
    }
    const other = await app.app.inject({
      method: "POST",
      url: "/settle",
      payload: {},
      remoteAddress: "198.51.100.2",
    });
    expect(other.statusCode).toBe(400);
  });

  it("never rate-limits health or supported", async () => {
    const app = make({ rateLimits: TIGHT });
    for (let i = 0; i < 12; i += 1) {
      expect(
        (await app.app.inject({ method: "GET", url: "/health", remoteAddress: "203.0.113.10" }))
          .statusCode,
      ).toBe(200);
    }
    expect(
      (await app.app.inject({ method: "GET", url: "/supported", remoteAddress: "203.0.113.10" }))
        .statusCode,
    ).toBe(200);
  });
});

describe("the limiter itself", () => {
  it("resets when the window elapses", () => {
    const limiter = new RateLimiter(TIGHT);
    const t0 = 1_000_000;
    expect(limiter.check("a", "settle", t0).allowed).toBe(true);
    expect(limiter.check("a", "settle", t0).allowed).toBe(true);
    expect(limiter.check("a", "settle", t0).allowed).toBe(false);

    // One millisecond past the window and the budget is whole again.
    expect(limiter.check("a", "settle", t0 + 60_001).allowed).toBe(true);
  });

  it("reports a Retry-After that shrinks as the window drains", () => {
    const limiter = new RateLimiter(TIGHT);
    const t0 = 2_000_000;
    limiter.check("b", "settle", t0);
    limiter.check("b", "settle", t0);
    expect(limiter.check("b", "settle", t0).retryAfter).toBe(60);
    expect(limiter.check("b", "settle", t0 + 55_000).retryAfter).toBe(5);
  });

  it("buckets IPv6 per /64 so a client cannot walk its own prefix", () => {
    const a = clientBucket("2001:db8:abcd:1234::1");
    const b = clientBucket("2001:db8:abcd:1234::ffff");
    const elsewhere = clientBucket("2001:db8:abcd:9999::1");
    expect(a).toBe(b);
    expect(a).not.toBe(elsewhere);
    // IPv4, including v4-mapped, is limited per address.
    expect(clientBucket("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(clientBucket(undefined)).toBe("unknown");
  });
});

describe("trust proxy", () => {
  it("disbelieves forwarding headers unless configured", () => {
    // The safe default: unset means the socket address, which cannot be forged.
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("0")).toBe(false);
    // Railway: exactly one hop, so a client cannot prepend its own chain.
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("true")).toBe(true);
    // Anything unparseable fails closed rather than open.
    expect(parseTrustProxy("yes-please")).toBe(false);
    expect(parseTrustProxy("-1")).toBe(false);
  });

  it("ignores a spoofed X-Forwarded-For by default", async () => {
    const app = make({ rateLimits: TIGHT });
    const headers = { "x-forwarded-for": "9.9.9.9" };

    // Same socket every time; the header claims a new client on each request.
    for (let i = 0; i < 3; i += 1) {
      await app.app.inject({
        method: "POST",
        url: "/settle",
        payload: {},
        remoteAddress: "203.0.113.20",
        headers: { "x-forwarded-for": `9.9.9.${i}` },
      });
    }
    const spoofed = await app.app.inject({
      method: "POST",
      url: "/settle",
      payload: {},
      remoteAddress: "203.0.113.20",
      headers,
    });
    expect(spoofed.statusCode, "rotating X-Forwarded-For must not reset the budget").toBe(429);
  });

  it("uses the forwarded address when trust is configured", async () => {
    const app = make({ rateLimits: TIGHT, trustProxy: 1 });
    for (let i = 0; i < 3; i += 1) {
      await app.app.inject({
        method: "POST",
        url: "/settle",
        payload: {},
        remoteAddress: "10.0.0.1",
        headers: { "x-forwarded-for": "203.0.113.30" },
      });
    }
    // Exhausted for the forwarded client…
    expect(
      (
        await app.app.inject({
          method: "POST",
          url: "/settle",
          payload: {},
          remoteAddress: "10.0.0.1",
          headers: { "x-forwarded-for": "203.0.113.30" },
        })
      ).statusCode,
    ).toBe(429);
    // …and untouched for a different one behind the same proxy.
    expect(
      (
        await app.app.inject({
          method: "POST",
          url: "/settle",
          payload: {},
          remoteAddress: "10.0.0.1",
          headers: { "x-forwarded-for": "203.0.113.31" },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe("body limit", () => {
  it("accepts a realistic settle payload", async () => {
    const app = make();
    const response = await app.app.inject({
      method: "POST",
      url: "/settle",
      payload: {
        paymentPayload: { x402Version: 2, payload: { transaction: "A".repeat(8_000) } },
        paymentRequirements: { scheme: "exact", network: NETWORK },
      },
    });
    // Rejected on its merits by the scheme, not by the size gate.
    expect(response.statusCode).not.toBe(413);
  });

  it("rejects an oversized body with 413 before the handler runs", async () => {
    const app = make({ bodyLimitBytes: 4096 });
    const response = await app.app.inject({
      method: "POST",
      url: "/settle",
      payload: { paymentPayload: { blob: "A".repeat(20_000) } },
    });

    expect(response.statusCode).toBe(413);
    // The settle handler answers 400 with this exact shape when a body is
    // unusable; a 413 body proves Fastify refused before reaching it, so no
    // signer or scheme work happened.
    expect(response.json().errorReason).toBeUndefined();
    expect(app.catalog.list({}).resources).toHaveLength(0);
  });
});

describe("settle concurrency cap", () => {
  it("sheds load with 503 once the in-flight slots are taken, and frees them again", async () => {
    const app = make({ settleMaxInflight: 1 });

    // A settle that never resolves until we let it, so a slot is held.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = app.facilitator.settle.bind(app.facilitator);
    let calls = 0;
    app.facilitator.settle = (async (..._args: Parameters<typeof original>) => {
      calls += 1;
      await held;
      return { success: false, errorReason: "stubbed", transaction: null, network: NETWORK };
    }) as unknown as typeof app.facilitator.settle;

    const body = {
      paymentPayload: { x402Version: 2, payload: {} },
      paymentRequirements: { scheme: "exact", network: NETWORK },
    };

    const first = app.app.inject({ method: "POST", url: "/settle", payload: body });
    await new Promise((r) => setTimeout(r, 20));

    const shed = await app.app.inject({ method: "POST", url: "/settle", payload: body });
    expect(shed.statusCode).toBe(503);
    expect(shed.json().errorReason).toBe("server_busy");
    expect(calls, "a shed request must not reach settle at all").toBe(1);

    release();
    await first;

    // The slot came back, even though the settlement it held failed.
    const after = await app.app.inject({ method: "POST", url: "/settle", payload: body });
    expect(after.statusCode).toBe(200);
    expect(calls).toBe(2);
  });

  it("frees the slot when settle throws", async () => {
    const app = make({ settleMaxInflight: 1 });
    app.facilitator.settle = (async () => {
      throw new Error("rpc exploded");
    }) as typeof app.facilitator.settle;

    const body = {
      paymentPayload: { x402Version: 2, payload: {} },
      paymentRequirements: { scheme: "exact", network: NETWORK },
    };

    expect((await app.app.inject({ method: "POST", url: "/settle", payload: body })).statusCode).toBe(500);
    // If `finally` did not release, this would be 503 rather than another 500.
    expect((await app.app.inject({ method: "POST", url: "/settle", payload: body })).statusCode).toBe(500);
  });
});

describe("timeouts", () => {
  /**
   * `inject` short-circuits the socket, so there is no honest way to make a
   * slow client here — simulating one would test Node's timers, not our
   * configuration. What can be asserted is that the values reach the server and
   * are the ones we reasoned about, which is the part that could silently
   * regress.
   */
  it("applies bounded receive and keep-alive timeouts to the HTTP server", () => {
    const app = make();
    // Read from the Node server rather than Fastify's initialConfig, which does
    // not surface requestTimeout — and the server is where it actually takes
    // effect anyway.
    expect(app.app.server.requestTimeout).toBe(15_000);
    expect(app.app.server.keepAliveTimeout).toBe(30_000);
    expect(app.app.initialConfig.bodyLimit).toBe(64 * 1024);
  });

  it("leaves the settlement path room to finish", () => {
    // Settlement takes about 8.6 s end to end (E-23), nearly all of it ledger
    // close. requestTimeout does not bound a handler — it bounds receiving the
    // request — but a value under the settlement time would still be a trap for
    // whoever reads this next and assumes otherwise.
    const app = make();
    expect(app.app.server.requestTimeout).toBeGreaterThan(8_600);
  });

  it("honours explicit overrides", () => {
    const app = make({ requestTimeoutMs: 5_000, keepAliveTimeoutMs: 7_000, bodyLimitBytes: 1_024 });
    expect(app.app.server.requestTimeout).toBe(5_000);
    expect(app.app.server.keepAliveTimeout).toBe(7_000);
    expect(app.app.initialConfig.bodyLimit).toBe(1_024);
  });
});

describe("the shipped policy", () => {
  it("allows the nine-payment upstream conformance run to complete", () => {
    // E-18 settles nine payments in one run. A limit below that would reject a
    // reviewer running the suite against us, which is the opposite of the point.
    expect(DEFAULT_RATE_POLICY.settle.limit).toBeGreaterThanOrEqual(9);
    expect(DEFAULT_RATE_POLICY.settle.windowMs).toBe(60_000);
  });

  it("prices the cheap routes above the expensive ones", () => {
    expect(DEFAULT_RATE_POLICY.resources.limit).toBeGreaterThan(DEFAULT_RATE_POLICY.search.limit);
    expect(DEFAULT_RATE_POLICY.verify.limit).toBeGreaterThan(DEFAULT_RATE_POLICY.settle.limit);
    expect(DEFAULT_SETTLE_MAX_INFLIGHT).toBeGreaterThan(1);
  });
});
