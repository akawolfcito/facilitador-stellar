/**
 * Bridge from the benchmark corpus to the production catalog type.
 *
 * The benchmark's `CatalogDocument` is a hand-authored fixture; a
 * `CatalogListing` is what the facilitator actually persists. Mapping one onto
 * the other means the retrievers under evaluation consume
 * `buildSearchDocument` / `buildSearchTokens` — the same functions the live
 * `/discovery/search` uses — rather than a parallel representation that could
 * quietly diverge from it.
 *
 * The `discoveryInfo` produced here mirrors what `declareDiscoveryExtension`
 * emits for a query endpoint or an MCP tool, so parameter names and
 * descriptions land where the production extractor looks for them.
 */

import type { CatalogListing } from "@stellar-bazaar/catalog";
import type { CatalogDocument } from "./types.js";

/** Synthetic settlement provenance; the benchmark never settles anything. */
const BENCHMARK_TX = "benchmark";
const BENCHMARK_AT = "2026-08-12T00:00:00.000Z";

export function toCatalogListing(doc: CatalogDocument): CatalogListing {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const param of doc.params) {
    properties[param.name] = { type: param.type, description: param.description };
  }
  const required = doc.params.filter((p) => p.required).map((p) => p.name);

  const input =
    doc.type === "mcp"
      ? {
          type: "mcp" as const,
          toolName: doc.toolName,
          inputSchema: { type: "object", properties, required },
        }
      : {
          type: "http" as const,
          method: "GET",
          querySchema: { type: "object", properties, required },
        };

  const option = doc.accepts[0]!;

  return {
    canonicalKey: doc.id,
    type: doc.type,
    resource: doc.resource,
    ...(doc.toolName ? { toolName: doc.toolName } : {}),
    ...(doc.type === "http" ? { method: "GET" } : {}),
    serviceName: doc.serviceName,
    description: doc.description,
    tags: doc.tags,
    discoveryInfo: { input },
    extensions: { bazaar: { info: { input } } },

    payTo: option.payTo,
    network: option.network,
    scheme: option.scheme,
    asset: option.asset,
    amount: option.maxAmountRequired,
    x402Version: 2,

    ownerPayTo: option.payTo,
    ownershipBinding: "tofu",

    firstSeenAt: BENCHMARK_AT,
    lastSeenAt: BENCHMARK_AT,
    lastSettlementTx: BENCHMARK_TX,
    metadataVersion: 1,
  };
}
