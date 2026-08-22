/**
 * Rate and concurrency limits.
 *
 * The same fixed-window shape `apps/facilitator/src/limits.ts` uses, copied
 * rather than imported: these are two services with two threat models, and a
 * shared limiter would mean a change made for one silently retunes the other.
 *
 * IPv6 is collapsed to a /64 because a single subscriber is routinely handed a
 * whole /64, and limiting the full address would limit nothing at all. Buckets
 * are hashed before they are stored or reported, so no raw address reaches the
 * ledger, the logs or the metrics.
 */

import { createHash } from "node:crypto";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export interface RateRule {
  limit: number;
  windowMs: number;
}

/**
 * Values argued in the plan, not borrowed from an example.
 *
 * Three per hour: a reviewer wants one, and two spare covers a refusal they
 * want to retry after reading it. Five a minute globally is half the
 * facilitator's own settle limit, so the demo can never be the reason a real
 * settlement gets throttled.
 */
export const PER_IP: RateRule = { limit: 3, windowMs: HOUR };
export const GLOBAL: RateRule = { limit: 5, windowMs: MINUTE };

/** One account signs sequentially. Concurrency above one invites nonce conflicts. */
export const MAX_CONCURRENT_PAYMENTS = 1;

/** How long a request will wait for the single slot before being turned away. */
export const SLOT_WAIT_MS = 8_000;

/** A whole IPv6 /64 is one subscriber. An IPv4 address is one bucket. */
export function clientBucket(ip: string | undefined): string {
  if (!ip) return "unknown";
  const address = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (!address.includes(":")) return address;

  const groups = address.split("%")[0]!.split(":");
  if (groups.includes("")) {
    // Compressed form. Expand only as far as the first four groups need.
    const [head = "", tail = ""] = address.split("::");
    const headGroups = head ? head.split(":") : [];
    const tailGroups = tail ? tail.split(":") : [];
    const missing = 8 - headGroups.length - tailGroups.length;
    const full = [...headGroups, ...Array<string>(Math.max(0, missing)).fill("0"), ...tailGroups];
    return `${full.slice(0, 4).join(":")}::/64`;
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** What goes in logs and the ledger. Enough to correlate, not enough to identify. */
export function bucketFingerprint(bucket: string): string {
  return createHash("sha256").update(bucket).digest("hex").slice(0, 16);
}

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Fixed window. Simple enough to reason about at a glance, which is the point. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  check(key: string, rule: RateRule): RateDecision {
    const at = this.now();
    const existing = this.windows.get(key);

    if (!existing || at >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: at + rule.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (existing.count >= rule.limit) {
      return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - at) / 1000) };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Hand a slot back when the request was refused before it cost anything. */
  refund(key: string): void {
    const existing = this.windows.get(key);
    if (existing && existing.count > 0) existing.count -= 1;
  }

  sweep(): void {
    const at = this.now();
    for (const [key, window] of this.windows) {
      if (at >= window.resetAt) this.windows.delete(key);
    }
  }
}

/**
 * One payment at a time, with a short queue.
 *
 * Rejecting immediately would turn a second reviewer's click into an error for
 * no reason; waiting forever would let a queue build behind a stuck payment.
 * Eight seconds is roughly one settlement, so the common case waits once.
 */
export class PaymentSlot {
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly max = MAX_CONCURRENT_PAYMENTS,
    private readonly waitMs = SLOT_WAIT_MS,
  ) {}

  get busy(): boolean {
    return this.inFlight >= this.max;
  }

  async acquire(): Promise<boolean> {
    if (this.inFlight < this.max) {
      this.inFlight += 1;
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = this.waiting.indexOf(wake);
        if (index >= 0) this.waiting.splice(index, 1);
        resolve(false);
      }, this.waitMs);
      timer.unref?.();

      const wake = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.inFlight += 1;
        resolve(true);
      };
      this.waiting.push(wake);
    });
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waiting.shift();
    if (next) next();
  }
}
