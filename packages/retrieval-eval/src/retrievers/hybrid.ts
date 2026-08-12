/**
 * Hybrid lexical + dense retrieval, fused with Reciprocal Rank Fusion.
 *
 * BM25 and embeddings fail in opposite directions, which is what makes fusing
 * them worth the cost rather than picking the better one:
 *
 * - BM25 nails exact and rare terms ("SEP-41", "UN/LOCODE", a tool name) and is
 *   blind to paraphrase — "will it rain tomorrow" shares no term with
 *   "precipitation probability".
 * - Dense embeddings handle paraphrase and intent, and reliably confuse members
 *   of a near-duplicate family: "weather", "historical weather" and "weather
 *   alerts" sit close together in vector space regardless of which one the
 *   query actually wants.
 *
 * RRF is used rather than a weighted score sum because BM25 is unbounded while
 * cosine is bounded; see `rrf.ts` for that argument in full.
 *
 * Each arm is over-fetched (`candidateDepth`) before fusion so that a document
 * ranked, say, 30th by BM25 and 3rd by dense can still surface — truncating
 * each arm at `topK` before fusing would throw that away.
 */

import type { CatalogDocument, Retriever, ScoredHit } from "../types.js";
import { Bm25Retriever } from "./bm25.js";
import { DenseRetriever } from "./dense.js";
import { rrfFuse } from "./rrf.js";

export interface HybridOptions {
  /** RRF rank-damping constant. 60 is the value from the original paper. */
  k?: number;
  /** How deep to read each arm before fusing. */
  candidateDepth?: number;
}

export class HybridRrfRetriever implements Retriever {
  readonly name = "hybrid-rrf";
  readonly description: string;

  private readonly lexical = new Bm25Retriever();
  private readonly dense = new DenseRetriever();
  private readonly k: number;
  private readonly candidateDepth: number;

  constructor(options: HybridOptions = {}) {
    this.k = options.k ?? 60;
    this.candidateDepth = options.candidateDepth ?? 50;
    this.description = `Reciprocal rank fusion of BM25 and dense embeddings (k=${this.k}, depth=${this.candidateDepth})`;
  }

  async index(corpus: CatalogDocument[]): Promise<void> {
    await Promise.all([this.lexical.index(corpus), this.dense.index(corpus)]);
  }

  async search(query: string, topK: number): Promise<ScoredHit[]> {
    const depth = Math.max(this.candidateDepth, topK);
    const [lexicalHits, denseHits] = await Promise.all([
      this.lexical.search(query, depth),
      this.dense.search(query, depth),
    ]);
    return rrfFuse([lexicalHits, denseHits], this.k, topK);
  }
}
