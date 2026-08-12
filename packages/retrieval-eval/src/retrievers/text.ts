/**
 * Text handling that belongs to the *baseline only*.
 *
 * Everything the shipped ranker uses now lives in `@stellar-bazaar/catalog`
 * (`buildSearchDocument`, `buildSearchTokens`, `tokenize`) and is imported from
 * there, so the benchmark cannot drift from production.
 *
 * What remains here reproduces the upstream reference implementation's field
 * concatenation, which is deliberately *not* our representation — the point of
 * the baseline is to measure what x402 ships today.
 */

import type { CatalogDocument } from "../types.js";

export { tokenize } from "@stellar-bazaar/catalog";

/**
 * The upstream reference's searchable surface.
 *
 * x402-foundation/x402 @ c8247c4,
 * `examples/typescript/facilitator/advanced/bazaar.ts:88-99` joins `resource`,
 * `type`, `description`, `serviceName`, `tags` and the values of `extensions`.
 *
 * Parameter names and descriptions are included because in a cataloged resource
 * they arrive inside the bazaar extension, which upstream flattens via
 * `Object.values(r.extensions ?? {})`. That makes the baseline *stronger* than a
 * naive reading of the snippet, which is intentional: beating a strawman would
 * prove nothing.
 */
export function documentHaystack(doc: CatalogDocument): string {
  return [
    doc.resource,
    doc.type,
    doc.description,
    doc.serviceName,
    ...doc.tags,
    ...(doc.toolName ? [doc.toolName] : []),
    ...doc.params.flatMap((param) => [param.name, param.description]),
  ]
    .join(" ")
    .toLowerCase();
}
