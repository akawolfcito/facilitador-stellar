/**
 * Operational visibility for a facilitator that spends money on request.
 *
 * The assertions that matter are the ones about honesty rather than about
 * counting: that an abstention is not filed as a failure, that a fee we could
 * not read is not quietly replaced by an average, and that the internal
 * endpoint cannot be reached without both switches.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { SqliteCatalogStore } from "@stellar-bazaar/catalog";
import { STELLAR_TESTNET_CAIP2 } from "@x402/stellar";
import { afterEach, describe, expect, it } from "vitest";
import { buildFacilitator, type BuiltFacilitator } from "../src/app.js";
import type { FacilitatorConfig } from "../src/config.js";
import { redact } from "../src/config.js";
import { MEAN_FEE_STROOPS, Metrics, classifySettleError, readFeeCharged } from "../src/metrics.js";

const NETWORK = STELLAR_TESTNET_CAIP2;
const TOKEN = "s3cret-operator-token";
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

const BODY = {
  paymentPayload: { x402Version: 2, payload: {} },
  paymentRequirements: { scheme: "exact", network: NETWORK },
};

function stubSettle(app: BuiltFacilitator, response: Record<string, unknown>): void {
  app.facilitator.settle = (async () => response) as unknown as typeof app.facilitator.settle;
}

describe("request counters", () => {
  it("counts verify requests and separates valid from rejected", async () => {
    const app = make();
    app.facilitator.verify = (async () => ({
      isValid: false,
      invalidReason: "nope",
      payer: null,
    })) as unknown as typeof app.facilitator.verify;

    await app.app.inject({ method: "POST", url: "/verify", payload: {} }); // bad body
    await app.app.inject({ method: "POST", url: "/verify", payload: BODY }); // invalid payment

    const snap = app.metrics.snapshot(live(app));
    expect(snap.http["verify.requests"]).toBe(2);
    expect(snap.http["verify.invalid"]).toBe(1);
    expect(snap.rejections.INVALID_BODY).toBe(1);
    expect(snap.rejections.INVALID_PAYMENT).toBe(1);
  });

  it("counts a settle request exactly once, and its outcome once", async () => {
    const app = make();
    stubSettle(app, { success: true, transaction: "abc123", network: NETWORK });

    await app.app.inject({ method: "POST", url: "/settle", payload: BODY });

    const snap = app.metrics.snapshot(live(app));
    expect(snap.http["settle.requests"]).toBe(1);
    expect(snap.stellar.settlementsSucceeded).toBe(1);
    expect(snap.stellar.submissionsFailed).toBe(0);
    expect(snap.stellar.lastSettlementSuccessAt).not.toBeNull();
    expect(snap.stellar.lastSettlementFailureAt).toBeNull();
  });

  it("counts a failed submission as a failure with a mapped reason", async () => {
    const app = make();
    stubSettle(app, {
      success: false,
      errorReason: "submission_failed",
      transaction: null,
      network: NETWORK,
    });

    await app.app.inject({ method: "POST", url: "/settle", payload: BODY });

    const snap = app.metrics.snapshot(live(app));
    expect(snap.stellar.submissionsFailed).toBe(1);
    expect(snap.stellar.settlementsSucceeded).toBe(0);
    expect(snap.rejections.SUBMISSION_FAILURE).toBe(1);
    expect(snap.stellar.lastSettlementFailureAt).not.toBeNull();
  });

  it("counts rate-limit and concurrency rejections apart from each other", async () => {
    const app = make({
      rateLimits: {
        settle: { limit: 1, windowMs: 60_000 },
        verify: { limit: 60, windowMs: 60_000 },
        search: { limit: 30, windowMs: 60_000 },
        resources: { limit: 240, windowMs: 60_000 },
      },
    });
    stubSettle(app, { success: false, errorReason: "x", transaction: null, network: NETWORK });

    await app.app.inject({ method: "POST", url: "/settle", payload: BODY });
    const limited = await app.app.inject({ method: "POST", url: "/settle", payload: BODY });
    expect(limited.statusCode).toBe(429);

    const snap = app.metrics.snapshot(live(app));
    expect(snap.rejections.RATE_LIMIT).toBe(1);
    expect(snap.rejections.SETTLE_CONCURRENCY_LIMIT).toBeUndefined();
  });

  it("counts concurrency shedding", async () => {
    const app = make({ settleMaxInflight: 1 });
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    app.facilitator.settle = (async () => {
      await held;
      return { success: false, errorReason: "x", transaction: null, network: NETWORK };
    }) as unknown as typeof app.facilitator.settle;

    const first = app.app.inject({ method: "POST", url: "/settle", payload: BODY });
    await new Promise((r) => setTimeout(r, 20));
    const shed = await app.app.inject({ method: "POST", url: "/settle", payload: BODY });
    expect(shed.statusCode).toBe(503);
    release();
    await first;

    const snap = app.metrics.snapshot(live(app));
    expect(snap.rejections.SETTLE_CONCURRENCY_LIMIT).toBe(1);
    // And the gauge came back to zero after the held settlement finished.
    expect(snap.stellar.settlementsInFlight).toBe(0);
  });

  it("returns the in-flight gauge to zero when settle throws", async () => {
    const app = make({ settleMaxInflight: 1 });
    app.facilitator.settle = (async () => {
      throw new Error("boom");
    }) as unknown as typeof app.facilitator.settle;

    await app.app.inject({ method: "POST", url: "/settle", payload: BODY });
    expect(app.metrics.snapshot(live(app)).stellar.settlementsInFlight).toBe(0);
  });
});

describe("discovery counters", () => {
  it("counts INDEX_NOT_READY separately from an abstention", async () => {
    const app = make();

    // Before initializeSearch: not ready.
    const cold = await app.app.inject({ method: "GET", url: "/discovery/search?query=weather" });
    expect(cold.statusCode).toBe(503);

    let snap = app.metrics.snapshot(live(app));
    expect(snap.search.notReady).toBe(1);
    expect(snap.search.abstentions).toBe(0);
    expect(snap.rejections.INDEX_NOT_READY).toBe(1);

    // After a successful sync over an empty catalog: a real abstention.
    await app.initializeSearch();
    const warm = await app.app.inject({ method: "GET", url: "/discovery/search?query=weather" });
    expect(warm.statusCode).toBe(200);
    expect(warm.json().abstained).toBeDefined();

    snap = app.metrics.snapshot(live(app));
    expect(snap.search.abstentions).toBe(1);
    // The refusal to answer must not have been recorded as a failure.
    expect(snap.search.notReady).toBe(1);
    expect(snap.search.syncSucceeded).toBe(1);
    expect(snap.search.syncFailed).toBe(0);
  }, 240_000);

  it("counts a failed sync without counting a success", async () => {
    const real = new SqliteCatalogStore(":memory:");
    const broken = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "all") {
          return () => {
            throw new Error("index source unavailable");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const app = buildFacilitator(
      {
        port: 0,
        network: NETWORK,
        signerSecrets: [Keypair.random().secret()],
        rpcUrl: "https://soroban-testnet.stellar.org",
        areFeesSponsored: true,
        catalogPath: ":memory:",
      },
      broken as unknown as SqliteCatalogStore,
    );
    built.push(app);

    await app.initializeSearch();
    const snap = app.metrics.snapshot(live(app));
    expect(snap.search.syncFailed).toBe(1);
    expect(snap.search.syncSucceeded).toBe(0);
    expect(snap.search.status).toBe("failed");
  }, 240_000);
});

describe("sponsorship fee accounting", () => {
  it("sums only fees the chain confirmed", () => {
    const metrics = new Metrics();
    metrics.settlementsSucceeded = 2;
    metrics.recordFee(22_973n);
    metrics.recordFee(23_000n);

    const snap = metrics.snapshot(live());
    expect(snap.stellar.sponsorshipObservedStroops).toBe("45973");
    expect(snap.stellar.sponsorshipObservedXlm).toBe("0.0045973");
    expect(snap.stellar.feeAccounting).toBe("exact");
    expect(snap.stellar.settlementsWithUnknownFee).toBe(0);
  });

  it("never folds an unreadable fee into the observed total", () => {
    const metrics = new Metrics();
    metrics.settlementsSucceeded = 2;
    metrics.recordFee(22_973n);
    metrics.recordFee(undefined);

    const snap = metrics.snapshot(live());
    // The observed figure is still only what was actually read.
    expect(snap.stellar.sponsorshipObservedStroops).toBe("22973");
    expect(snap.stellar.settlementsWithUnknownFee).toBe(1);
    expect(snap.stellar.feeAccounting).toBe("partial");
    // The estimate for the unknown one is reported, and kept apart.
    expect(snap.stellar.sponsorshipUnknownEstimatedXlm).toBe("0.0022973");
    expect(MEAN_FEE_STROOPS).toBe(22_973n);
  });

  it("reports no accounting before anything has settled", () => {
    expect(new Metrics().snapshot(live()).stellar.feeAccounting).toBe("none");
  });

  it("treats an unreadable or nonsense fee as unknown rather than zero", async () => {
    // RPC throws.
    expect(
      await readFeeCharged(
        {
          getTransaction: async () => {
            throw new Error("rpc down");
          },
        },
        "hash",
      ),
    ).toBeUndefined();

    // Result has no fee.
    expect(await readFeeCharged({ getTransaction: async () => ({}) }, "hash")).toBeUndefined();

    // Fee is not a number.
    expect(
      await readFeeCharged(
        { getTransaction: async () => ({ resultXdr: { feeCharged: () => "not-a-number" } }) },
        "hash",
      ),
    ).toBeUndefined();

    // And a real one is read exactly.
    expect(
      await readFeeCharged(
        { getTransaction: async () => ({ resultXdr: { feeCharged: () => "22973" } }) },
        "hash",
      ),
    ).toBe(22_973n);
  });

  it("maps upstream error strings onto the closed reason set", () => {
    expect(classifySettleError(undefined)).toBe("UNKNOWN");
    expect(classifySettleError("rpc_unavailable")).toBe("RPC_FAILURE");
    expect(classifySettleError("submission_failed")).toBe("SUBMISSION_FAILURE");
    // Anything else is a rejected payment, never the raw string.
    expect(classifySettleError("some_new_upstream_reason")).toBe("INVALID_PAYMENT");
  });
});

describe("the internal metrics endpoint", () => {
  it("is not routed at all unless both switches are set", async () => {
    // Neither.
    expect(
      (await make().app.inject({ method: "GET", url: "/internal/metrics" })).statusCode,
    ).toBe(404);
    // Enabled but no token: still absent, so its existence is not discoverable.
    expect(
      (
        await make({ enableInternalMetrics: true }).app.inject({
          method: "GET",
          url: "/internal/metrics",
        })
      ).statusCode,
    ).toBe(404);
    // Token but not enabled.
    expect(
      (
        await make({ metricsToken: TOKEN }).app.inject({ method: "GET", url: "/internal/metrics" })
      ).statusCode,
    ).toBe(404);
  });

  it("rejects a missing or wrong token", async () => {
    const app = make({ enableInternalMetrics: true, metricsToken: TOKEN });

    expect((await app.app.inject({ method: "GET", url: "/internal/metrics" })).statusCode).toBe(401);
    expect(
      (
        await app.app.inject({
          method: "GET",
          url: "/internal/metrics",
          headers: { authorization: "Bearer wrong" },
        })
      ).statusCode,
    ).toBe(401);
    // A prefix of the real token must not pass either.
    expect(
      (
        await app.app.inject({
          method: "GET",
          url: "/internal/metrics",
          headers: { authorization: `Bearer ${TOKEN.slice(0, -1)}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("serves a snapshot with the correct token", async () => {
    const app = make({ enableInternalMetrics: true, metricsToken: TOKEN });
    const response = await app.app.inject({
      method: "GET",
      url: "/internal/metrics",
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.stellar.feeAccounting).toBe("none");
    expect(body.search.status).toBe("initializing");
    expect(body.catalog.listings).toBe(0);
  });

  it("leaks no secret, token, address or payload material", async () => {
    const app = make({ enableInternalMetrics: true, metricsToken: TOKEN });
    const secret = app.signerAddresses[0]!;
    stubSettle(app, { success: true, transaction: "abc123", network: NETWORK });
    await app.app.inject({ method: "POST", url: "/settle", payload: BODY });

    const text = (
      await app.app.inject({
        method: "GET",
        url: "/internal/metrics",
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    ).body;

    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(secret);
    expect(text).not.toMatch(/S[A-Z2-7]{55}/);
    expect(text).not.toContain("paymentPayload");
    expect(text).not.toContain("authorization");
    // The transaction hash is settlement provenance, not payload material, but
    // it does not belong in an aggregate either.
    expect(text).not.toContain("abc123");
  });
});

describe("public health", () => {
  it("stays free of spend, balances and failure detail", async () => {
    const app = make();
    const body = (await app.app.inject({ method: "GET", url: "/health" })).json();

    expect(body).toMatchObject({ status: "ok", ready: false });
    expect(body.settlements.inFlight).toBe(0);
    const text = JSON.stringify(body);
    expect(text).not.toContain("sponsorship");
    expect(text).not.toContain("balance");
    expect(text).not.toMatch(/S[A-Z2-7]{55}/);
  });
});

describe("config redaction", () => {
  it("masks the metrics token as well as the signer secrets", () => {
    const redacted = redact({
      port: 4402,
      network: NETWORK,
      signerSecrets: [Keypair.random().secret(), Keypair.random().secret()],
      rpcUrl: "https://soroban-testnet.stellar.org",
      areFeesSponsored: true,
      catalogPath: "./catalog.db",
      metricsToken: TOKEN,
    });

    expect(redacted.signerSecrets).toBe("2 signer(s)");
    expect(redacted.metricsToken).toBe("set");
    expect(JSON.stringify(redacted)).not.toContain(TOKEN);
    expect(JSON.stringify(redacted)).not.toMatch(/S[A-Z2-7]{55}/);
  });
});

/** Live values the snapshot needs; defaults are fine for pure-metrics tests. */
function live(app?: BuiltFacilitator) {
  return {
    catalogListings: app ? app.catalog.list({ limit: 1 }).pagination.total : 0,
    searchStatus: app ? app.discoveryStatus() : "initializing",
    searchIndexed: 0,
    settlementsInFlight: 0,
  };
}
