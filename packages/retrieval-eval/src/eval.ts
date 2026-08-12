/**
 * The evaluation runner.
 *
 * One retriever, one corpus, one query set, one report. The runner owns three
 * decisions that keep the numbers honest:
 *
 * 1. Hard filters are applied by the runner, identically for every retriever,
 *    so no retriever can win by being better at filtering. See `filters.ts`.
 * 2. Latency is measured around `search` only. Indexing is amortised and is
 *    reported separately; charging query latency for a one-off embedding pass
 *    would make dense retrieval look far worse than it is in service.
 * 3. Negative-category queries are routed away from the ranking metrics into
 *    `NegativeSummary`, because nDCG over an empty relevant set is undefined
 *    rather than zero.
 */

import { applyFilters, filterHits } from "./filters.js";
import { meanFinite, medianFinite, mrrAt, ndcgAt, percentile, recallAt } from "./metrics/index.js";
import type {
  CatalogDocument,
  EvalQuery,
  MetricSummary,
  NegativeSummary,
  QueryResult,
  Retriever,
  RetrieverReport,
} from "./types.js";

/** Deepest rank any metric here inspects. */
const EVAL_DEPTH = 20;

const EMPTY_SUMMARY: MetricSummary = {
  queries: 0,
  ndcgAt5: Number.NaN,
  ndcgAt10: Number.NaN,
  mrrAt10: Number.NaN,
  recallAt10: Number.NaN,
  recallAt20: Number.NaN,
  latencyP50Ms: Number.NaN,
  latencyP95Ms: Number.NaN,
};

function summarize(results: QueryResult[]): MetricSummary {
  if (results.length === 0) return EMPTY_SUMMARY;
  const latencies = results.map((r) => r.latencyMs);
  return {
    queries: results.length,
    ndcgAt5: meanFinite(results.map((r) => r.ndcgAt5)),
    ndcgAt10: meanFinite(results.map((r) => r.ndcgAt10)),
    mrrAt10: meanFinite(results.map((r) => r.mrrAt10)),
    recallAt10: meanFinite(results.map((r) => r.recallAt10)),
    recallAt20: meanFinite(results.map((r) => r.recallAt20)),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
  };
}

/** Run one retriever over the whole benchmark. */
export async function evaluate(
  retriever: Retriever,
  corpus: CatalogDocument[],
  queries: EvalQuery[],
): Promise<RetrieverReport> {
  await retriever.index(corpus);

  const scored: QueryResult[] = [];
  const negativeTopScores: number[] = [];
  const answerableTopScores: number[] = [];

  for (const query of queries) {
    // Same filter layer for every retriever, applied before ranking is read.
    const allowed = new Set(applyFilters(corpus, query.filters).map((d) => d.id));

    const started = performance.now();
    const raw = await retriever.search(query.query, corpus.length);
    const latencyMs = performance.now() - started;

    const hits = filterHits(raw, allowed, EVAL_DEPTH);
    const ranked = hits.map((h) => h.id);
    const topScore = hits[0]?.score ?? 0;

    if (query.category === "negative") {
      negativeTopScores.push(topScore);
      continue;
    }
    answerableTopScores.push(topScore);

    scored.push({
      queryId: query.id,
      split: query.split,
      category: query.category,
      ndcgAt5: ndcgAt(ranked, query.judgments, 5),
      ndcgAt10: ndcgAt(ranked, query.judgments, 10),
      mrrAt10: mrrAt(ranked, query.judgments, 10),
      recallAt10: recallAt(ranked, query.judgments, 10),
      recallAt20: recallAt(ranked, query.judgments, 20),
      latencyMs,
    });
  }

  const byCategory: Record<string, MetricSummary> = {};
  for (const category of new Set(scored.map((r) => r.category))) {
    byCategory[category] = summarize(scored.filter((r) => r.category === category));
  }

  const medianNegative = medianFinite(negativeTopScores);
  const medianAnswerable = medianFinite(answerableTopScores);
  const negatives: NegativeSummary = {
    queries: negativeTopScores.length,
    medianTopScore: medianNegative,
    medianTopScoreOnAnswerable: medianAnswerable,
    separationRatio: medianAnswerable === 0 ? Number.NaN : medianNegative / medianAnswerable,
  };

  return {
    retriever: retriever.name,
    description: retriever.description,
    dev: summarize(scored.filter((r) => r.split === "dev")),
    heldout: summarize(scored.filter((r) => r.split === "heldout")),
    all: summarize(scored),
    byCategory,
    negatives,
    perQuery: scored,
  };
}
