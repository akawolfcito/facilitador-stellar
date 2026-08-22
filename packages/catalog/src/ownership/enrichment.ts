/**
 * Where domain binding meets the catalog, and where it deliberately does not.
 *
 * Verification is **enrichment after insertion**. It never runs before a listing
 * exists, never runs inside a settlement, and never blocks a response. A payment
 * must not fail because a third party's web server is down, and the facilitator
 * already moved index sync off the settlement response path for the same reason.
 *
 * Two entry points, both fire-and-forget:
 *
 *   `scheduleVerification` — once, just after a listing is catalogued.
 *   `refreshIfStale` — lazily, when discovery reads a listing whose result has
 *   expired. Traffic drives freshness, so a listing nobody reads is not
 *   re-checked, which is the correct priority and needs no cron.
 */

import type { CatalogListing, OwnershipBinding } from "../types.js";
import type { VerificationRecord } from "../store.js";
import { type VerifierDeps, verifyOwnership } from "./verifier.js";
import { isContradiction } from "./wellknown.js";

export interface EnrichmentDeps extends VerifierDeps {
  now?: () => number;
}

/**
 * What enrichment needs from a store, and nothing more.
 *
 * Declared structurally rather than as the concrete SQLite class, so a store
 * that cannot persist verification (the frozen preview catalog, for one) is a
 * no-op here instead of a type error or a crash.
 */
export interface VerificationStore {
  verification(canonicalKey: string): VerificationRecord | undefined;
  recordVerification(
    canonicalKey: string,
    outcome: { reason: string; origin: string },
    binding: OwnershipBinding | undefined,
    at?: number,
  ): void;
  degradeStaleVerification(canonicalKey: string, at?: number): boolean;
}

/** Can this store hold a verification result at all? */
export function supportsVerification(store: unknown): store is VerificationStore {
  const candidate = store as Partial<VerificationStore> | null;
  return (
    typeof candidate?.verification === "function" &&
    typeof candidate.recordVerification === "function" &&
    typeof candidate.degradeStaleVerification === "function"
  );
}

/**
 * Turn a verification result into a binding change, or into nothing.
 *
 * `undefined` means "leave the listing alone", and it is the answer for every
 * form of silence: no document, a timeout, a malformed file, or a document that
 * simply does not mention this resource. None of those is a repudiation, and
 * demoting on one would let an outage look like a denial.
 */
export function bindingFor(reason: string): OwnershipBinding | undefined {
  if (reason === "VERIFIED") return "domain-verified";
  if (isContradiction(reason as never)) return "domain-mismatch";
  return undefined;
}

/** Only an https resource has an origin to ask. MCP listings stay tofu. */
export function isVerifiable(listing: CatalogListing): boolean {
  return listing.type === "http" && listing.resource.startsWith("https://");
}

/**
 * Verify one listing and persist the result.
 *
 * Never throws. The caller is a settlement path or a read path, and neither has
 * anything useful to do with an exception from someone else's web server.
 */
export async function verifyAndRecord(
  store: unknown,
  listing: CatalogListing,
  deps: EnrichmentDeps = {},
): Promise<void> {
  if (!isVerifiable(listing) || !supportsVerification(store)) return;
  const now = deps.now ?? Date.now;

  try {
    const outcome = await verifyOwnership(
      { resource: listing.resource, payTo: listing.ownerPayTo, network: listing.network },
      deps,
    );
    store.recordVerification(
      listing.canonicalKey,
      { reason: outcome.reason, origin: outcome.origin },
      bindingFor(outcome.reason),
      now(),
    );
    // A binding that has gone unanswered past the grace window steps down, and
    // says so rather than changing quietly.
    if (store.degradeStaleVerification(listing.canonicalKey, now())) {
      deps.log?.({
        event: "ownership_degraded",
        canonicalKey: listing.canonicalKey,
        from: "domain-verified",
        to: "tofu",
        reason: outcome.reason,
      });
    }
  } catch (error) {
    deps.log?.({
      event: "ownership_verification_failed",
      canonicalKey: listing.canonicalKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Kick off verification without waiting for it.
 *
 * Returns immediately, on purpose. The returned promise exists so tests can
 * await it; production callers drop it, and dropping it is the whole point.
 */
export function scheduleVerification(
  store: unknown,
  listing: CatalogListing,
  deps: EnrichmentDeps = {},
): Promise<void> {
  return verifyAndRecord(store, listing, deps);
}

/** Has this listing's result aged out? */
export function isStale(store: unknown, canonicalKey: string, at: number = Date.now()): boolean {
  if (!supportsVerification(store)) return false;
  const record = store.verification(canonicalKey);
  if (!record) return true;
  if (!record.expiresAt) return true;
  return at >= Date.parse(record.expiresAt);
}

/**
 * Re-verify on read, at most once per listing per TTL.
 *
 * Stale-while-revalidate: the caller gets the current binding immediately and
 * the refresh happens behind it. An expired result keeps its state rather than
 * flipping to tofu because a timer fired.
 */
export function refreshIfStale(
  store: unknown,
  listing: CatalogListing,
  deps: EnrichmentDeps = {},
): void {
  const now = deps.now ?? Date.now;
  if (!isVerifiable(listing) || !supportsVerification(store)) return;
  if (!isStale(store, listing.canonicalKey, now())) return;
  void verifyAndRecord(store, listing, deps);
}
