/**
 * Shared text extraction and tokenisation.
 *
 * Every retriever reads documents through these functions so that the benchmark
 * compares *ranking functions* and not field access. If one retriever could see
 * parameter descriptions and another could not, the comparison would measure
 * plumbing rather than relevance.
 */

import type { CatalogDocument } from "../types.js";

/**
 * The searchable surface of a document.
 *
 * Field selection mirrors the upstream reference implementation
 * (x402-foundation/x402 @ c8247c4,
 * `examples/typescript/facilitator/advanced/bazaar.ts:88-99`), which joins
 * `resource`, `type`, `description`, `serviceName`, `tags` and the values of
 * `extensions`.
 *
 * Parameter descriptions are included here because in a real cataloged resource
 * they arrive inside the bazaar extension's `info`, which upstream flattens via
 * `Object.values(r.extensions ?? {})`. Including them makes the baseline
 * *stronger* than a naive reading of the snippet, which is deliberate: RFP
 * §3.6 grades against a real comparison, and beating an artificially weakened
 * baseline would prove nothing.
 */
export function documentFields(doc: CatalogDocument): string[] {
  return [
    doc.resource,
    doc.type,
    doc.description,
    doc.serviceName,
    ...doc.tags,
    ...(doc.toolName ? [doc.toolName] : []),
    ...doc.params.flatMap((p) => [p.name, p.description]),
  ];
}

/** The document rendered as one lowercase string, upstream-style. */
export function documentHaystack(doc: CatalogDocument): string {
  return documentFields(doc).join(" ").toLowerCase();
}

/**
 * A compact English stopword list.
 *
 * Deliberately short. An aggressive list would strip terms that carry real
 * signal in this domain ("how", "much", "up"), and the queries in the benchmark
 * are natural language, not keywords.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for",
  "from", "i", "if", "in", "is", "it", "its", "me", "my", "of", "on", "or",
  "that", "the", "then", "there", "these", "they", "this", "to", "was", "were",
  "will", "with", "you", "your",
]);

/**
 * Lowercase, split on non-alphanumerics, drop stopwords and single characters.
 *
 * Intentionally has no stemmer. A stemmer would collapse "translation" and
 * "translate" — helpful — but also "price" and "pricing" with "priced", and it
 * introduces a dependency whose licence and version would need auditing under
 * RFP §3.6 for a gain this benchmark can measure later rather than assume now.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Tokens of a document, with field repetition used as coarse weighting.
 *
 * `serviceName` and `tags` are repeated so that a term appearing in a service's
 * name counts for more than the same term buried in prose. The multipliers are
 * conventional round numbers, not fitted to the query set; the benchmark
 * reports whether they help rather than assuming it.
 */
export function documentTokens(doc: CatalogDocument): string[] {
  const name = tokenize(doc.serviceName);
  const tags = doc.tags.flatMap((t) => tokenize(t));
  return [
    ...name, ...name, ...name,
    ...tags, ...tags,
    ...tokenize(doc.description),
    ...(doc.toolName ? tokenize(doc.toolName) : []),
    ...doc.params.flatMap((p) => [...tokenize(p.name), ...tokenize(p.description)]),
    ...tokenize(doc.resource),
  ];
}

/** Natural-language rendering of a document, for embedding models. */
export function documentEmbeddingText(doc: CatalogDocument): string {
  const params = doc.params.map((p) => `${p.name}: ${p.description}`).join("; ");
  const kind = doc.type === "mcp" ? `MCP tool ${doc.toolName}` : "HTTP API endpoint";
  return [
    `${doc.serviceName}.`,
    `${kind}.`,
    doc.description,
    `Tags: ${doc.tags.join(", ")}.`,
    params ? `Parameters: ${params}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
