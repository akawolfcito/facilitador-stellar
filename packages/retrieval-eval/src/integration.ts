/**
 * Integration benchmark: the same queries, against the shipped search path.
 *
 * `pnpm eval:retrieval:integration`
 *
 * `pnpm eval:retrieval` measures retrieval logic in isolation. This measures
 * **persisted SQLite catalog → SearchEngine.sync() → SearchEngine.search()**,
 * i.e. the code path `GET /discovery/search` actually runs, including the
 * abstention policy and the hard-filter layer.
 *
 * The two are expected to agree closely. Where they differ, the difference is
 * the abstention policy: pure retrieval always returns its top-k, production
 * refuses below the threshold and truncates the tail. That gap is reported
 * rather than smoothed over — it is the honest cost of not recommending
 * irrelevant paid services.
 *
 * Seeding writes listings straight into the store. That is correct here: this
 * measures ranking over a known corpus with committed relevance labels. The
 * *real* cataloging evidence — listings created only by settled testnet
 * payments — is E-09 and the Bazaar catalog artifact, not this file.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteCatalogStore } from "@stellar-bazaar/catalog";
import { DEFAULT_ABSTENTION_THRESHOLD, SearchEngine } from "@stellar-bazaar/search";
import { toCatalogListing } from "./adapter.js";
import { CORPUS, CORPUS_VERSION } from "./corpus/index.js";
import { meanFinite, mrrAt, ndcgAt, percentile, recallAt } from "./metrics/index.js";
import { QUERIES, QUERIES_VERSION } from "./queries/index.js";
import { DenseRetriever } from "./retrievers/dense.js";

const EVAL_DEPTH = 20;

function pct(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1).padStart(5)}%` : "     -";
}

interface Summary {
  queries: number;
  ndcgAt5: number;
  ndcgAt10: number;
  mrrAt10: number;
  recallAt20: number;
  p50: number;
  p95: number;
}

function summarize(
  rows: Array<{ ndcg5: number; ndcg10: number; mrr: number; recall20: number; ms: number }>,
): Summary {
  return {
    queries: rows.length,
    ndcgAt5: meanFinite(rows.map((r) => r.ndcg5)),
    ndcgAt10: meanFinite(rows.map((r) => r.ndcg10)),
    mrrAt10: meanFinite(rows.map((r) => r.mrr)),
    recallAt20: meanFinite(rows.map((r) => r.recall20)),
    p50: percentile(rows.map((r) => r.ms), 50),
    p95: percentile(rows.map((r) => r.ms), 95),
  };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bazaar-integration-"));
  const dbPath = join(dir, "catalog.db");
  const store = new SqliteCatalogStore(dbPath);

  try {
    for (const doc of CORPUS) store.upsert(toCatalogListing(doc));

    const engine = new SearchEngine(store, { threshold: DEFAULT_ABSTENTION_THRESHOLD });

    const buildStart = performance.now();
    const cold = await engine.sync();
    const coldMs = performance.now() - buildStart;

    // Second sync with an unchanged catalog: every vector should be reused.
    const warmStart = performance.now();
    const warm = await engine.sync();
    const warmMs = performance.now() - warmStart;

    console.log(
      `corpus ${CORPUS_VERSION} (${cold.total} listings) · queries ${QUERIES_VERSION} · ` +
        `threshold ${DEFAULT_ABSTENTION_THRESHOLD}`,
    );
    console.log(
      `index build: ${cold.embedded} embedded in ${coldMs.toFixed(0)}ms ` +
        `(${(coldMs / Math.max(cold.embedded, 1)).toFixed(1)}ms/listing)`,
    );
    console.log(
      `index resync: ${warm.reused} reused, ${warm.embedded} re-embedded in ${warmMs.toFixed(0)}ms\n`,
    );

    const answerable = QUERIES.filter((q) => q.category !== "negative");
    const negatives = QUERIES.filter((q) => q.category === "negative");

    const rows: Array<{
      id: string;
      split: string;
      ndcg5: number;
      ndcg10: number;
      mrr: number;
      recall20: number;
      ms: number;
      answered: boolean;
    }> = [];

    for (const query of answerable) {
      const started = performance.now();
      const response = await engine.search({
        query: query.query,
        filters: query.filters,
        limit: EVAL_DEPTH,
      });
      const ms = performance.now() - started;
      const ranked = response.resources.map((r) => r.canonicalKey);

      rows.push({
        id: query.id,
        split: query.split,
        ndcg5: ndcgAt(ranked, query.judgments, 5),
        ndcg10: ndcgAt(ranked, query.judgments, 10),
        mrr: mrrAt(ranked, query.judgments, 10),
        recall20: recallAt(ranked, query.judgments, 20),
        ms,
        answered: response.abstained === undefined,
      });
    }

    let rejected = 0;
    const negativeLatencies: number[] = [];
    for (const query of negatives) {
      const started = performance.now();
      const response = await engine.search({ query: query.query, limit: EVAL_DEPTH });
      negativeLatencies.push(performance.now() - started);
      if (response.abstained !== undefined) rejected++;
    }

    const all = summarize(rows);
    const heldout = summarize(rows.filter((r) => r.split === "heldout"));
    const dev = summarize(rows.filter((r) => r.split === "dev"));

    const header = "                n  nDCG@5  nDCG@10   MRR@10   R@20     p50ms    p95ms";
    console.log(header);
    console.log("-".repeat(header.length));
    for (const [label, s] of [
      ["all", all],
      ["dev", dev],
      ["heldout", heldout],
    ] as const) {
      console.log(
        `  ${label.padEnd(12)} ${String(s.queries).padStart(2)}  ${pct(s.ndcgAt5)}  ${pct(s.ndcgAt10)}   ` +
          `${pct(s.mrrAt10)}  ${pct(s.recallAt20)}  ${s.p50.toFixed(1).padStart(7)}  ${s.p95.toFixed(1).padStart(7)}`,
      );
    }

    const coverage = rows.filter((r) => r.answered).length / rows.length;
    console.log(
      `\nabstention: coverage ${pct(coverage).trim()} on answerable, ` +
        `${rejected}/${negatives.length} unanswerable rejected ` +
        `(false-positive rate ${pct(1 - rejected / negatives.length).trim()})`,
    );
    console.log(
      `negative-query latency p50 ${percentile(negativeLatencies, 50).toFixed(1)}ms`,
    );

    // ---- drift check -------------------------------------------------------
    // Same queries through the pure retriever, no abstention, no filters.
    const pure = new DenseRetriever();
    await pure.index(CORPUS);
    const pureRows = [];
    for (const query of answerable) {
      const hits = await pure.search(query.query, EVAL_DEPTH);
      pureRows.push({
        ndcg5: ndcgAt(hits.map((h) => h.id), query.judgments, 5),
        ndcg10: ndcgAt(hits.map((h) => h.id), query.judgments, 10),
        mrr: mrrAt(hits.map((h) => h.id), query.judgments, 10),
        recall20: recallAt(hits.map((h) => h.id), query.judgments, 20),
        ms: 0,
      });
    }
    const pureAll = summarize(pureRows);

    console.log(
      `\ndrift (production − pure retrieval), all answerable queries:\n` +
        `  nDCG@10  ${pct(all.ndcgAt10).trim()} vs ${pct(pureAll.ndcgAt10).trim()}  ` +
        `→ ${((all.ndcgAt10 - pureAll.ndcgAt10) * 100).toFixed(1)} pts\n` +
        `  Recall@20 ${pct(all.recallAt20).trim()} vs ${pct(pureAll.recallAt20).trim()}  ` +
        `→ ${((all.recallAt20 - pureAll.recallAt20) * 100).toFixed(1)} pts\n` +
        `  Any gap is the abstention policy truncating below-threshold results,\n` +
        `  not a different ranking function: both call buildSearchDocument and embed().`,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
