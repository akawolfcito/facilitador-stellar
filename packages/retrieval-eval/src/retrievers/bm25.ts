/**
 * Lexical retrieval under evaluation.
 *
 * A thin wrapper over the production `Bm25Index` from `@stellar-bazaar/search`,
 * which tokenises through `buildSearchTokens` in `@stellar-bazaar/catalog`.
 * Evaluating a private copy would measure something the facilitator does not
 * run; this measures the shipped code.
 */

import { Bm25Index } from "@stellar-bazaar/search";
import { toCatalogListing } from "../adapter.js";
import type { CatalogDocument, Retriever, ScoredHit } from "../types.js";

export class Bm25Retriever implements Retriever {
  readonly name = "bm25";
  readonly description =
    "Okapi BM25 over the production search tokens (k1=1.2, b=0.75, no stemming)";

  private readonly bm25 = new Bm25Index();

  async index(corpus: CatalogDocument[]): Promise<void> {
    this.bm25.build(corpus.map(toCatalogListing));
  }

  async search(query: string, topK: number): Promise<ScoredHit[]> {
    return [...this.bm25.score(query).entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, topK);
  }
}
