/**
 * Abstention threshold calibration.
 *
 * `pnpm calibrate`
 *
 * Sweeps a top-1 cosine threshold and reports, **on the dev split only**:
 *
 *   coverage        — answerable queries still answered
 *   rejection rate  — unanswerable queries correctly refused
 *   false positives — unanswerable queries answered anyway
 *   nDCG@10 | accepted — ranking quality among the queries we chose to answer
 *
 * The 20 held-out queries are not read here. Selecting a threshold against them
 * and then reporting held-out numbers would make the held-out split meaningless.
 */

import { CORPUS } from "./corpus/index.js";
import { ndcgAt } from "./metrics/index.js";
import { QUERIES } from "./queries/index.js";
import { DenseRetriever } from "./retrievers/dense.js";

const THRESHOLDS = [0.0, 0.15, 0.2, 0.22, 0.24, 0.26, 0.28, 0.3, 0.32, 0.35, 0.4, 0.45];

interface Row {
  threshold: number;
  coverage: number;
  rejectionRate: number;
  falsePositiveRate: number;
  ndcgAccepted: number;
  answered: number;
  missed: number;
}

function pct(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1).padStart(5)}%` : "     -";
}

async function main(): Promise<void> {
  const dev = QUERIES.filter((q) => q.split === "dev");
  const answerable = dev.filter((q) => q.category !== "negative");
  const negatives = dev.filter((q) => q.category === "negative");

  console.log(
    `calibrating on the DEV split only: ${answerable.length} answerable, ` +
      `${negatives.length} unanswerable (held-out: not read)\n`,
  );

  const retriever = new DenseRetriever();
  await retriever.index(CORPUS);

  // Score every dev query once; the sweep is then pure arithmetic.
  const scored = new Map<string, { top: number; hits: Array<{ id: string; score: number }> }>();
  for (const query of dev) {
    const hits = await retriever.search(query.query, 20);
    scored.set(query.id, { top: hits[0]?.score ?? 0, hits });
  }

  const rows: Row[] = THRESHOLDS.map((threshold) => {
    const acceptedAnswerable = answerable.filter((q) => scored.get(q.id)!.top >= threshold);
    const acceptedNegatives = negatives.filter((q) => scored.get(q.id)!.top >= threshold);

    const ndcgs = acceptedAnswerable.map((q) => {
      // The caller only ever sees hits at or above the threshold, so the metric
      // is computed over that same truncated list rather than the full ranking.
      const visible = scored
        .get(q.id)!
        .hits.filter((hit) => hit.score >= threshold)
        .map((hit) => hit.id);
      return ndcgAt(visible, q.judgments, 10);
    });

    return {
      threshold,
      coverage: acceptedAnswerable.length / answerable.length,
      rejectionRate: 1 - acceptedNegatives.length / negatives.length,
      falsePositiveRate: acceptedNegatives.length / negatives.length,
      ndcgAccepted:
        ndcgs.length > 0 ? ndcgs.reduce((a, b) => a + b, 0) / ndcgs.length : Number.NaN,
      answered: acceptedAnswerable.length,
      missed: answerable.length - acceptedAnswerable.length,
    };
  });

  console.log(
    "     T   coverage  reject   FP-rate  nDCG@10|acc   answered  missed(answerable)",
  );
  console.log("-".repeat(76));
  for (const row of rows) {
    console.log(
      `  ${row.threshold.toFixed(2)}   ${pct(row.coverage)}  ${pct(row.rejectionRate)}  ` +
        `${pct(row.falsePositiveRate)}   ${pct(row.ndcgAccepted)}       ` +
        `${String(row.answered).padStart(2)}        ${row.missed}`,
    );
  }

  const topsAnswerable = answerable.map((q) => scored.get(q.id)!.top).sort((a, b) => a - b);
  const topsNegative = negatives.map((q) => scored.get(q.id)!.top).sort((a, b) => a - b);
  console.log(
    `\n  answerable top-1 cosine: min ${topsAnswerable[0]!.toFixed(4)}, ` +
      `max ${topsAnswerable.at(-1)!.toFixed(4)}`,
  );
  console.log(
    `  negative   top-1 cosine: min ${topsNegative[0]!.toFixed(4)}, ` +
      `max ${topsNegative.at(-1)!.toFixed(4)}`,
  );

  // The largest threshold that still answers every answerable dev query — i.e.
  // maximum rejection at zero cost to coverage.
  const lossless = rows.filter((r) => r.coverage === 1).sort((a, b) => b.threshold - a.threshold)[0];
  console.log(
    `\n  highest threshold with full coverage on dev: ${lossless?.threshold.toFixed(2)} ` +
      `(rejects ${pct(lossless?.rejectionRate ?? 0).trim()} of negatives)`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
