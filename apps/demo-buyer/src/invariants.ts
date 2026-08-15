/**
 * The one thing this service is allowed to pay for.
 *
 * Everything else in `apps/demo-buyer` is plumbing around this file. The demo
 * buyer holds a funded testnet key and answers anonymous requests, so the
 * property that has to hold is not "we validate carefully" but "it cannot sign
 * anything else". Validation you can forget to call; a filter installed at the
 * signing boundary you cannot.
 *
 * Hence two consumers of the same predicate:
 *
 *   `validateLiveTerms` runs pre-flight, against the 402 we fetched ourselves,
 *   so a mismatch refuses with a reason a person can read;
 *   `demoPaymentPolicy` is handed to `x402Client` as a policy, so the stock
 *   client filters `accepts` through it immediately before signing. If the
 *   seller's terms moved between the two reads, the filter returns empty and
 *   the client refuses on its own.
 *
 * The second one is the invariant. The first one is the error message.
 *
 * Nothing here takes a signer, a secret or a request body, which is what keeps
 * it reusable for a future user-wallet flow: same authority, different signer.
 */

/** Canonical testnet USDC. The asset every recorded settlement used. */
export const DEMO_ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/** The hosted seller that receives the payment. A public `G…` address, not a key. */
export const DEMO_PAY_TO = "GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK";

export const DEMO_NETWORK = "stellar:testnet";
export const DEMO_SCHEME = "exact";

/** Exactly this. Not a ceiling with room underneath: the demo costs what it costs. */
export const DEMO_AMOUNT = "10000";

export const DEMO_RESOURCE_HOST = "demo-api.testnet.x402seek.xyz";
export const DEMO_RESOURCE_PATH = "/summarize";
export const DEMO_RESOURCE_URL = `https://${DEMO_RESOURCE_HOST}${DEMO_RESOURCE_PATH}`;

/** One payment option as it appears in a 402's `accepts` array. */
export interface Accepts {
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
}

export type RejectionReason =
  | "WRONG_NETWORK"
  | "WRONG_SCHEME"
  | "WRONG_ASSET"
  | "WRONG_PAY_TO"
  | "WRONG_AMOUNT"
  | "WRONG_RESOURCE"
  | "NO_ACCEPTS";

export interface TermsVerdict {
  ok: boolean;
  reason?: RejectionReason;
  /** Safe to show a visitor: names the field, never echoes upstream text. */
  detail?: string;
}

/**
 * Is this single option the demo, exactly?
 *
 * Amounts are compared as BigInt. `"10000"`, `"010000"` and `10000` are the
 * same number and different strings, and a string comparison here would be a
 * bypass rather than a check.
 */
export function isDemoTerms(accepts: Accepts | undefined): boolean {
  if (!accepts) return false;
  if (accepts.network !== DEMO_NETWORK) return false;
  if (accepts.scheme !== DEMO_SCHEME) return false;
  if (accepts.asset !== DEMO_ASSET) return false;
  if (accepts.payTo !== DEMO_PAY_TO) return false;
  return isDemoAmount(accepts.amount);
}

function isDemoAmount(amount: string | undefined): boolean {
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) return false;
  try {
    return BigInt(amount) === BigInt(DEMO_AMOUNT);
  } catch {
    return false;
  }
}

/** Same URL, said the same way. Case and default ports normalised, nothing else. */
export function isDemoResource(url: string | undefined): boolean {
  if (typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname.toLowerCase() === DEMO_RESOURCE_HOST &&
    parsed.pathname === DEMO_RESOURCE_PATH &&
    parsed.search === "" &&
    parsed.username === "" &&
    parsed.password === ""
  );
}

/**
 * The pre-flight check, with a reason attached.
 *
 * Reports the first thing that is wrong rather than a list, because a visitor
 * gets one sentence and an operator gets the log.
 */
export function validateLiveTerms(
  resourceUrl: string | undefined,
  accepts: Accepts[] | undefined,
): TermsVerdict {
  if (!isDemoResource(resourceUrl)) {
    return { ok: false, reason: "WRONG_RESOURCE", detail: "the 402 named a different resource" };
  }
  if (!Array.isArray(accepts) || accepts.length === 0) {
    return { ok: false, reason: "NO_ACCEPTS", detail: "the 402 offered no payment options" };
  }

  const match = accepts.find(isDemoTerms);
  if (match) return { ok: true };

  // Nothing matched. Name the first divergence on the first option, which is
  // the one a seller would have changed.
  const first = accepts[0] ?? {};
  if (first.network !== DEMO_NETWORK) {
    return { ok: false, reason: "WRONG_NETWORK", detail: "the seller asked for a different network" };
  }
  if (first.scheme !== DEMO_SCHEME) {
    return { ok: false, reason: "WRONG_SCHEME", detail: "the seller asked for a different scheme" };
  }
  if (first.asset !== DEMO_ASSET) {
    return { ok: false, reason: "WRONG_ASSET", detail: "the seller asked for a different asset" };
  }
  if (first.payTo !== DEMO_PAY_TO) {
    return { ok: false, reason: "WRONG_PAY_TO", detail: "the seller asked to be paid at a different address" };
  }
  return { ok: false, reason: "WRONG_AMOUNT", detail: "the seller's price is not the demo price" };
}

/**
 * The signing boundary.
 *
 * Handed to `x402Client` as a policy. The client applies it to `accepts`
 * immediately before building a payment, so an option that does not survive
 * this filter is never signed. An empty result makes the client refuse without
 * this service having to decide anything.
 *
 * Shaped to match the policy signature `@x402/core` expects: version first,
 * options second. The version is ignored on purpose. A future x402 version that
 * changed the meaning of these fields should fail closed here, not be waved
 * through by a check that trusted the number.
 */
export function demoPaymentPolicy(_x402Version: number, accepts: Accepts[]): Accepts[] {
  if (!Array.isArray(accepts)) return [];
  return accepts.filter(isDemoTerms);
}
