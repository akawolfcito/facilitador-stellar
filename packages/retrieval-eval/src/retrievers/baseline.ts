/**
 * Faithful reproduction of the x402 reference Bazaar search.
 *
 * Upstream: x402-foundation/x402 @ commit c8247c4cd15f29498474404d94636e7dbb894e86,
 * `examples/typescript/facilitator/advanced/bazaar.ts:87-108`:
 *
 *   search(query, type?, limit?) {
 *     const needle = query.toLowerCase();
 *     let results = Array.from(this.resources.values()).filter((r) => {
 *       const haystack = [ r.resource, r.type, r.description ?? "",
 *         r.serviceName ?? "", ...(r.tags ?? []),
 *         ...Object.values(r.extensions ?? {}) ].join(" ").toLowerCase();
 *       return haystack.includes(needle);
 *     });
 *     if (type) results = results.filter((r) => r.type === type);
 *     return limit !== undefined ? results.slice(0, limit) : results;
 *   }
 *
 * The equivalent Python and Go examples behave the same way
 * (`examples/python/facilitator/advanced/bazaar.py:337`,
 * `examples/go/facilitator/advanced/bazaar.go:237`).
 *
 * This is the baseline the benchmark measures against. It is reproduced as
 * written — including the whole-query-as-one-substring behaviour, which is the
 * single biggest reason it fails natural-language queries — and deliberately
 * not weakened: it reads the same fields every other retriever reads.
 *
 * Type filtering is omitted here because the harness applies hard filters as a
 * separate layer before ranking, for every retriever alike.
 */

import type { CatalogDocument, Retriever, ScoredHit } from "../types.js";
import { documentHaystack } from "./text.js";

export class BaselineIncludesRetriever implements Retriever {
  readonly name = "baseline-includes";
  readonly description =
    "x402 reference implementation: lowercase substring match over concatenated fields, no ranking";

  private docs: Array<{ id: string; haystack: string }> = [];

  async index(corpus: CatalogDocument[]): Promise<void> {
    this.docs = corpus.map((doc) => ({ id: doc.id, haystack: documentHaystack(doc) }));
  }

  async search(query: string, topK: number): Promise<ScoredHit[]> {
    const needle = query.toLowerCase();
    const hits: ScoredHit[] = [];
    for (const doc of this.docs) {
      if (doc.haystack.includes(needle)) {
        // Upstream produces no score at all; every match is equivalent and the
        // order is whatever the Map yielded. A constant score records that.
        hits.push({ id: doc.id, score: 1 });
        if (hits.length === topK) break;
      }
    }
    return hits;
  }
}
