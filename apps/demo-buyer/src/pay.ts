/**
 * The payment itself.
 *
 * Three steps, and the middle one is the only place a key is used:
 *
 *   read the seller's live 402 and check it is the demo, exactly;
 *   sign and retry, with the same check installed as an x402 client policy so
 *   the stock client cannot sign anything that check would have rejected;
 *   decode the receipt into a transaction hash.
 *
 * The buyer never talks to the facilitator. In this protocol it is the *seller*
 * that calls `/verify` and `/settle`, so this service holds no facilitator
 * credential and knows no facilitator URL. That is not an accident of the
 * implementation; it is why the blast radius of this service is its own float.
 *
 * Refusals carry a reason from a closed set and a sentence we wrote. Upstream
 * error text is logged and never returned, because an upstream error is the one
 * string most likely to contain something we did not mean to publish.
 */

import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import {
  DEMO_AMOUNT,
  DEMO_RESOURCE_URL,
  type Accepts,
  demoPaymentPolicy,
  validateLiveTerms,
} from "./invariants.js";

/** Longest product input accepted. Plain text, never a URL, never rendered. */
export const MAX_TEXT_LENGTH = 500;

/** Used when the caller sends no text. Deterministic, so the demo is repeatable. */
export const DEFAULT_TEXT =
  "the quick brown fox jumped over the lazy dog while the whole town watched in silence";

export type PayFailure =
  | "LIVE_TERMS_CHANGED"
  | "SELLER_UNAVAILABLE"
  | "SETTLEMENT_REJECTED"
  | "SETTLEMENT_STATE_UNCERTAIN";

export interface LiveTerms {
  network: string;
  scheme: string;
  asset: string;
  amount: string;
  payTo: string;
}

export type PayOutcome =
  | {
      ok: true;
      transaction: string;
      sellerStatus: number;
      sellerBody: unknown;
      terms: LiveTerms;
    }
  | {
      ok: false;
      reason: PayFailure;
      detail: string;
      /** True once a payment was signed. Governs whether spend may be released. */
      signed: boolean;
    };

interface PayDeps {
  fetch?: typeof fetch;
  log?: (record: Record<string, unknown>) => void;
}

interface DecodedRequired {
  x402Version?: number;
  resource?: { url?: string } | string;
  accepts?: Accepts[];
}

/** The 402 carries its terms in a base64 header, not in the body. */
function decodePaymentRequired(header: string): DecodedRequired {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as DecodedRequired;
}

function resourceUrlOf(decoded: DecodedRequired): string | undefined {
  if (typeof decoded.resource === "string") return decoded.resource;
  return decoded.resource?.url;
}

/**
 * Pre-flight: what is the seller asking for right now?
 *
 * Separate from signing so a mismatch costs nothing and produces a sentence a
 * visitor can read. The authoritative check is the policy, not this one.
 */
export async function readLiveTerms(
  deps: PayDeps = {},
): Promise<{ ok: true; terms: LiveTerms } | { ok: false; reason: PayFailure; detail: string }> {
  const doFetch = deps.fetch ?? fetch;

  let response: Response;
  try {
    response = await doFetch(DEMO_RESOURCE_URL, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    deps.log?.({ event: "seller_unreachable", error: String(error) });
    return { ok: false, reason: "SELLER_UNAVAILABLE", detail: "the hosted seller did not answer" };
  }

  if (response.status !== 402) {
    deps.log?.({ event: "seller_not_402", status: response.status });
    return {
      ok: false,
      reason: "SELLER_UNAVAILABLE",
      detail: "the hosted seller did not offer payment terms",
    };
  }

  const header = response.headers.get("payment-required");
  if (!header) {
    return { ok: false, reason: "LIVE_TERMS_CHANGED", detail: "the 402 carried no terms" };
  }

  let decoded: DecodedRequired;
  try {
    decoded = decodePaymentRequired(header);
  } catch {
    return { ok: false, reason: "LIVE_TERMS_CHANGED", detail: "the 402 terms could not be read" };
  }

  const verdict = validateLiveTerms(resourceUrlOf(decoded) ?? DEMO_RESOURCE_URL, decoded.accepts);
  if (!verdict.ok) {
    deps.log?.({ event: "live_terms_rejected", reason: verdict.reason });
    return {
      ok: false,
      reason: "LIVE_TERMS_CHANGED",
      detail: verdict.detail ?? "the seller's live terms are not the demo terms",
    };
  }

  const match = (decoded.accepts ?? []).find(
    (a) => a.amount !== undefined && BigInt(a.amount) === BigInt(DEMO_AMOUNT),
  )!;
  return {
    ok: true,
    terms: {
      network: match.network!,
      scheme: match.scheme!,
      asset: match.asset!,
      amount: match.amount!,
      payTo: match.payTo!,
    },
  };
}

/**
 * Sign the live terms and fetch the paid result.
 *
 * `wrapFetchWithPayment` re-reads the 402 itself, which is exactly why the
 * policy matters: if the seller's terms moved between `readLiveTerms` and here,
 * `demoPaymentPolicy` filters the options to empty and the client refuses on
 * its own rather than signing the new ones.
 *
 * Once this has been entered, `signed` is true in every failure path. The
 * caller uses that to decide whether the spend reservation may be released, and
 * the answer after signing is always no.
 */
export async function payForDemo(
  buyerSecret: string,
  network: `${string}:${string}`,
  text: string,
  deps: PayDeps = {},
): Promise<PayOutcome> {
  const doFetch = deps.fetch ?? fetch;

  const preflight = await readLiveTerms(deps);
  if (!preflight.ok) {
    return { ...preflight, signed: false };
  }

  const signer = createEd25519Signer(buyerSecret, network);
  const client = x402Client.fromConfig({
    schemes: [{ network, client: new ExactStellarScheme(signer) }],
    // The invariant. Applied to `accepts` immediately before a payment is
    // built, so nothing outside the approved demo can be signed even if the
    // pre-flight above has a bug or the seller changed its mind since.
    policies: [demoPaymentPolicy as never],
  });

  const url = new URL(DEMO_RESOURCE_URL);
  url.searchParams.set("text", text);

  const fetchWithPay = wrapFetchWithPayment(doFetch, client);

  let paid: Response;
  try {
    paid = await fetchWithPay(url.toString(), { signal: AbortSignal.timeout(45_000) });
  } catch (error) {
    // Anything can have happened here, including a settlement that succeeded
    // and a response we never saw. Never retried, never released.
    deps.log?.({ event: "payment_threw", error: String(error) });
    return {
      ok: false,
      reason: "SETTLEMENT_STATE_UNCERTAIN",
      detail: "the payment was attempted and its outcome is not confirmed",
      signed: true,
    };
  }

  if (!paid.ok) {
    deps.log?.({ event: "payment_rejected", status: paid.status });
    return {
      ok: false,
      // A non-2xx after signing is not proof nothing moved, so it stays
      // committed and is never retried.
      reason: paid.status === 402 ? "SETTLEMENT_REJECTED" : "SETTLEMENT_STATE_UNCERTAIN",
      detail:
        paid.status === 402
          ? "the payment was refused and nothing was delivered"
          : "the seller answered unexpectedly after payment",
      signed: true,
    };
  }

  const receipt = paid.headers.get("payment-response");
  const settlement = receipt ? decodePaymentResponseHeader(receipt) : undefined;
  const transaction = (settlement as { transaction?: string } | undefined)?.transaction;

  if (!transaction) {
    deps.log?.({ event: "payment_no_receipt", status: paid.status });
    return {
      ok: false,
      reason: "SETTLEMENT_STATE_UNCERTAIN",
      detail: "the seller answered but the settlement receipt was missing",
      signed: true,
    };
  }

  let sellerBody: unknown;
  try {
    sellerBody = await paid.json();
  } catch {
    sellerBody = undefined;
  }

  return {
    ok: true,
    transaction,
    sellerStatus: paid.status,
    sellerBody,
    terms: preflight.terms,
  };
}

/** Plain text, length-capped, no control characters. Never fetched, never rendered. */
export function sanitiseText(raw: unknown): { ok: true; text: string } | { ok: false; why: string } {
  if (raw === undefined || raw === null) return { ok: true, text: DEFAULT_TEXT };
  if (typeof raw !== "string") return { ok: false, why: "text must be a string" };

  const text = raw.trim();
  if (text === "") return { ok: true, text: DEFAULT_TEXT };
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, why: `text must be ${MAX_TEXT_LENGTH} characters or fewer` };
  }
  // eslint-disable-next-line no-control-regex
  // Control characters, including the C1 range, never appear in a sentence a
  // person typed and are the classic way to smuggle something through a log.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) {
    return { ok: false, why: "text must be plain text" };
  }
  return { ok: true, text };
}
