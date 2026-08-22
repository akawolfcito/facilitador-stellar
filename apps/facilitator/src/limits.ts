/**
 * Bounded request controls for a publicly reachable facilitator.
 *
 * ## Why these exist
 *
 * `/settle` submits a Stellar transaction signed by a funded key, and with fee
 * sponsorship on that key pays the network fee — about 0.0023 XLM per
 * settlement (E-19). A transaction that fails on-chain still burns it. So an
 * unauthenticated, unlimited `/settle` is an endpoint where a stranger spends
 * our money, and no amount of payload validation changes that: the cost is
 * incurred by *reaching submission*, not by succeeding.
 *
 * The controls here do not authenticate anyone. They bound how fast a single
 * source can spend, which is the difference between a risk and a budget.
 *
 * ## Why this is hand-written
 *
 * `@fastify/rate-limit` is the obvious choice and would be fine. It is not used
 * because this repository publishes a licence audit over its resolved runtime
 * graph, and a single-instance testnet preview does not need a plugin to count
 * to ten in a Map. If this ever needs to span instances, the right move is a
 * shared store, and that is the point to take the dependency.
 */

import { createHash } from "node:crypto";

/** What a route costs us, which is what decides how often it may be called. */
export type RouteClass = "settle" | "verify" | "search" | "resources" | "exempt";

export interface RateRule {
  /** Requests allowed per window, per client bucket. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export type RatePolicy = Record<Exclude<RouteClass, "exempt">, RateRule>;

const MINUTE = 60_000;

/**
 * Default policy, chosen from what the endpoints actually cost and from
 * observed legitimate traffic rather than from round numbers.
 *
 * - `settle` — 10/min. The upstream conformance suite settles **nine** payments
 *   in one run (E-18), so anything below ten would reject a legitimate
 *   reviewer running it against us. Ten also caps a single source at roughly
 *   0.023 XLM of sponsored fees per minute, which is a number an operator can
 *   fund against deliberately.
 * - `verify` — 60/min. Costs an RPC round trip and no money; a client may
 *   reasonably verify far more often than it settles.
 * - `search` — 30/min. Each query runs embedding inference, so this is a CPU
 *   bound, not an economic one.
 * - `resources` — 240/min. A paginated read straight out of SQLite.
 *
 * `/health` and `/supported` are exempt on purpose: a platform health check
 * that gets 429'd looks like an outage, and `/supported` is an RFP acceptance
 * criterion that must answer whenever the process is up.
 */
export const DEFAULT_RATE_POLICY: RatePolicy = {
  settle: { limit: 10, windowMs: MINUTE },
  verify: { limit: 60, windowMs: MINUTE },
  search: { limit: 30, windowMs: MINUTE },
  resources: { limit: 240, windowMs: MINUTE },
};

/**
 * Concurrent `/settle` submissions allowed across the whole process.
 *
 * Two reasons, and the second is the one that matters. It caps how much fee
 * spend can be in flight at once, and it stops many simultaneous submissions
 * from racing on the same signer's sequence number — the contention the
 * channel-account pattern exists to avoid. Four is above any demo's real
 * concurrency and well under the point where a single signer serialises.
 */
export const DEFAULT_SETTLE_MAX_INFLIGHT = 4;

/** Route classification. Anything unrecognised is treated as exempt. */
export function classify(method: string, url: string): RouteClass {
  const path = url.split("?")[0] ?? "";
  if (method === "POST" && path === "/settle") return "settle";
  if (method === "POST" && path === "/verify") return "verify";
  if (method === "GET" && path === "/discovery/search") return "search";
  if (method === "GET" && path === "/discovery/resources") return "resources";
  return "exempt";
}

/**
 * Collapse an address into the unit we limit on.
 *
 * IPv4 is limited per address. IPv6 is limited per /64, because a single client
 * is routinely handed one and could otherwise walk through billions of
 * addresses to reset its own counter. Limiting the /64 makes the cost of
 * evasion a new prefix rather than a new address.
 */
export function clientBucket(ip: string | undefined): string {
  if (!ip) return "unknown";
  const address = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (!address.includes(":")) return address;

  const hextets = address.split("%")[0]!.split(":");
  // Expanding "::" properly is unnecessary here: the leading groups are what a
  // /64 is made of, and a shortened address simply yields a shorter, still
  // stable key.
  return `${hextets.slice(0, 4).join(":")}::/64`;
}

/** Short, stable, non-reversible identifier for logs. */
export function bucketFingerprint(bucket: string): string {
  return createHash("sha256").update(bucket).digest("hex").slice(0, 12);
}

export interface RateDecision {
  allowed: boolean;
  /** Seconds until the window resets. Only meaningful when `allowed` is false. */
  retryAfter: number;
  limit: number;
  remaining: number;
}

/**
 * Fixed-window counter, per (bucket, route class).
 *
 * A fixed window admits a burst across a boundary — up to twice the limit in
 * one contiguous minute. That is acceptable here: the limit exists to bound
 * sustained spend, and the concurrency cap bounds the instantaneous case that a
 * boundary burst would otherwise reach.
 *
 * Memory is bounded by sweeping expired entries once the map grows past a
 * threshold, so a flood of distinct sources cannot grow it without limit.
 */
export class RateLimiter {
  private readonly counters = new Map<string, { count: number; resetAt: number }>();
  private readonly maxEntries: number;

  constructor(
    private readonly policy: RatePolicy = DEFAULT_RATE_POLICY,
    maxEntries = 20_000,
  ) {
    this.maxEntries = maxEntries;
  }

  /** @param now - Injectable clock, so window expiry is testable without waiting. */
  check(bucket: string, route: Exclude<RouteClass, "exempt">, now = Date.now()): RateDecision {
    const rule = this.policy[route];
    const key = `${route}:${bucket}`;

    const entry = this.counters.get(key);
    if (!entry || now >= entry.resetAt) {
      if (this.counters.size >= this.maxEntries) this.sweep(now);
      this.counters.set(key, { count: 1, resetAt: now + rule.windowMs });
      return { allowed: true, retryAfter: 0, limit: rule.limit, remaining: rule.limit - 1 };
    }

    entry.count += 1;
    if (entry.count > rule.limit) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        limit: rule.limit,
        remaining: 0,
      };
    }
    return {
      allowed: true,
      retryAfter: 0,
      limit: rule.limit,
      remaining: rule.limit - entry.count,
    };
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.counters) {
      if (now >= entry.resetAt) this.counters.delete(key);
    }
  }

  /** Test and diagnostic aid. */
  reset(): void {
    this.counters.clear();
  }
}

/**
 * A counting semaphore with no queue.
 *
 * Deliberately non-blocking: a caller that cannot get a slot is told the server
 * is busy rather than parked. Queueing would convert a fee-spend problem into a
 * latency problem and hide it.
 */
export class InflightLimiter {
  private active = 0;

  constructor(private readonly max: number) {}

  tryAcquire(): boolean {
    if (this.active >= this.max) return false;
    this.active += 1;
    return true;
  }

  release(): void {
    if (this.active > 0) this.active -= 1;
  }

  get inFlight(): number {
    return this.active;
  }
}

/**
 * Parse the `TRUST_PROXY` setting.
 *
 * Defaults to **false**: without a deliberate decision, the socket address is
 * the only thing that cannot be forged. On Railway the app is only reachable
 * through the platform's proxy, so `TRUST_PROXY=1` is correct there — one hop,
 * rather than `true`, so a client cannot prepend its own chain and be believed.
 *
 * The failure mode of the default is safe and visible: behind a proxy every
 * request appears to come from one address, so limits bind everyone together
 * and become *stricter*, never weaker.
 */
export function parseTrustProxy(raw: string | undefined): boolean | number {
  if (raw === undefined || raw.trim() === "") return false;
  const value = raw.trim().toLowerCase();
  if (value === "false" || value === "0") return false;
  if (value === "true") return true;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops > 0) return hops;
  return false;
}
