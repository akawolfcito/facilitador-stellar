/**
 * Dense retrieval under evaluation.
 *
 * Uses the production embedder and the production document representation, so
 * the number this benchmark reports is a number about the shipped ranker.
 */

import { buildSearchDocument } from "@stellar-bazaar/catalog";
import { EMBEDDING_MODEL, cosine, embed } from "@stellar-bazaar/search";
import { toCatalogListing } from "../adapter.js";
import type { CatalogDocument, Retriever, ScoredHit } from "../types.js";

export { EMBEDDING_MODEL, cosine, embed };

export class DenseRetriever implements Retriever {
  readonly name = "dense";
  readonly description = `Dense embeddings (${EMBEDDING_MODEL}, 384d, mean-pooled, cosine)`;

  private ids: string[] = [];
  private vectors: Float32Array[] = [];

  async index(corpus: CatalogDocument[]): Promise<void> {
    this.ids = corpus.map((doc) => doc.id);
    this.vectors = await embed(corpus.map((doc) => buildSearchDocument(toCatalogListing(doc))));
  }

  async search(query: string, topK: number): Promise<ScoredHit[]> {
    if (this.ids.length === 0) return [];
    const [queryVector] = await embed([query]);
    return this.ids
      .map((id, i) => ({ id, score: cosine(queryVector!, this.vectors[i]!) }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, topK);
  }
}
