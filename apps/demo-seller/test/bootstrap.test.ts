/**
 * Facilitator readiness.
 *
 * The seller was already resilient in the way that mattered least and fragile
 * in the way that mattered most. Measured before writing any of this:
 *
 *   with the facilitator unreachable the process stays up, `/health` returns
 *   200 and the paid route returns a bare 500;
 *   when the facilitator comes back, the next request to the paid route gets a
 *   402 with no restart, because `@x402/fastify` retries its own initialize().
 *
 * So recovery was never the gap. The gap was that `/health` said "ok" while the
 * seller could not issue a valid 402, which is the one thing an operator reads
 * before deciding nothing is wrong. These tests pin the probe that closes it.
 *
 * Time is injected. A retry ladder tested against the real clock is a slow test
 * that still cannot assert the delays it claims to use.
 */

import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { RESOURCE_PATH, warmUpPaidRoute } from "../src/app.js";
import {
  BACKOFF_CAP_MS,
  BACKOFF_STEPS_MS,
  backoffFor,
  startFacilitatorBootstrap,
  type BootstrapDeps,
} from "../src/bootstrap.js";

const CONFIG = { facilitatorUrl: "https://facilitator.example", network: "stellar:testnet" };

const supported = (kinds: unknown[]) =>
  new Response(JSON.stringify({ kinds }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const OUR_KIND = [{ x402Version: 2, network: "stellar:testnet", scheme: "exact" }];

/** A scheduler whose clock only moves when a test says so. */
function fakeClock() {
  let now = 0;
  const pending: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const deps = {
    now: () => now,
    schedule(fn: () => void, ms: number) {
      const entry = { at: now + ms, fn, cancelled: false };
      pending.push(entry);
      return { cancel: () => { entry.cancelled = true; } };
    },
  };
  return {
    deps,
    delays: () => pending.filter((p) => !p.cancelled).map((p) => p.at - now),
    pendingCount: () => pending.filter((p) => !p.cancelled).length,
    /** Fire the next due timer and let its async work settle. */
    async tick() {
      const next = pending.find((p) => !p.cancelled);
      if (!next) return false;
      next.cancelled = true;
      now = next.at;
      next.fn();
      await vi.waitFor(() => {});
      await new Promise((r) => setImmediate(r));
      return true;
    },
  };
}

describe("the retry ladder", () => {
  it("climbs 1, 2, 4, 8, 16 seconds and then holds", () => {
    expect(BACKOFF_STEPS_MS).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(backoffFor(1)).toBe(1_000);
    expect(backoffFor(5)).toBe(16_000);
    // Past the ladder it holds at the cap rather than growing without bound.
    expect(backoffFor(6)).toBe(BACKOFF_CAP_MS);
    expect(backoffFor(500)).toBe(BACKOFF_CAP_MS);
    expect(BACKOFF_CAP_MS).toBe(30_000);
  });

  it("never schedules a tight loop", () => {
    for (let attempt = 1; attempt <= 50; attempt += 1) {
      expect(backoffFor(attempt)).toBeGreaterThanOrEqual(1_000);
    }
  });
});

describe("a facilitator that is down at startup", () => {
  it("reports not ready, and keeps saying so rather than hanging silently", async () => {
    const clock = fakeClock();
    const logs: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const probe = startFacilitatorBootstrap(CONFIG, {
      ...clock.deps,
      fetch: fetchMock as unknown as typeof fetch,
      log: (record) => logs.push(record),
    } satisfies BootstrapDeps);
    await new Promise((r) => setImmediate(r));

    expect(probe.readiness().ready).toBe(false);
    expect(probe.readiness().lastError).toContain("ECONNREFUSED");
    expect(logs.some((l) => l.event === "facilitator_probe_failed")).toBe(true);

    // A retry is queued, and it is the first rung of the ladder.
    expect(clock.delays()).toEqual([1_000]);
    await clock.tick();
    expect(clock.delays()).toEqual([2_000]);
    expect(probe.readiness().attempts).toBe(2);
    probe.stop();
  });

  it("becomes ready when the facilitator comes back, with no restart", async () => {
    const clock = fakeClock();
    let up = false;
    const fetchMock = vi.fn(async () => {
      if (!up) throw new Error("connect ECONNREFUSED");
      return supported(OUR_KIND);
    });

    const probe = startFacilitatorBootstrap(CONFIG, {
      ...clock.deps,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await new Promise((r) => setImmediate(r));
    expect(probe.readiness().ready).toBe(false);

    up = true;
    await clock.tick();

    expect(probe.readiness().ready).toBe(true);
    expect(probe.readiness().readySince).toBeDefined();
    expect(probe.readiness().lastError).toBeUndefined();
    probe.stop();
  });

  it("refuses to call itself ready when the facilitator cannot serve our kind", async () => {
    // Reachable is not the same as useful. A facilitator that answers but does
    // not support stellar:testnet exact cannot settle anything this seller sells.
    const clock = fakeClock();
    const fetchMock = vi.fn(async () =>
      supported([{ x402Version: 2, network: "eip155:8453", scheme: "exact" }]),
    );

    const probe = startFacilitatorBootstrap(CONFIG, {
      ...clock.deps,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await new Promise((r) => setImmediate(r));

    expect(probe.readiness().ready).toBe(false);
    expect(probe.readiness().lastError).toMatch(/does not advertise/i);
    expect(clock.pendingCount()).toBe(1);
    probe.stop();
  });
});

describe("a facilitator that goes away after startup", () => {
  it("stops claiming ready, and recovers again without a restart", async () => {
    const clock = fakeClock();
    let up = true;
    const fetchMock = vi.fn(async () => {
      if (!up) throw new Error("connect ECONNREFUSED");
      return supported(OUR_KIND);
    });

    const probe = startFacilitatorBootstrap(CONFIG, {
      ...clock.deps,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await new Promise((r) => setImmediate(r));
    expect(probe.readiness().ready).toBe(true);
    // Once ready it keeps checking, at the capped interval and no faster.
    expect(clock.delays()).toEqual([BACKOFF_CAP_MS]);

    up = false;
    await clock.tick();
    expect(probe.readiness().ready).toBe(false);
    // The ladder restarts from the bottom, so recovery is noticed quickly.
    expect(clock.delays()).toEqual([1_000]);

    up = true;
    await clock.tick();
    expect(probe.readiness().ready).toBe(true);
    probe.stop();
  });
});

describe("logs stay readable during a long outage", () => {
  it("logs the first attempts, then at most once a minute", async () => {
    const clock = fakeClock();
    const logs: Record<string, unknown>[] = [];
    const probe = startFacilitatorBootstrap(CONFIG, {
      ...clock.deps,
      fetch: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
      log: (record) => logs.push(record),
    });
    await new Promise((r) => setImmediate(r));

    for (let i = 0; i < 40; i += 1) await clock.tick();

    const failures = logs.filter((l) => l.event === "facilitator_probe_failed");
    expect(probe.readiness().attempts).toBe(41);
    // Forty-one attempts spanning about seventeen minutes, not forty-one lines.
    expect(failures.length).toBeGreaterThanOrEqual(5);
    expect(failures.length).toBeLessThan(25);
    expect(failures.at(-1)).toMatchObject({ event: "facilitator_probe_failed" });
    expect(failures.at(-1)!.attempts).toBeGreaterThan(5);
    probe.stop();
  });
});

describe("the request recovery costs", () => {
  it("is spent by the seller, not by the next visitor", async () => {
    // Measured behaviour of @x402/fastify: it holds the promise from its first
    // initialize(). Once that rejected, the next paid request awaits the same
    // rejected promise, answers 500, and only then clears it. So recovery costs
    // exactly one request, and the warm-up is what pays it.
    const statuses = [500, 402, 402];
    const inject = vi.fn(async () => ({ statusCode: statuses.shift() ?? 402 }));
    const logs: Record<string, unknown>[] = [];

    const status = await warmUpPaidRoute(
      { inject } as unknown as FastifyInstance,
      (record) => logs.push(record),
    );

    expect(status).toBe(402);
    expect(inject).toHaveBeenCalledTimes(2);
    expect(logs).toEqual([{ event: "paid_route_warm", status: 402 }]);
  });

  it("gives up after three tries rather than looping", async () => {
    const inject = vi.fn(async () => ({ statusCode: 500 }));
    const status = await warmUpPaidRoute({ inject } as unknown as FastifyInstance, () => {});
    expect(status).toBe(500);
    expect(inject).toHaveBeenCalledTimes(3);
  });

  it("asks for the paid route without offering payment", async () => {
    const inject = vi.fn(async () => ({ statusCode: 402 }));
    await warmUpPaidRoute({ inject } as unknown as FastifyInstance, () => {});
    const args = (inject.mock.calls as unknown as { method: string; url: string }[][])[0]?.[0];
    expect(args).toEqual({ method: "GET", url: RESOURCE_PATH });
    expect(JSON.stringify(args)).not.toMatch(/payment|x-payment/i);
  });

  it("runs once per recovery, and a failure in it is not fatal", async () => {
    const clock = fakeClock();
    let up = false;
    const onReady = vi.fn(async () => {
      throw new Error("warm-up blew up");
    });
    const logs: Record<string, unknown>[] = [];

    const probe = startFacilitatorBootstrap(CONFIG, {
      ...clock.deps,
      fetch: (async () => {
        if (!up) throw new Error("down");
        return supported(OUR_KIND);
      }) as unknown as typeof fetch,
      log: (record) => logs.push(record),
      onReady,
    });
    await new Promise((r) => setImmediate(r));

    up = true;
    await clock.tick();
    await new Promise((r) => setImmediate(r));

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(probe.readiness().ready).toBe(true);
    expect(logs.some((l) => l.event === "facilitator_ready_hook_failed")).toBe(true);

    // Still ready on the next successful probe, and not warmed a second time.
    await clock.tick();
    expect(onReady).toHaveBeenCalledTimes(1);
    probe.stop();
  });
});

describe("shutdown", () => {
  it("cancels the pending retry instead of holding the process open", async () => {
    const clock = fakeClock();
    const probe = startFacilitatorBootstrap(CONFIG, {
      ...clock.deps,
      fetch: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    await new Promise((r) => setImmediate(r));
    expect(clock.pendingCount()).toBe(1);

    probe.stop();
    expect(clock.pendingCount()).toBe(0);
  });

  it("aborts a probe that is still in flight", async () => {
    const clock = fakeClock();
    let seen: AbortSignal | undefined;
    const probe = startFacilitatorBootstrap(CONFIG, {
      ...clock.deps,
      fetch: ((_url: string, init: RequestInit) => {
        seen = init.signal ?? undefined;
        return new Promise(() => {});
      }) as unknown as typeof fetch,
    });
    await new Promise((r) => setImmediate(r));

    expect(seen).toBeDefined();
    expect(seen!.aborted).toBe(false);
    probe.stop();
    expect(seen!.aborted).toBe(true);
  });

  it("schedules nothing further once stopped", async () => {
    const clock = fakeClock();
    const probe = startFacilitatorBootstrap(CONFIG, {
      ...clock.deps,
      fetch: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    await new Promise((r) => setImmediate(r));
    probe.stop();

    // Nothing is pending, and a late-arriving result cannot revive the loop.
    expect(clock.pendingCount()).toBe(0);
    await clock.tick();
    expect(clock.pendingCount()).toBe(0);
  });
});
