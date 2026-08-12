/**
 * Okapi BM25 lexical retrieval.
 *
 * Implemented here rather than pulled from a package: it is ~60 lines of
 * textbook arithmetic, it removes a dependency whose licence would need
 * auditing under RFP §3.6, and it is far easier to test than to trust.
 *
 * Scoring, per term q in the query:
 *
 *   idf(q) = ln(1 + (N - df + 0.5) / (df + 0.5))
 *   score += idf(q) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / avgdl))
 *
 * where f is the term frequency in the document, dl the document length and
 * avgdl the mean document length. This is the Lucene form of the idf, which is
 * always positive — the classic Robertson/Sparck-Jones form goes negative for
 * terms appearing in more than half the corpus, which on a 65-document catalog
 * would actively penalise a document for containing a common word like
 * "search".
 *
 * k1 and b are the conventional defaults from the literature (1.2, 0.75). They
 * were not fitted to this benchmark's queries.
 */

import type { CatalogDocument, Retriever, ScoredHit } from "../types.js";
import { documentTokens, tokenize } from "./text.js";

export interface Bm25Options {
  /** Term-frequency saturation. Higher means repeated terms keep helping. */
  k1?: number;
  /** Length normalisation strength, 0 (none) to 1 (full). */
  b?: number;
}

interface IndexedDoc {
  id: string;
  length: number;
  frequencies: Map<string, number>;
}

export class Bm25Retriever implements Retriever {
  readonly name = "bm25";
  readonly description = "Okapi BM25 over weighted document fields (k1=1.2, b=0.75, no stemming)";

  private readonly k1: number;
  private readonly b: number;
  private docs: IndexedDoc[] = [];
  private documentFrequency = new Map<string, number>();
  private averageLength = 0;

  constructor(options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
  }

  async index(corpus: CatalogDocument[]): Promise<void> {
    this.docs = corpus.map((doc) => {
      const tokens = documentTokens(doc);
      const frequencies = new Map<string, number>();
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      return { id: doc.id, length: tokens.length, frequencies };
    });

    this.documentFrequency = new Map();
    for (const doc of this.docs) {
      for (const term of doc.frequencies.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }

    const total = this.docs.reduce((sum, d) => sum + d.length, 0);
    this.averageLength = this.docs.length === 0 ? 0 : total / this.docs.length;
  }

  async search(query: string, topK: number): Promise<ScoredHit[]> {
    const terms = tokenize(query);
    if (terms.length === 0 || this.docs.length === 0) return [];

    const n = this.docs.length;
    const hits: ScoredHit[] = [];

    for (const doc of this.docs) {
      let score = 0;
      for (const term of terms) {
        const f = doc.frequencies.get(term);
        if (!f) continue;
        const df = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const denominator =
          f + this.k1 * (1 - this.b + (this.b * doc.length) / (this.averageLength || 1));
        score += idf * ((f * (this.k1 + 1)) / denominator);
      }
      if (score > 0) hits.push({ id: doc.id, score });
    }

    hits.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
    return hits.slice(0, topK);
  }
}
