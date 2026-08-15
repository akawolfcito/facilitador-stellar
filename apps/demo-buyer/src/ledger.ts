/**
 * The spend ledger.
 *
 * Two jobs, and both of them are about what survives a restart: how much of
 * today's budget is gone, and whether this exact request has already been paid
 * for. An in-memory counter would reset the day's budget every deploy, which on
 * a service that redeploys on every push is not a budget at all.
 *
 * The shape that matters is **reserve, then commit**. A reservation is written
 * and the day's counter incremented in one transaction *before* anything is
 * signed. If the process dies between signing and receipt, the restart sees the
 * spend already counted. That can only ever under-spend the budget, never over,
 * and under-spending a demo budget costs nothing.
 *
 * Not an accounting system. Two tables, a 48 hour prune, and no history beyond
 * what the controls and the metrics endpoint actually read.
 */

import Database from "better-sqlite3";

/** Idempotency window. Long enough to cover a reload, short enough to let a
 *  reviewer come back later and genuinely pay again. */
export const REQUEST_WINDOW_MS = 10 * 60 * 1000;

/** What a double click looks like, when the client did not rotate its id. */
export const IP_GUARD_MS = 30 * 1000;

/** Rows older than this are gone. `day_spend` outlives them, for the metrics. */
const REQUEST_TTL_MS = 48 * 60 * 60 * 1000;
const DAY_TTL_DAYS = 30;

export type RequestStatus = "reserved" | "settled" | "refused" | "uncertain";

export interface LedgerRecord {
  requestId: string;
  createdAt: string;
  ipBucket: string;
  status: RequestStatus;
  amountUnits: number | null;
  txHash: string | null;
  sellerStatus: number | null;
  responseJson: string | null;
}

export interface DayTotals {
  day: string;
  committedUnits: number;
  payments: number;
}

export interface BudgetPolicy {
  /** Successful or committed payments allowed per UTC calendar day. */
  maxPaymentsPerDay: number;
  /** Committed spend allowed per UTC calendar day, in base units. */
  maxUnitsPerDay: number;
}

export type ReservationOutcome =
  | { ok: true; day: string }
  | { ok: false; reason: "DEMO_BUDGET_EXHAUSTED"; day: string; totals: DayTotals };

/** UTC calendar day. Not a rolling window: an operator can predict midnight. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export class SpendLedger {
  private readonly db: Database.Database;

  constructor(
    path: string,
    private readonly policy: BudgetPolicy,
    private readonly now: () => number = Date.now,
  ) {
    this.db = new Database(path);
    // The budget must survive a hard kill, not just a clean shutdown.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS day_spend (
        day             TEXT PRIMARY KEY,
        committed_units INTEGER NOT NULL DEFAULT 0,
        payments        INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS requests (
        request_id    TEXT PRIMARY KEY,
        created_at    TEXT NOT NULL,
        created_ms    INTEGER NOT NULL,
        ip_bucket     TEXT NOT NULL,
        status        TEXT NOT NULL,
        amount_units  INTEGER,
        tx_hash       TEXT,
        seller_status INTEGER,
        response_json TEXT
      );
      CREATE INDEX IF NOT EXISTS requests_by_bucket ON requests (ip_bucket, created_ms);
    `);
  }

  totals(day: string = utcDay(new Date(this.now()))): DayTotals {
    const row = this.db
      .prepare("SELECT committed_units, payments FROM day_spend WHERE day = ?")
      .get(day) as { committed_units: number; payments: number } | undefined;
    return {
      day,
      committedUnits: row?.committed_units ?? 0,
      payments: row?.payments ?? 0,
    };
  }

  remainingToday(): { payments: number; units: number } {
    const t = this.totals();
    return {
      payments: Math.max(0, this.policy.maxPaymentsPerDay - t.payments),
      units: Math.max(0, this.policy.maxUnitsPerDay - t.committedUnits),
    };
  }

  /** A previous answer for this id, if it is still inside the window. */
  find(requestId: string): LedgerRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM requests WHERE request_id = ?")
      .get(requestId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    if (this.now() - (row.created_ms as number) > REQUEST_WINDOW_MS) return undefined;
    return toRecord(row);
  }

  /** The most recent request from this bucket, for the double-click guard. */
  recentForBucket(ipBucket: string): LedgerRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM requests WHERE ip_bucket = ? AND created_ms >= ? ORDER BY created_ms DESC LIMIT 1",
      )
      .get(ipBucket, this.now() - IP_GUARD_MS) as Record<string, unknown> | undefined;
    return row ? toRecord(row) : undefined;
  }

  /**
   * Take the money out of today's budget before anything is signed.
   *
   * One transaction, so a crash cannot leave a request row without the matching
   * increment. Both limits are checked; whichever binds first wins.
   */
  reserve(requestId: string, ipBucket: string, amountUnits: number): ReservationOutcome {
    const at = this.now();
    const day = utcDay(new Date(at));

    const run = this.db.transaction((): ReservationOutcome => {
      this.db
        .prepare("INSERT OR IGNORE INTO day_spend (day, committed_units, payments) VALUES (?, 0, 0)")
        .run(day);
      const totals = this.totals(day);

      if (
        totals.payments + 1 > this.policy.maxPaymentsPerDay ||
        totals.committedUnits + amountUnits > this.policy.maxUnitsPerDay
      ) {
        return { ok: false, reason: "DEMO_BUDGET_EXHAUSTED", day, totals };
      }

      this.db
        .prepare("UPDATE day_spend SET committed_units = committed_units + ?, payments = payments + 1 WHERE day = ?")
        .run(amountUnits, day);
      this.db
        .prepare(
          `INSERT INTO requests (request_id, created_at, created_ms, ip_bucket, status, amount_units)
           VALUES (?, ?, ?, ?, 'reserved', ?)`,
        )
        .run(requestId, new Date(at).toISOString(), at, ipBucket, amountUnits);
      return { ok: true, day };
    });

    return run();
  }

  /**
   * Give the budget back. Only ever called for a refusal that happened *before*
   * signing, which is the only case where we know for certain nothing moved.
   */
  release(requestId: string, detail: string): void {
    const row = this.db
      .prepare("SELECT amount_units, created_ms, status FROM requests WHERE request_id = ?")
      .get(requestId) as { amount_units: number; created_ms: number; status: string } | undefined;
    if (!row || row.status !== "reserved") return;

    const day = utcDay(new Date(row.created_ms));
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE day_spend SET committed_units = MAX(0, committed_units - ?), payments = MAX(0, payments - 1) WHERE day = ?",
        )
        .run(row.amount_units, day);
      this.db
        .prepare("UPDATE requests SET status = 'refused', response_json = ? WHERE request_id = ?")
        .run(JSON.stringify({ detail }), requestId);
    })();
  }

  /** Settle or mark uncertain. Either way the reservation stays committed. */
  finish(
    requestId: string,
    status: Exclude<RequestStatus, "reserved" | "refused">,
    detail: { txHash?: string; sellerStatus?: number; response?: unknown },
  ): void {
    this.db
      .prepare(
        "UPDATE requests SET status = ?, tx_hash = ?, seller_status = ?, response_json = ? WHERE request_id = ?",
      )
      .run(
        status,
        detail.txHash ?? null,
        detail.sellerStatus ?? null,
        detail.response === undefined ? null : JSON.stringify(detail.response),
        requestId,
      );
  }

  prune(): void {
    this.db
      .prepare("DELETE FROM requests WHERE created_ms < ?")
      .run(this.now() - REQUEST_TTL_MS);
    this.db
      .prepare("DELETE FROM day_spend WHERE day < ?")
      .run(utcDay(new Date(this.now() - DAY_TTL_DAYS * 86_400_000)));
  }

  close(): void {
    this.db.close();
  }
}

function toRecord(row: Record<string, unknown>): LedgerRecord {
  return {
    requestId: row.request_id as string,
    createdAt: row.created_at as string,
    ipBucket: row.ip_bucket as string,
    status: row.status as RequestStatus,
    amountUnits: (row.amount_units as number | null) ?? null,
    txHash: (row.tx_hash as string | null) ?? null,
    sellerStatus: (row.seller_status as number | null) ?? null,
    responseJson: (row.response_json as string | null) ?? null,
  };
}
