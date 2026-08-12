/**
 * Ranking metrics for the Bazaar retrieval benchmark.
 *
 * Conventions, chosen once and applied everywhere:
 *
 * - Gain is exponential, `2^grade - 1`, with a `log2(rank + 1)` discount. This
 *   is the formulation used by TREC and by most IR literature, and it is the
 *   one that actually rewards putting a grade-3 result above a grade-1 result
 *   rather than treating relevance as linear.
 * - A document is "relevant" for MRR and recall when its grade is >= 1.
 * - Unjudged documents are grade 0.
 * - When a query has no relevant documents at all, nDCG and recall are NaN, not
 *   0 and not 1. They are genuinely undefined, and silently substituting a
 *   number would make a retriever look good or bad for a query that cannot
 *   discriminate between retrievers. Callers must filter these out; see
 *   `NegativeSummary` for how they are reported instead.
 */

import type { Grade } from "../types.js";

type Judgments = Record<string, Grade>;

/** Grade of `id`, defaulting to 0 for unjudged documents. */
function gradeOf(id: string, judgments: Judgments): number {
  return judgments[id] ?? 0;
}

/** Discounted cumulative gain of `ranked` truncated at `k`. */
export function dcgAt(ranked: string[], judgments: Judgments, k: number): number {
  let dcg = 0;
  const limit = Math.min(k, ranked.length);
  for (let i = 0; i < limit; i++) {
    const grade = gradeOf(ranked[i]!, judgments);
    if (grade > 0) {
      dcg += (2 ** grade - 1) / Math.log2(i + 2);
    }
  }
  return dcg;
}

/** DCG of the ideal ranking: all judged documents sorted by descending grade. */
export function idcgAt(judgments: Judgments, k: number): number {
  const ideal = Object.values(judgments)
    .filter((g) => g > 0)
    .sort((a, b) => b - a);
  let idcg = 0;
  const limit = Math.min(k, ideal.length);
  for (let i = 0; i < limit; i++) {
    idcg += (2 ** ideal[i]! - 1) / Math.log2(i + 2);
  }
  return idcg;
}

/**
 * Normalised DCG at `k`.
 *
 * @returns NaN when the query has no relevant documents.
 */
export function ndcgAt(ranked: string[], judgments: Judgments, k: number): number {
  const idcg = idcgAt(judgments, k);
  if (idcg === 0) return Number.NaN;
  return dcgAt(ranked, judgments, k) / idcg;
}

/**
 * Reciprocal rank of the first relevant hit within `k`, or 0 if there is none.
 *
 * Unlike nDCG this stays 0 rather than NaN for a query with no relevant
 * documents, because "no relevant hit was found" is the correct answer there.
 * Aggregation still excludes negative queries, for consistency.
 */
export function mrrAt(ranked: string[], judgments: Judgments, k: number): number {
  const limit = Math.min(k, ranked.length);
  for (let i = 0; i < limit; i++) {
    if (gradeOf(ranked[i]!, judgments) >= 1) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Fraction of the relevant set retrieved within `k`.
 *
 * @returns NaN when the query has no relevant documents.
 */
export function recallAt(ranked: string[], judgments: Judgments, k: number): number {
  const relevant = new Set(
    Object.entries(judgments)
      .filter(([, g]) => g >= 1)
      .map(([id]) => id),
  );
  if (relevant.size === 0) return Number.NaN;

  const seen = new Set<string>();
  const limit = Math.min(k, ranked.length);
  for (let i = 0; i < limit; i++) {
    const id = ranked[i]!;
    if (relevant.has(id)) seen.add(id);
  }
  return seen.size / relevant.size;
}

/** Nearest-rank percentile. Does not mutate `values`. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index]!;
}

/** Arithmetic mean, ignoring NaN entries. Returns NaN if nothing is finite. */
export function meanFinite(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return Number.NaN;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

/** Median, ignoring NaN entries. */
export function medianFinite(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return Number.NaN;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[mid - 1]! + finite[mid]!) / 2 : finite[mid]!;
}
