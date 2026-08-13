/**
 * The failure vocabulary of the MCP adapter.
 *
 * Every rejection carries one of these codes and a human sentence. RFP §3.3
 * requires structured, deterministic outputs with machine-readable error codes
 * and a non-null reason on every rejection, so an agent can branch on failure
 * instead of pattern-matching prose.
 *
 * Messages are written for an agent, not a debugger: no stack traces, no SQL,
 * no filesystem paths, no key material, no internal host names beyond the
 * endpoint the caller already discovered.
 */

export type McpErrorCode =
  /** Search ran and the catalog holds nothing matching. */
  | "NO_MATCH"
  /** Search ran; the best candidate scored below the abstention threshold. */
  | "BELOW_RELEVANCE_THRESHOLD"
  /** The caller named a resource that is not in the catalog, or is not an MCP tool. */
  | "INVALID_RESOURCE"
  /** The live 402 disagrees with the catalog on terms that matter. */
  | "PAYMENT_REQUIREMENTS_CHANGED"
  /** The live price exceeds the caller's stated ceiling. */
  | "PRICE_EXCEEDS_LIMIT"
  | "UNSUPPORTED_NETWORK"
  | "UNSUPPORTED_ASSET"
  /** Building or signing the payment failed before anything settled. */
  | "PAYMENT_FAILED"
  /** The facilitator accepted the payment but settlement did not complete. */
  | "SETTLEMENT_FAILED"
  /** Payment settled; the tool then failed. Money moved. See `paid` in the result. */
  | "TOOL_INVOCATION_FAILED"
  /** The catalog could not be reached. */
  | "DISCOVERY_UNAVAILABLE";

export interface McpFailure {
  ok: false;
  code: McpErrorCode;
  reason: string;
  /**
   * True when funds moved before the failure.
   *
   * x402 offers no atomicity across settlement and invocation, and pretending
   * otherwise would be the most dangerous thing this adapter could do. When a
   * payment settles and the tool then fails, the caller is told plainly, with
   * the transaction hash, so it can decide whether to retry or claim.
   */
  paid?: { transaction: string; amount: string; asset: string; network: string };
}

export function failure(
  code: McpErrorCode,
  reason: string,
  paid?: McpFailure["paid"],
): McpFailure {
  return { ok: false, code, reason, ...(paid ? { paid } : {}) };
}

/**
 * Reduce an unknown thrown value to a safe sentence.
 *
 * Anything that reaches an agent has to be free of internals; an `Error.message`
 * from a database driver or an RPC client is not. Only the first line is kept,
 * it is length-capped, and anything resembling a path, a URL credential or a
 * Stellar secret is dropped rather than trimmed.
 */
export function safeReason(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const firstLine = error.message.split("\n")[0] ?? "";
  const looksSensitive =
    /(\/[\w.-]+){2,}/.test(firstLine) || // filesystem-ish path
    // A Stellar secret is exactly `S` + 55 base32 characters, but anchoring on
    // that exact length is the wrong instinct for redaction: a token one
    // character too long is not safer to print, and `\b` at the end lets it
    // through. Match any long base32-ish run instead and err toward dropping.
    /S[A-Z2-7]{40,}/.test(firstLine) ||
    /:\/\/[^/@\s]+:[^/@\s]+@/.test(firstLine); // credentials in a URL
  if (looksSensitive || firstLine.length === 0) return fallback;
  return firstLine.slice(0, 200);
}
