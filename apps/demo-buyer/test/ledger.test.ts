/**
 * The budget, and what survives a restart.
 *
 * The property under test is not "the counter counts". It is that no sequence
 * of crashes, redeploys or repeated clicks lets the service spend past the UTC
 * day's ceiling, and that a reservation taken before signing is never handed
 * back once signing has happened.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IP_GUARD_MS,
  REQUEST_WINDOW_MS,
  SpendLedger,
  utcDay,
  type BudgetPolicy,
} from "../src/ledger.js";
import {
  GLOBAL,
  PER_IP,
  PaymentSlot,
  RateLimiter,
  bucketFingerprint,
  clientBucket,
} from "../src/limits.js";

const POLICY: BudgetPolicy = { maxPaymentsPerDay: 150, maxUnitsPerDay: 1_500_000 };
const AMOUNT = 10_000;

let dir: string;
let clock: number;
const now = () => clock;

function open(policy: BudgetPolicy = POLICY): SpendLedger {
  return new SpendLedger(join(dir, "demo.db"), policy, now);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "demo-buyer-"));
  clock = Date.parse("2026-08-15T10:00:00.000Z");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the UTC daily budget", () => {
  it("counts payments and units, and blocks on whichever binds first", () => {
    const ledger = open({ maxPaymentsPerDay: 3, maxUnitsPerDay: 10_000_000 });
    for (let i = 0; i < 3; i += 1) {
      expect(ledger.reserve(`r${i}`, "bucket", AMOUNT).ok, `reservation ${i}`).toBe(true);
    }
    const blocked = ledger.reserve("r3", "bucket", AMOUNT);
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.reason).toBe("DEMO_BUDGET_EXHAUSTED");
    expect(ledger.totals().payments).toBe(3);
    ledger.close();
  });

  it("blocks on the spend cap even when the count would still allow it", () => {
    const ledger = open({ maxPaymentsPerDay: 1000, maxUnitsPerDay: 25_000 });
    expect(ledger.reserve("a", "b", AMOUNT).ok).toBe(true);
    expect(ledger.reserve("b", "b", AMOUNT).ok).toBe(true);
    // 30000 would exceed 25000, and the count is nowhere near its own limit.
    expect(ledger.reserve("c", "b", AMOUNT).ok).toBe(false);
    expect(ledger.totals().committedUnits).toBe(20_000);
    ledger.close();
  });

  it("resets at 00:00 UTC and not on a rolling window", () => {
    const ledger = open({ maxPaymentsPerDay: 1, maxUnitsPerDay: 1_000_000 });
    expect(ledger.reserve("day1", "b", AMOUNT).ok).toBe(true);
    expect(ledger.reserve("day1b", "b", AMOUNT).ok).toBe(false);

    // Late the same UTC day: still blocked, however many hours have passed.
    clock = Date.parse("2026-08-15T23:59:59.000Z");
    expect(ledger.reserve("still-day1", "b", AMOUNT).ok).toBe(false);

    // One second later it is a new calendar day.
    clock = Date.parse("2026-08-16T00:00:00.000Z");
    expect(ledger.reserve("day2", "b", AMOUNT).ok).toBe(true);
    expect(ledger.totals().day).toBe("2026-08-16");
    expect(ledger.totals(utcDay(new Date(Date.parse("2026-08-15T12:00:00Z")))).payments).toBe(1);
    ledger.close();
  });

  it("survives a restart: a redeploy does not refill the budget", () => {
    const first = open({ maxPaymentsPerDay: 2, maxUnitsPerDay: 1_000_000 });
    expect(first.reserve("a", "b", AMOUNT).ok).toBe(true);
    expect(first.reserve("b", "b", AMOUNT).ok).toBe(true);
    first.close();

    // Same volume, new process.
    const second = open({ maxPaymentsPerDay: 2, maxUnitsPerDay: 1_000_000 });
    expect(second.totals().payments).toBe(2);
    expect(second.reserve("c", "b", AMOUNT).ok).toBe(false);
    second.close();
  });

  it("reports what is left", () => {
    const ledger = open({ maxPaymentsPerDay: 10, maxUnitsPerDay: 100_000 });
    ledger.reserve("a", "b", AMOUNT);
    expect(ledger.remainingToday()).toEqual({ payments: 9, units: 90_000 });
    ledger.close();
  });
});

describe("reserve before signing, release only before signing", () => {
  it("gives the budget back for a pre-signing refusal", () => {
    const ledger = open();
    ledger.reserve("a", "b", AMOUNT);
    expect(ledger.totals().committedUnits).toBe(AMOUNT);

    ledger.release("a", "the seller's live terms changed");
    expect(ledger.totals()).toMatchObject({ committedUnits: 0, payments: 0 });
    ledger.close();
  });

  it("keeps the budget committed once the outcome is uncertain", () => {
    // The money may be gone. Handing the budget back here is how one uncertain
    // payment becomes two.
    const ledger = open();
    ledger.reserve("a", "b", AMOUNT);
    ledger.finish("a", "uncertain", { sellerStatus: 502 });

    ledger.release("a", "too late");
    expect(ledger.totals().committedUnits).toBe(AMOUNT);
    expect(ledger.find("a")?.status).toBe("uncertain");
    ledger.close();
  });

  it("keeps it committed after a settlement, obviously", () => {
    const ledger = open();
    ledger.reserve("a", "b", AMOUNT);
    ledger.finish("a", "settled", { txHash: "abc123", sellerStatus: 200 });
    ledger.release("a", "no");
    expect(ledger.totals().committedUnits).toBe(AMOUNT);
    expect(ledger.find("a")).toMatchObject({ status: "settled", txHash: "abc123" });
    ledger.close();
  });

  it("a reservation left behind by a crash still counts against the day", () => {
    const first = open();
    first.reserve("interrupted", "b", AMOUNT);
    first.close(); // the process died here, between reserving and signing

    const second = open();
    expect(second.totals().committedUnits).toBe(AMOUNT);
    expect(second.find("interrupted")?.status).toBe("reserved");
    second.close();
  });
});

describe("idempotency", () => {
  it("finds a previous answer inside the window and forgets it after", () => {
    const ledger = open();
    ledger.reserve("same-id", "b", AMOUNT);
    ledger.finish("same-id", "settled", { txHash: "tx", sellerStatus: 200 });

    clock += REQUEST_WINDOW_MS - 1000;
    expect(ledger.find("same-id")?.txHash).toBe("tx");

    // Past the window a genuinely later demo is allowed to pay again.
    clock += 2000;
    expect(ledger.find("same-id")).toBeUndefined();
    ledger.close();
  });

  it("catches a double click from the same bucket without an id", () => {
    const ledger = open();
    ledger.reserve("first", "bucket-a", AMOUNT);
    ledger.finish("first", "settled", { txHash: "tx", sellerStatus: 200 });

    clock += 5_000;
    expect(ledger.recentForBucket("bucket-a")?.txHash).toBe("tx");
    // A different visitor is unaffected.
    expect(ledger.recentForBucket("bucket-b")).toBeUndefined();

    clock += IP_GUARD_MS;
    expect(ledger.recentForBucket("bucket-a")).toBeUndefined();
    ledger.close();
  });

  it("prunes old rows but keeps the day totals", () => {
    const ledger = open();
    ledger.reserve("old", "b", AMOUNT);
    clock += 49 * 60 * 60 * 1000;
    ledger.prune();
    expect(ledger.find("old")).toBeUndefined();
    expect(ledger.totals("2026-08-15").committedUnits).toBe(AMOUNT);
    ledger.close();
  });
});

describe("rate limits", () => {
  it("allows three per hour from one bucket, then refuses with a retry hint", () => {
    let at = 0;
    const limiter = new RateLimiter(() => at);
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check("ip", PER_IP).allowed, `attempt ${i}`).toBe(true);
    }
    const refused = limiter.check("ip", PER_IP);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);

    at += PER_IP.windowMs;
    expect(limiter.check("ip", PER_IP).allowed).toBe(true);
  });

  it("keeps the global limit at half the facilitator's settle limit", () => {
    expect(GLOBAL.limit).toBe(5);
    expect(GLOBAL.windowMs).toBe(60_000);
    let at = 0;
    const limiter = new RateLimiter(() => at);
    for (let i = 0; i < 5; i += 1) expect(limiter.check("global", GLOBAL).allowed).toBe(true);
    expect(limiter.check("global", GLOBAL).allowed).toBe(false);
  });

  it("refunds a slot when the request was refused before it cost anything", () => {
    const limiter = new RateLimiter(() => 0);
    limiter.check("ip", PER_IP);
    limiter.check("ip", PER_IP);
    limiter.refund("ip");
    limiter.check("ip", PER_IP);
    limiter.check("ip", PER_IP);
    expect(limiter.check("ip", PER_IP).allowed).toBe(false);
  });

  it("treats a whole IPv6 /64 as one visitor, and never stores the address", () => {
    expect(clientBucket("2001:db8:1234:5678:9abc:def0:1234:5678")).toBe("2001:db8:1234:5678::/64");
    expect(clientBucket("2001:db8:1234:5678::1")).toBe("2001:db8:1234:5678::/64");
    expect(clientBucket("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(clientBucket("203.0.113.9")).toBe("203.0.113.9");
    expect(clientBucket(undefined)).toBe("unknown");

    const print = bucketFingerprint("203.0.113.9");
    expect(print).toHaveLength(16);
    expect(print).not.toContain("203");
  });
});

describe("payment concurrency", () => {
  it("runs one payment at a time", async () => {
    const slot = new PaymentSlot(1, 50);
    expect(await slot.acquire()).toBe(true);
    expect(slot.busy).toBe(true);
    // The second caller waits, and gives up rather than queueing forever.
    expect(await slot.acquire()).toBe(false);
    slot.release();
    expect(await slot.acquire()).toBe(true);
  });

  it("hands the slot to a waiter as soon as it is free", async () => {
    const slot = new PaymentSlot(1, 5_000);
    await slot.acquire();
    const queued = slot.acquire();
    slot.release();
    expect(await queued).toBe(true);
  });

  it("lets two simultaneous callers produce at most one payment", async () => {
    const slot = new PaymentSlot(1, 0);
    const [a, b] = await Promise.all([slot.acquire(), slot.acquire()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});
