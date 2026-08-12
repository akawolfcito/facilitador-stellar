/**
 * Guard against silently settling through somebody else's facilitator.
 *
 * `@x402/core`'s `HTTPFacilitatorClient` defaults to
 * `https://x402.org/facilitator` when no URL is configured
 * (`httpFacilitatorClient.ts:14,336-339`). That is a convenient default and a
 * dangerous one: a misconfiguration produces a completely working payment flow
 * whose settlement happens somewhere else entirely, with no error anywhere.
 *
 * We hit exactly this. The first green run of our own E2E harness reported PASS
 * on every stage and was settled by the public x402.org facilitator — see E-06a
 * in docs/scf/evidence-log.md. The transaction's source account was the only
 * thing that gave it away.
 *
 * So this is not advice, it is an assertion. Any harness or example that talks
 * to a facilitator calls it, and a run that would settle through the public
 * default fails loudly instead of passing quietly.
 */

/** Hosts that are definitely not us. */
const PUBLIC_FACILITATOR_HOSTS = new Set([
  "x402.org",
  "www.x402.org",
  "facilitator.x402.org",
]);

export class ForeignFacilitatorError extends Error {}

/**
 * Assert that `url` is a facilitator we control.
 *
 * @param url - Configured facilitator URL. `undefined` is itself a failure: an
 *   unset URL is precisely what triggers the default-fallback behaviour.
 * @param context - Where the check fired, for the message.
 * @throws {ForeignFacilitatorError} if the URL is missing, unparseable, or a
 *   known public facilitator.
 */
export function assertOwnFacilitator(url: string | undefined, context: string): string {
  if (!url) {
    throw new ForeignFacilitatorError(
      `${context}: no facilitator URL configured. @x402/core would fall back to ` +
        `https://x402.org/facilitator and settle payments through it.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ForeignFacilitatorError(`${context}: facilitator URL is not a valid URL: ${url}`);
  }

  if (PUBLIC_FACILITATOR_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new ForeignFacilitatorError(
      `${context}: facilitator URL points at the public facilitator (${parsed.hostname}). ` +
        `A conformance run that settles there proves nothing about our deployment.`,
    );
  }

  return url;
}

/**
 * Assert that a settled transaction was submitted by one of our own signers.
 *
 * The complement to the check above, and the stronger of the two: it reads the
 * chain rather than the configuration. A facilitator can be pointed anywhere,
 * but only our signer can be the source account of a transaction we submitted.
 *
 * @param sourceAccount - `source_account` of the settled transaction, from a
 *   block explorer or RPC — never from the facilitator's own response.
 * @param ourSigners - Addresses this facilitator signs with.
 */
export function assertSettledByUs(
  sourceAccount: string | undefined,
  ourSigners: readonly string[],
  context: string,
): void {
  if (!sourceAccount || !ourSigners.includes(sourceAccount)) {
    throw new ForeignFacilitatorError(
      `${context}: transaction source account ${sourceAccount ?? "<unknown>"} is not one of ` +
        `our signers [${ourSigners.join(", ")}]. The settlement went through a different facilitator.`,
    );
  }
}
