/**
 * Reciprocal Rank Fusion.
 *
 * Cormack, Clarke & Buettcher (SIGIR 2009): given several ranked lists,
 *
 *   RRF(d) = sum over lists L of 1 / (k + rank_L(d))
 *
 * with rank 1-based and documents absent from a list contributing nothing.
 *
 * RRF is the right first choice for hybrid retrieval here for one specific
 * reason: BM25 scores are unbounded and cosine similarities live in [-1, 1], so
 * any weighted sum of raw scores would need per-corpus normalisation that
 * silently changes as the catalog grows. RRF only reads rank, so it is immune
 * to the scale of either retriever — a property the tests assert directly.
 *
 * k = 60 is the constant from the original paper. It damps the influence of the
 * very top ranks just enough that a single retriever cannot dominate the fusion.
 */

import type { ScoredHit } from "../types.js";

/**
 * Fuse ranked lists into one.
 *
 * @param lists - Ranked results, each already sorted best-first.
 * @param k - Rank damping constant.
 * @param topK - Maximum hits to return.
 */
export function rrfFuse(lists: ScoredHit[][], k: number, topK: number): ScoredHit[] {
  const fused = new Map<string, number>();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank]!.id;
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank + 1));
    }
  }

  return [...fused.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1))
    .slice(0, topK);
}
