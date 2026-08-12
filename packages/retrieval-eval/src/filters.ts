/**
 * Hard protocol filters, applied before ranking.
 *
 * This separation is the point, not an implementation detail. The Bazaar
 * discovery filters (`type`, `network`, `scheme`, `payTo`, `extensions`) are
 * deterministic statements about whether a buyer *can pay for* a resource. A
 * semantically perfect match on the wrong network is not a slightly worse
 * result — it is an unusable one, and an agent that follows it wastes a round
 * trip and then fails.
 *
 * So relevance never gets a vote on payability. The candidate set is reduced to
 * payable resources first; ranking then orders what is left. `applyFilters` and
 * `filterHits` exist as separate, individually testable steps for that reason.
 *
 * Reference: specs/extensions/bazaar.md, "Optional Discovery Endpoints"
 * (x402-foundation/x402 @ c8247c4).
 */

import type { CatalogDocument, HardFilters, ScoredHit } from "./types.js";

/** Does `doc` satisfy every constraint in `filters`? */
export function matchesFilters(doc: CatalogDocument, filters: HardFilters | undefined): boolean {
  if (!filters) return true;

  if (filters.type && doc.type !== filters.type) return false;

  // Payment constraints are satisfied when ANY accepted payment option
  // satisfies ALL of them together. Checking them independently would let a
  // document pass by matching `network` on one option and `asset` on another,
  // which no single payment could actually do.
  const paymentConstrained =
    filters.network !== undefined ||
    filters.scheme !== undefined ||
    filters.asset !== undefined ||
    filters.payTo !== undefined;

  if (paymentConstrained) {
    const ok = doc.accepts.some(
      (option) =>
        (filters.network === undefined || option.network === filters.network) &&
        (filters.scheme === undefined || option.scheme === filters.scheme) &&
        (filters.asset === undefined || option.asset === filters.asset) &&
        (filters.payTo === undefined || option.payTo === filters.payTo),
    );
    if (!ok) return false;
  }

  // The corpus models the bazaar extension as always present on a cataloged
  // resource, which is true by construction: a listing exists because a payment
  // carried the extension.
  if (filters.extensions?.some((key) => key !== "bazaar")) return false;

  return true;
}

/** The subset of `corpus` a buyer with these constraints could actually pay. */
export function applyFilters(
  corpus: CatalogDocument[],
  filters: HardFilters | undefined,
): CatalogDocument[] {
  return corpus.filter((doc) => matchesFilters(doc, filters));
}

/**
 * Drop hits outside the allowed set, preserving rank order, then truncate.
 *
 * Filtering after ranking rather than before is safe here only because the
 * retriever is asked for the whole corpus. A production index pushes the
 * predicate into the query instead; see docs/specs for that design.
 */
export function filterHits(
  hits: ScoredHit[],
  allowed: ReadonlySet<string>,
  topK: number,
): ScoredHit[] {
  const kept: ScoredHit[] = [];
  for (const hit of hits) {
    if (allowed.has(hit.id)) {
      kept.push(hit);
      if (kept.length === topK) break;
    }
  }
  return kept;
}
