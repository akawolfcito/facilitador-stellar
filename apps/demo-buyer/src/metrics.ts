/**
 * What an operator needs to know, and nothing about who visited.
 *
 * No raw addresses anywhere: the limiter hashes buckets before anything stores
 * or reports them, and nothing here takes an address at all. No per-visitor
 * anything. The questions this answers are "is the demo working", "how much of
 * today is left" and "does the buyer need topping up".
 */

/** Closed set. A new outcome has to be added here to be counted at all. */
export const OUTCOMES = [
  "requested",
  "rate_limited",
  "budget_rejected",
  "balance_floor_rejected",
  "disabled_rejected",
  "invalid_request",
  "slot_timeout",
  "replayed",
  "live_terms_rejected",
  "seller_unavailable",
  "settlement_rejected",
  "uncertain",
  "settled",
] as const;

export type Outcome = (typeof OUTCOMES)[number];

export interface MetricsSnapshot {
  outcomes: Record<Outcome, number>;
  day: string;
  paymentsToday: number;
  unitsSpentToday: number;
  remainingPaymentsToday: number;
  remainingUnitsToday: number;
  buyerBalanceUnits: string | null;
  buyerBalanceCheckedAt: string | null;
  lastSettlementAt: string | null;
  lastTransaction: string | null;
  secondsSinceLastSettlement: number | null;
}

export class Metrics {
  private readonly counts: Record<Outcome, number> = Object.fromEntries(
    OUTCOMES.map((name) => [name, 0]),
  ) as Record<Outcome, number>;

  private buyerBalanceUnits: bigint | null = null;
  private buyerBalanceCheckedAt: number | null = null;
  private lastSettlementAt: number | null = null;
  private lastTransaction: string | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  record(outcome: Outcome): void {
    this.counts[outcome] += 1;
  }

  recordSettlement(transaction: string): void {
    this.lastSettlementAt = this.now();
    this.lastTransaction = transaction;
  }

  recordBalance(units: bigint | null): void {
    this.buyerBalanceUnits = units;
    this.buyerBalanceCheckedAt = this.now();
  }

  snapshot(budget: {
    day: string;
    paymentsToday: number;
    unitsSpentToday: number;
    remainingPayments: number;
    remainingUnits: number;
  }): MetricsSnapshot {
    return {
      outcomes: { ...this.counts },
      day: budget.day,
      paymentsToday: budget.paymentsToday,
      unitsSpentToday: budget.unitsSpentToday,
      remainingPaymentsToday: budget.remainingPayments,
      remainingUnitsToday: budget.remainingUnits,
      buyerBalanceUnits: this.buyerBalanceUnits?.toString() ?? null,
      buyerBalanceCheckedAt: this.buyerBalanceCheckedAt
        ? new Date(this.buyerBalanceCheckedAt).toISOString()
        : null,
      lastSettlementAt: this.lastSettlementAt
        ? new Date(this.lastSettlementAt).toISOString()
        : null,
      lastTransaction: this.lastTransaction,
      secondsSinceLastSettlement: this.lastSettlementAt
        ? Math.round((this.now() - this.lastSettlementAt) / 1000)
        : null,
    };
  }
}

/**
 * What to do when a number looks wrong. Written down because the person reading
 * a dashboard at an awkward hour is not necessarily the person who built it.
 */
export const ALERT_GUIDANCE = {
  uncertain:
    "One or more payments were signed with an unconfirmed outcome. Check the buyer's recent " +
    "operations on Horizon before doing anything. Do not replay the request: the spend is " +
    "already committed and a retry is how one uncertain payment becomes two.",
  buyerBalanceUnits:
    "Below the floor the service refuses before signing, which is safe but ends the demo. " +
    "Top the buyer up with canonical testnet USDC.",
  budget_rejected:
    "Today's budget is spent. This is the control working. It resets at 00:00 UTC. " +
    "Discovery, abstention, live 402 inspection and the recorded evidence are unaffected.",
  settlement_rejected:
    "A payment reached the chain and was refused. Check the seller's live terms and the " +
    "facilitator's health before assuming the buyer is at fault.",
} as const;
