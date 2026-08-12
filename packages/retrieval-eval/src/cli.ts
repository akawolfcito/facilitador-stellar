/**
 * Benchmark entry point: `pnpm eval:retrieval`.
 *
 * Emits a human-readable table to stdout and a machine-readable artifact to
 * `artifacts/retrieval-eval/latest.json`, so a claim in the SCF submission can
 * always be traced to a committed number and a command that regenerates it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORPUS, CORPUS_VERSION, assertCorpusIntegrity } from "./corpus/index.js";
import { evaluate } from "./eval.js";
import { QUERIES, QUERIES_VERSION, assertQuerySetIntegrity } from "./queries/index.js";
import { BaselineIncludesRetriever } from "./retrievers/baseline.js";
import { Bm25Retriever } from "./retrievers/bm25.js";
import { DenseRetriever } from "./retrievers/dense.js";
import { HybridRrfRetriever } from "./retrievers/hybrid.js";
import type { BenchmarkArtifact, MetricSummary, Retriever, RetrieverReport } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = resolve(HERE, "../../../artifacts/retrieval-eval/latest.json");

function pct(value: number): string {
  return Number.isFinite(value) ? (value * 100).toFixed(1).padStart(5) : "    -";
}

function ms(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1).padStart(7) : "      -";
}

function row(label: string, s: MetricSummary): string {
  return [
    label.padEnd(18),
    String(s.queries).padStart(3),
    pct(s.ndcgAt5),
    pct(s.ndcgAt10),
    pct(s.mrrAt10),
    pct(s.recallAt10),
    pct(s.recallAt20),
    ms(s.latencyP50Ms),
    ms(s.latencyP95Ms),
  ].join("  ");
}

const HEADER = [
  "".padEnd(18),
  "  n",
  "nDCG5",
  "nDCG@10",
  "MRR10",
  " R@10",
  " R@20",
  "  p50ms",
  "  p95ms",
].join("  ");

function printReport(report: RetrieverReport): void {
  console.log(`\n\x1b[1m${report.retriever}\x1b[0m — ${report.description}`);
  console.log(HEADER);
  console.log("-".repeat(HEADER.length));
  console.log(row("all", report.all));
  console.log(row("dev", report.dev));
  console.log(row("heldout ← unseen", report.heldout));
  console.log("");
  for (const [category, summary] of Object.entries(report.byCategory).sort()) {
    console.log(row(`  ${category}`, summary));
  }
  const n = report.negatives;
  console.log(
    `\n  negatives (${n.queries}): median top-1 ${n.medianTopScore.toFixed(4)} vs ` +
      `${n.medianTopScoreOnAnswerable.toFixed(4)} answerable — separation ${n.separationRatio.toFixed(3)} (lower is better)`,
  );
}

function comparison(reports: RetrieverReport[]): void {
  console.log(`\n\x1b[1m=== nDCG@10, held-out split (the number that counts) ===\x1b[0m`);
  const baseline = reports.find((r) => r.retriever === "baseline-includes");
  for (const report of reports) {
    const value = report.heldout.ndcgAt10;
    let delta = "";
    if (baseline && report !== baseline && Number.isFinite(baseline.heldout.ndcgAt10)) {
      const base = baseline.heldout.ndcgAt10;
      const points = (value - base) * 100;
      const factor = base > 0 ? value / base : Number.POSITIVE_INFINITY;
      delta = `  (+${points.toFixed(1)} pts, ${Number.isFinite(factor) ? `${factor.toFixed(1)}x` : "∞"})`;
    }
    console.log(`  ${report.retriever.padEnd(18)} ${pct(value)}%${delta}`);
  }
}

async function main(): Promise<void> {
  assertCorpusIntegrity(CORPUS);
  assertQuerySetIntegrity(QUERIES, new Set(CORPUS.map((d) => d.id)));

  const retrievers: Retriever[] = [
    new BaselineIncludesRetriever(),
    new Bm25Retriever(),
    new DenseRetriever(),
    new HybridRrfRetriever(),
  ];

  console.log(
    `corpus ${CORPUS_VERSION} (${CORPUS.length} documents) · ` +
      `queries ${QUERIES_VERSION} (${QUERIES.length} total, ` +
      `${QUERIES.filter((q) => q.split === "dev").length} dev / ` +
      `${QUERIES.filter((q) => q.split === "heldout").length} held-out)`,
  );

  const reports: RetrieverReport[] = [];
  for (const retriever of retrievers) {
    reports.push(await evaluate(retriever, CORPUS, QUERIES));
    printReport(reports.at(-1)!);
  }

  comparison(reports);

  const artifact: BenchmarkArtifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    corpus: { version: CORPUS_VERSION, documents: CORPUS.length },
    queries: {
      version: QUERIES_VERSION,
      total: QUERIES.length,
      dev: QUERIES.filter((q) => q.split === "dev").length,
      heldout: QUERIES.filter((q) => q.split === "heldout").length,
    },
    environment: { node: process.version, platform: process.platform },
    reports,
  };

  mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
  writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`\nwrote ${ARTIFACT_PATH}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
