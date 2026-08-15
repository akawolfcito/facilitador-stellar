/**
 * The service surface: one payment route, two probes, one guarded metrics page.
 *
 * The route order is the risk order. Everything that can refuse for free is
 * checked before anything that costs: shape, then switch, then rate, then
 * idempotency, then budget, then balance, then the slot. Only after all of
 * those does a reservation get taken, and only after the reservation does a key
 * get used.
 *
 * Whatever fails, the answer is a reason from a closed set and a sentence we
 * wrote. Upstream text never reaches the browser.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { type DemoBuyerConfig } from "./config.js";
import { DEMO_AMOUNT, DEMO_RESOURCE_URL } from "./invariants.js";
import { IP_GUARD_MS, type SpendLedger } from "./ledger.js";
import {
  GLOBAL,
  PER_IP,
  PaymentSlot,
  RateLimiter,
  bucketFingerprint,
  clientBucket,
} from "./limits.js";
import { ALERT_GUIDANCE, Metrics } from "./metrics.js";
import { type PayOutcome, sanitiseText } from "./pay.js";

/** Every property the body may carry. Anything else is a 400, not a shrug. */
const ALLOWED_BODY_KEYS = new Set(["requestId", "text"]);

const AMOUNT_UNITS = Number(DEMO_AMOUNT);

export interface DemoBuyerDeps {
  /** Injected so tests never sign anything and never touch the network. */
  pay: (text: string) => Promise<PayOutcome>;
  /** Buyer's USDC balance in base units, or null when it cannot be read. */
  balance: () => Promise<bigint | null>;
  now?: () => number;
  log?: (record: Record<string, unknown>) => void;
}

/** The visitor-facing refusals. One sentence each, written here, not upstream. */
const REFUSALS = {
  INVALID_REQUEST: { status: 400, detail: "That request was not in the expected shape." },
  RATE_LIMITED: {
    status: 429,
    detail: "Too many demo payments from here. Try again shortly.",
  },
  DEMO_IN_FLIGHT: {
    status: 429,
    detail: "Another demo payment is settling. Try again in a moment.",
  },
  DEMO_BUDGET_EXHAUSTED: {
    status: 429,
    detail:
      "Today's demo budget is spent. It resets at 00:00 UTC. Live discovery, abstention and the recorded evidence still work.",
  },
  DEMO_DISABLED: { status: 503, detail: "Demo payments are switched off right now." },
  BUYER_BALANCE_LOW: { status: 503, detail: "The demo account needs topping up." },
  LIVE_TERMS_CHANGED: {
    status: 409,
    detail: "The seller's live terms are not the ones this demo may pay. Nothing was signed.",
  },
  SELLER_UNAVAILABLE: {
    status: 503,
    detail: "The hosted seller did not answer. Nothing was signed.",
  },
  SETTLEMENT_REJECTED: {
    status: 502,
    detail: "The payment was refused on chain. Nothing was delivered.",
  },
  SETTLEMENT_STATE_UNCERTAIN: {
    status: 502,
    detail: "The outcome is unconfirmed. It is being checked, and no retry was made.",
  },
} as const;

type RefusalCode = keyof typeof REFUSALS;

export function buildDemoBuyer(
  config: DemoBuyerConfig,
  ledger: SpendLedger,
  deps: DemoBuyerDeps,
): FastifyInstance {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((record) => console.log(JSON.stringify(record)));
  const metrics = new Metrics(now);
  const limiter = new RateLimiter(now);
  const slot = new PaymentSlot();

  const app = Fastify({
    logger: false,
    // A request body here is a short sentence. Two kilobytes is generous.
    bodyLimit: 2 * 1024,
    requestTimeout: 60_000,
    keepAliveTimeout: 30_000,
    // Private networking only, so the peer address is the peer address.
    trustProxy: false,
  });

  function refuse(reply: FastifyReply, code: RefusalCode, override?: string) {
    const { status, detail } = REFUSALS[code];
    return reply.code(status).send({ status: "refused", reason: code, detail: override ?? detail });
  }

  function budgetView() {
    const totals = ledger.totals();
    const remaining = ledger.remainingToday();
    return {
      day: totals.day,
      paymentsToday: totals.payments,
      unitsSpentToday: totals.committedUnits,
      remainingPayments: remaining.payments,
      remainingUnits: remaining.units,
    };
  }

  /**
   * A previous answer, replayed.
   *
   * Two ways in: the same `requestId` inside its window, or the same bucket
   * inside the double-click guard. The second is the one that actually catches
   * an impatient click, because that is the case where the client may not have
   * rotated its id.
   */
  function replayOf(
    requestId: string,
    bucket: string,
  ): { kind: "replay"; record: NonNullable<ReturnType<SpendLedger["find"]>> } | { kind: "inflight" } | undefined {
    for (const row of [ledger.find(requestId), ledger.recentForBucket(bucket)]) {
      if (!row) continue;
      // A row still `reserved` is a payment this visitor has in flight right
      // now. That is what a double click actually looks like: the first request
      // has not finished, so there is no stored answer to return yet. Letting it
      // through here and relying on the slot only serialises the duplicate; it
      // does not prevent it.
      if (row.status === "reserved") return { kind: "inflight" };
      return { kind: "replay", record: row };
    }
    return undefined;
  }

  app.post("/demo-payment", async (request: FastifyRequest, reply: FastifyReply) => {
    metrics.record("requested");

    // ---- shape, before anything else ------------------------------------
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body !== "object" || Array.isArray(body)) {
      metrics.record("invalid_request");
      return refuse(reply, "INVALID_REQUEST");
    }
    // An unknown property is refused rather than ignored, so a regression that
    // starts reading one fails loudly instead of quietly gaining a parameter.
    for (const key of Object.keys(body)) {
      if (!ALLOWED_BODY_KEYS.has(key)) {
        metrics.record("invalid_request");
        log({ event: "unexpected_body_key", key });
        return refuse(
          reply,
          "INVALID_REQUEST",
          `This demo takes no payment parameters. "${key}" is not accepted.`,
        );
      }
    }

    const text = sanitiseText(body.text);
    if (!text.ok) {
      metrics.record("invalid_request");
      return refuse(reply, "INVALID_REQUEST", text.why);
    }

    const requestId =
      typeof body.requestId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.requestId)
        ? body.requestId
        : `srv-${now()}-${Math.random().toString(36).slice(2, 10)}`;

    const bucket = bucketFingerprint(clientBucket(request.ip));

    // ---- the switch -----------------------------------------------------
    if (!config.enabled) {
      metrics.record("disabled_rejected");
      return refuse(reply, "DEMO_DISABLED");
    }

    // ---- already answered? ----------------------------------------------
    const previous = replayOf(requestId, bucket);
    if (previous?.kind === "inflight") {
      metrics.record("replayed");
      return refuse(reply, "DEMO_IN_FLIGHT");
    }
    if (previous?.kind === "replay") {
      metrics.record("replayed");
      const { record } = previous;
      const stored = record.responseJson ? JSON.parse(record.responseJson) : undefined;
      if (record.status === "settled" && stored) {
        return reply.code(200).send({ ...stored, replayed: true });
      }
      return refuse(
        reply,
        record.status === "uncertain" ? "SETTLEMENT_STATE_UNCERTAIN" : "INVALID_REQUEST",
      );
    }

    // ---- rate ------------------------------------------------------------
    const perIp = limiter.check(`ip:${bucket}`, PER_IP);
    if (!perIp.allowed) {
      metrics.record("rate_limited");
      return reply
        .code(429)
        .header("retry-after", String(perIp.retryAfterSeconds))
        .send({ status: "refused", reason: "RATE_LIMITED", detail: REFUSALS.RATE_LIMITED.detail });
    }
    const global = limiter.check("global", GLOBAL);
    if (!global.allowed) {
      limiter.refund(`ip:${bucket}`);
      metrics.record("rate_limited");
      return reply
        .code(429)
        .header("retry-after", String(global.retryAfterSeconds))
        .send({ status: "refused", reason: "RATE_LIMITED", detail: REFUSALS.RATE_LIMITED.detail });
    }

    // ---- balance, before the budget is touched ---------------------------
    const balance = await deps.balance();
    metrics.recordBalance(balance);
    if (balance !== null && balance < config.balanceFloorUnits) {
      limiter.refund(`ip:${bucket}`);
      metrics.record("balance_floor_rejected");
      log({ event: "balance_floor", guidance: ALERT_GUIDANCE.buyerBalanceUnits });
      return refuse(reply, "BUYER_BALANCE_LOW");
    }

    // ---- one at a time ---------------------------------------------------
    if (!(await slot.acquire())) {
      limiter.refund(`ip:${bucket}`);
      metrics.record("slot_timeout");
      return refuse(reply, "DEMO_IN_FLIGHT");
    }

    try {
      // ---- take the money out of the budget, then sign -------------------
      const reservation = ledger.reserve(requestId, bucket, AMOUNT_UNITS);
      if (!reservation.ok) {
        limiter.refund(`ip:${bucket}`);
        metrics.record("budget_rejected");
        log({ event: "budget_exhausted", day: reservation.day, guidance: ALERT_GUIDANCE.budget_rejected });
        return refuse(reply, "DEMO_BUDGET_EXHAUSTED");
      }

      const outcome = await deps.pay(text.text);

      if (!outcome.ok) {
        // Released only when nothing was signed. After signing the money may be
        // gone, and handing the budget back is how one payment becomes two.
        if (!outcome.signed) {
          ledger.release(requestId, outcome.reason);
        } else {
          ledger.finish(requestId, "uncertain", { response: { reason: outcome.reason } });
          log({ event: "uncertain_settlement", requestId, guidance: ALERT_GUIDANCE.uncertain });
        }
        metrics.record(
          outcome.reason === "LIVE_TERMS_CHANGED"
            ? "live_terms_rejected"
            : outcome.reason === "SELLER_UNAVAILABLE"
              ? "seller_unavailable"
              : outcome.reason === "SETTLEMENT_REJECTED"
                ? "settlement_rejected"
                : "uncertain",
        );
        return refuse(reply, outcome.reason);
      }

      const remaining = ledger.remainingToday();
      const payload = {
        status: "settled",
        payer: "x402seek-demo-buyer",
        amount: outcome.terms.amount,
        amountDisplay: "0.001 USDC",
        network: outcome.terms.network,
        resource: DEMO_RESOURCE_URL,
        transaction: outcome.transaction,
        explorer: `https://stellar.expert/explorer/testnet/tx/${outcome.transaction}`,
        seller: { status: outcome.sellerStatus, result: outcome.sellerBody },
        budget: { remainingToday: remaining.payments },
      };

      ledger.finish(requestId, "settled", {
        txHash: outcome.transaction,
        sellerStatus: outcome.sellerStatus,
        response: payload,
      });
      metrics.record("settled");
      metrics.recordSettlement(outcome.transaction);
      log({ event: "demo_payment_settled", requestId, transaction: outcome.transaction });

      return reply.code(200).send(payload);
    } finally {
      slot.release();
      limiter.sweep();
    }
  });

  /** Liveness. Carries no secret and no budget detail a stranger could mine. */
  app.get("/health", async () => ({
    status: "ok",
    service: "x402seek-demo-buyer",
    network: config.network,
    enabled: config.enabled,
  }));

  /** Readiness: can this service actually pay right now? */
  app.get("/ready", async (_request, reply) => {
    const remaining = ledger.remainingToday();
    const ready = config.enabled && remaining.payments > 0 && remaining.units >= AMOUNT_UNITS;
    if (!ready) {
      return reply.code(503).send({
        ready: false,
        error: config.enabled ? "DEMO_BUDGET_EXHAUSTED" : "DEMO_DISABLED",
      });
    }
    return { ready: true, remainingToday: remaining.payments };
  });

  if (config.metricsToken) {
    app.get("/internal/metrics", async (request, reply) => {
      const offered = request.headers.authorization;
      if (offered !== `Bearer ${config.metricsToken}`) {
        return reply.code(404).send({ error: "Not Found" });
      }
      return { ...metrics.snapshot(budgetView()), guidance: ALERT_GUIDANCE, idempotencyMs: IP_GUARD_MS };
    });
  }

  return app;
}
