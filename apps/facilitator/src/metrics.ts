/**
 * In-process operational metrics for a publicly reachable facilitator.
 *
 * The metric that matters is sponsored fee spend. Everything else tells you the
 * service is alive; that one tells you whether someone is spending your money.
 *
 * ## What can honestly be known about the fee
 *
 * `SettleResponse` (`@x402/core`) carries `success`, `errorReason`, `payer`,
 * `transaction` and `network`. **There is no fee field.** `@x402/stellar`'s
 * `pollForTransaction` does fetch the transaction result from RPC, but returns
 * only `{ success }` — the `feeCharged` in that result is discarded before it
 * reaches us.
 *
 * So the fee is not in anything handed to us, but it *is* on chain. This module
 * therefore looks it up itself, off the response path, and keeps two numbers
 * strictly apart:
 *
 * - `observedFeeStroops` — summed from `feeCharged` on transactions the chain
 *   confirmed. Exact.
 * - `settlementsWithUnknownFee` — settlements whose fee we could not read.
 *
 * An estimate is offered separately and never added to the observed total.
 * Blending them would produce a number that looks precise and is not, which is
 * the one thing this project does not do with measurements.
 *
 * No vendor, no collector, no persistence: counters reset when the process
 * does, and `uptimeSeconds` says how long that has been.
 */

/**
 * Operational reason codes.
 *
 * Deliberately coarse and closed. Metric labels must be a small fixed set —
 * raw error strings would be unbounded cardinality and would leak payload
 * detail into what is supposed to be an aggregate.
 *
 * Only distinctions the implementation can actually determine appear here. We
 * do not, for example, separate WRONG_ASSET from WRONG_AMOUNT: the scheme
 * reports both through `errorReason` strings we do not control, so claiming to
 * tell them apart would be inventing precision.
 */
export const REASONS = [
  "RATE_LIMIT",
  "SETTLE_CONCURRENCY_LIMIT",
  "INVALID_BODY",
  "INVALID_PAYMENT",
  "SUBMISSION_FAILURE",
  "RPC_FAILURE",
  "CATALOG_CONFLICT",
  "INDEX_NOT_READY",
  "UNKNOWN",
] as const;

export type Reason = (typeof REASONS)[number];

/**
 * Map an upstream `errorReason` onto our closed set.
 *
 * Upstream strings are not ours to depend on, so anything unrecognised becomes
 * `INVALID_PAYMENT` when a payment was rejected and `UNKNOWN` otherwise —
 * never the raw string.
 */
export function classifySettleError(errorReason: string | undefined): Reason {
  if (!errorReason) return "UNKNOWN";
  const reason = errorReason.toLowerCase();
  if (reason.includes("rpc") || reason.includes("network_error")) return "RPC_FAILURE";
  if (reason.includes("submit") || reason.includes("submission")) return "SUBMISSION_FAILURE";
  return "INVALID_PAYMENT";
}

/** 1 XLM = 10^7 stroops. */
const STROOPS_PER_XLM = 10_000_000n;

/**
 * Mean fee observed across the nine-payment USDC run (E-19): 0.0206757 XLM
 * over nine settlements. Used only to express what unknown spend *might* have
 * been, never to inflate the observed figure.
 */
export const MEAN_FEE_STROOPS = 22_973n;

export interface MetricsSnapshot {
  uptimeSeconds: number;
  http: Record<string, number>;
  rejections: Partial<Record<Reason, number>>;
  stellar: {
    settlementsSucceeded: number;
    submissionsFailed: number;
    /** Exact, summed from on-chain `feeCharged`. */
    sponsorshipObservedStroops: string;
    sponsorshipObservedXlm: string;
    /** Settlements whose fee could not be read. Not estimated into the total. */
    settlementsWithUnknownFee: number;
    /** What the unknown ones plausibly cost, kept separate on purpose. */
    sponsorshipUnknownEstimatedXlm: string;
    feeAccounting: "exact" | "partial" | "none";
    lastSettlementSuccessAt: string | null;
    lastSettlementFailureAt: string | null;
    settlementsInFlight: number;
  };
  catalog: {
    listings: number;
    writesSucceeded: number;
    writesFailed: number;
  };
  search: {
    status: string;
    indexed: number;
    syncSucceeded: number;
    syncFailed: number;
    abstentions: number;
    notReady: number;
  };
}

export class Metrics {
  private readonly startedAt = Date.now();
  private readonly http = new Map<string, number>();
  private readonly rejections = new Map<Reason, number>();

  settlementsSucceeded = 0;
  submissionsFailed = 0;
  settlementsWithUnknownFee = 0;
  private observedFeeStroops = 0n;
  lastSettlementSuccessAt: string | null = null;
  lastSettlementFailureAt: string | null = null;

  catalogWritesSucceeded = 0;
  catalogWritesFailed = 0;

  searchSyncSucceeded = 0;
  searchSyncFailed = 0;
  searchAbstentions = 0;
  searchNotReady = 0;

  /** Count a request or outcome. Names are fixed strings, never user input. */
  count(name: string, by = 1): void {
    this.http.set(name, (this.http.get(name) ?? 0) + by);
  }

  reject(reason: Reason): void {
    this.rejections.set(reason, (this.rejections.get(reason) ?? 0) + 1);
  }

  /**
   * Record a fee read from the chain.
   *
   * @param stroops - `feeCharged` from the transaction result, or `undefined`
   *   when it could not be read — in which case the settlement is counted as
   *   unknown rather than assumed to be average.
   */
  recordFee(stroops: bigint | undefined): void {
    if (stroops === undefined) {
      this.settlementsWithUnknownFee += 1;
      return;
    }
    this.observedFeeStroops += stroops;
  }

  private static toXlm(stroops: bigint): string {
    const whole = stroops / STROOPS_PER_XLM;
    const fraction = (stroops % STROOPS_PER_XLM).toString().padStart(7, "0");
    return `${whole}.${fraction}`;
  }

  private feeAccounting(): "exact" | "partial" | "none" {
    if (this.settlementsSucceeded === 0) return "none";
    return this.settlementsWithUnknownFee === 0 ? "exact" : "partial";
  }

  snapshot(live: {
    catalogListings: number;
    searchStatus: string;
    searchIndexed: number;
    settlementsInFlight: number;
  }): MetricsSnapshot {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      http: Object.fromEntries([...this.http].sort()),
      rejections: Object.fromEntries([...this.rejections].sort()) as Partial<
        Record<Reason, number>
      >,
      stellar: {
        settlementsSucceeded: this.settlementsSucceeded,
        submissionsFailed: this.submissionsFailed,
        sponsorshipObservedStroops: this.observedFeeStroops.toString(),
        sponsorshipObservedXlm: Metrics.toXlm(this.observedFeeStroops),
        settlementsWithUnknownFee: this.settlementsWithUnknownFee,
        sponsorshipUnknownEstimatedXlm: Metrics.toXlm(
          BigInt(this.settlementsWithUnknownFee) * MEAN_FEE_STROOPS,
        ),
        feeAccounting: this.feeAccounting(),
        lastSettlementSuccessAt: this.lastSettlementSuccessAt,
        lastSettlementFailureAt: this.lastSettlementFailureAt,
        settlementsInFlight: live.settlementsInFlight,
      },
      catalog: {
        listings: live.catalogListings,
        writesSucceeded: this.catalogWritesSucceeded,
        writesFailed: this.catalogWritesFailed,
      },
      search: {
        status: live.searchStatus,
        indexed: live.searchIndexed,
        syncSucceeded: this.searchSyncSucceeded,
        syncFailed: this.searchSyncFailed,
        abstentions: this.searchAbstentions,
        notReady: this.searchNotReady,
      },
    };
  }
}

/**
 * Read `feeCharged` for a settled transaction.
 *
 * Runs off the response path — the settlement has already been answered — for
 * the same reason index maintenance does: a seller must not wait on our
 * bookkeeping.
 *
 * Returns `undefined` rather than a guess whenever the lookup or the decode
 * fails, so an unreadable fee shows up as "unknown" instead of quietly
 * becoming an average.
 */
export async function readFeeCharged(
  server: { getTransaction(hash: string): Promise<unknown> },
  hash: string,
): Promise<bigint | undefined> {
  try {
    const result = (await server.getTransaction(hash)) as {
      resultXdr?: { feeCharged?: () => unknown };
    };
    const raw = result?.resultXdr?.feeCharged?.();
    if (raw === undefined || raw === null) return undefined;
    // stellar-sdk hands back an Int64-like; every representation it uses
    // stringifies to digits, and anything that does not is not a fee.
    const text = String(typeof raw === "object" && raw !== null ? raw.toString() : raw);
    if (!/^\d+$/.test(text)) return undefined;
    return BigInt(text);
  } catch {
    return undefined;
  }
}

/**
 * Recommended operator thresholds for a public testnet preview.
 *
 * Documentation, not behaviour: nothing in this process acts on them. They are
 * here rather than in a runbook so they sit beside the counters they describe
 * and are revised when those change.
 *
 * Derived from the measured mean fee (0.0022973 XLM, E-19) and the shipped
 * `/settle` policy of 10 per minute per IP.
 */
export const ALERT_GUIDANCE = {
  /**
   * One source at the rate limit spends ~0.023 XLM/min, so ~0.115 XLM in five
   * minutes. Alert above roughly four times that: it means several sources are
   * sustaining the limit at once, which no demo does.
   */
  sponsorshipXlmPer5Min: 0.5,
  /** Sustained failures mean money burned for nothing — fees apply either way. */
  submissionFailureRatio: 0.25,
  /** Below this the signer cannot sponsor much longer. Refill, do not ignore. */
  signerXlmBalanceFloor: 5,
  /** Discovery down while payments work is degraded, not broken — but visible. */
  discoveryFailedForMinutes: 5,
  /** Repeated capacity shedding means the cap is wrong or an attack is running. */
  concurrencyRejectionsPer5Min: 50,
  /** Many sources hitting the limit at once is the signature of a flood. */
  rateLimitRejectionsPer5Min: 500,
} as const;
