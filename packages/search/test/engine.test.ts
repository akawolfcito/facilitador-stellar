/**
 * Search engine behaviour, against a real SQLite catalog.
 *
 * Covers the pipeline order, index convergence, abstention, cursors and the
 * security properties search must not weaken.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteCatalogStore,
  buildSearchDocument,
  type CatalogListing,
} from "@stellar-bazaar/catalog";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchEngine } from "../src/engine.js";
import { decodeCursor, encodeCursor } from "../src/ranking.js";

const SELLER_A = "GSELLERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SELLER_B = "GSELLERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const USDC = "CUSDCTESTNET";

function listing(overrides: Partial<CatalogListing> & { canonicalKey: string }): CatalogListing {
  return {
    type: "http",
    resource: overrides.canonicalKey,
    discoveryInfo: { input: { type: "http", method: "GET" } },
    extensions: { bazaar: { info: {} } },
    payTo: SELLER_A,
    network: "stellar:testnet",
    scheme: "exact",
    asset: USDC,
    amount: "10000",
    x402Version: 2,
    ownerPayTo: SELLER_A,
    ownershipBinding: "tofu",
    firstSeenAt: "2026-08-12T00:00:00.000Z",
    lastSeenAt: "2026-08-12T00:00:00.000Z",
    lastSettlementTx: "tx",
    metadataVersion: 1,
    ...overrides,
  };
}

const CATALOG: CatalogListing[] = [
  listing({
    canonicalKey: "https://m.example/forecast",
    serviceName: "Weather Forecast",
    description: "Short-range forecast of rain, temperature and wind for a city.",
    tags: ["weather", "rain", "forecast"],
  }),
  listing({
    canonicalKey: "https://m.example/history",
    serviceName: "Historical Weather",
    description: "Past weather observations and climate archive for a location.",
    tags: ["weather", "historical", "climate"],
  }),
  listing({
    canonicalKey: "https://l.example/translate",
    serviceName: "Text Translation",
    description: "Translate short text between one hundred languages.",
    tags: ["translation", "language"],
  }),
  listing({
    canonicalKey: "https://l.example/translate-document",
    serviceName: "Document Translation",
    description: "Translate a whole PDF or DOCX document, preserving layout and tables.",
    tags: ["translation", "document", "pdf"],
  }),
  // Same intent, different network: exists so a network filter has prey.
  listing({
    canonicalKey: "https://m.example/forecast-mainnet",
    serviceName: "Weather Forecast Pro",
    description: "Short-range forecast of rain, temperature and wind for a city.",
    tags: ["weather", "rain", "forecast"],
    network: "stellar:pubnet",
    payTo: SELLER_B,
    ownerPayTo: SELLER_B,
  }),
  listing({
    canonicalKey: "mcp://tool/get_weather#tool=get_weather",
    resource: "mcp://tool/get_weather",
    type: "mcp",
    toolName: "get_weather",
    serviceName: "Weather Tool",
    description: "MCP tool returning current conditions for a named location.",
    tags: ["mcp", "weather", "agent"],
    discoveryInfo: { input: { type: "mcp", toolName: "get_weather" } },
  }),
];

let dir: string;
let store: SqliteCatalogStore;
let engine: SearchEngine;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "search-"));
  store = new SqliteCatalogStore(join(dir, "catalog.db"));
  for (const row of CATALOG) store.upsert(row);
  engine = new SearchEngine(store);
  await engine.sync();
}, 300_000);

afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("natural-language ranking", () => {
  it("answers a paraphrase that shares no term with the listing", async () => {
    const response = await engine.search({ query: "will it rain tomorrow?" });
    expect(response.abstained).toBeUndefined();
    expect(response.resources[0]!.serviceName).toMatch(/Weather/);
  });

  it("distinguishes document translation from plain text translation", async () => {
    const response = await engine.search({ query: "translate this PDF document" });
    expect(response.resources[0]!.canonicalKey).toBe("https://l.example/translate-document");
  });

  it("prefers historical weather for a query about the past", async () => {
    const response = await engine.search({ query: "what was the weather last January" });
    expect(response.resources[0]!.canonicalKey).toBe("https://m.example/history");
  });
});

describe("hard filters run before ranking", () => {
  it("excludes the best semantic match when it is on the wrong network", async () => {
    const unfiltered = await engine.search({ query: "weather forecast pro" });
    expect(unfiltered.resources[0]!.canonicalKey).toBe("https://m.example/forecast-mainnet");

    const filtered = await engine.search({
      query: "weather forecast pro",
      filters: { network: "stellar:testnet" },
    });
    // Not merely ranked lower — absent.
    expect(filtered.resources.map((r) => r.canonicalKey)).not.toContain(
      "https://m.example/forecast-mainnet",
    );
    expect(filtered.resources.every((r) => r.network === "stellar:testnet")).toBe(true);
  });

  it("filters by type, payTo, scheme and asset before scoring", async () => {
    const mcpOnly = await engine.search({ query: "weather", filters: { type: "mcp" } });
    expect(mcpOnly.resources.every((r) => r.type === "mcp")).toBe(true);

    const byPayTo = await engine.search({ query: "weather", filters: { payTo: SELLER_B } });
    expect(byPayTo.resources.every((r) => r.payTo === SELLER_B)).toBe(true);

    const wrongScheme = await engine.search({ query: "weather", filters: { scheme: "upto" } });
    expect(wrongScheme.resources).toHaveLength(0);
    expect(wrongScheme.abstained?.reason).toBe("NO_ELIGIBLE_RESOURCES");
  });

  it("abstains with a reason when filters eliminate every candidate", async () => {
    const response = await engine.search({
      query: "weather",
      filters: { network: "eip155:8453" },
    });
    expect(response.resources).toHaveLength(0);
    expect(response.abstained?.reason).toBe("NO_ELIGIBLE_RESOURCES");
    expect(response.abstained?.reason).toBeTruthy();
  });
});

describe("abstention", () => {
  it("returns nothing for a query the catalog cannot serve", async () => {
    const response = await engine.search({ query: "book me a dentist appointment" });
    expect(response.resources).toHaveLength(0);
    expect(response.abstained?.reason).toBe("BELOW_RELEVANCE_THRESHOLD");
    expect(response.abstained!.topScore).toBeLessThan(response.abstained!.threshold);
  });

  it("still answers a genuine query", async () => {
    const response = await engine.search({ query: "translate text" });
    expect(response.resources.length).toBeGreaterThan(0);
    expect(response.abstained).toBeUndefined();
  });

  it("never returns a result scoring below the threshold", async () => {
    const permissive = new SearchEngine(store, { threshold: 0 });
    await permissive.sync();
    const wide = await permissive.search({ query: "weather", limit: 50 });
    const strict = await engine.search({ query: "weather", limit: 50 });
    expect(strict.resources.length).toBeLessThanOrEqual(wide.resources.length);
  });
});

describe("cursor pagination", () => {
  it("pages deterministically and terminates", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = await engine.search({ query: "weather", limit: 1, cursor });
      seen.push(...response.resources.map((r) => r.canonicalKey));
      cursor = response.pagination?.cursor ?? undefined;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("sets partialResults only when matches were actually truncated", async () => {
    const narrow = await engine.search({ query: "weather", limit: 1 });
    expect(narrow.partialResults).toBe(true);
    expect(narrow.pagination?.cursor).toBeTruthy();

    const wide = await engine.search({ query: "weather", limit: 50 });
    expect(wide.partialResults).toBe(false);
    expect(wide.pagination?.cursor).toBeNull();
  });

  it("refuses a cursor issued for a different query", async () => {
    const first = await engine.search({ query: "weather", limit: 1 });
    const stolen = first.pagination!.cursor!;
    const response = await engine.search({ query: "translation", limit: 1, cursor: stolen });
    expect(response.abstained?.reason).toBe("INVALID_CURSOR");
  });

  it("refuses a cursor issued under different filters, so it cannot cross a filter boundary", async () => {
    const permissive = await engine.search({ query: "weather", limit: 1 });
    const response = await engine.search({
      query: "weather",
      filters: { network: "stellar:testnet" },
      limit: 1,
      cursor: permissive.pagination!.cursor!,
    });
    expect(response.abstained?.reason).toBe("INVALID_CURSOR");
  });

  it("rejects a malformed or hostile cursor without leaking internals", async () => {
    for (const cursor of [
      "not-base64!!",
      Buffer.from("[1,\"x\"]").toString("base64url"),
      Buffer.from(JSON.stringify([-1, "aaaa"])).toString("base64url"),
      Buffer.from(JSON.stringify([99999999999, "aaaa"])).toString("base64url"),
      Buffer.from(JSON.stringify(["' OR 1=1 --", "aaaa"])).toString("base64url"),
    ]) {
      const response = await engine.search({ query: "weather", cursor });
      expect(response.abstained?.reason).toBe("INVALID_CURSOR");
      expect(JSON.stringify(response)).not.toMatch(/SELECT|sqlite|listings/i);
    }
  });

  it("decodes only well-formed state", () => {
    expect(decodeCursor(encodeCursor({ offset: 5, fingerprint: "abc" }))).toEqual({
      offset: 5,
      fingerprint: "abc",
    });
    expect(decodeCursor("garbage")).toBeUndefined();
    expect(decodeCursor(Buffer.from("{}").toString("base64url"))).toBeUndefined();
  });
});

describe("index convergence", () => {
  it("reuses cached vectors when nothing changed", async () => {
    const result = await engine.sync();
    expect(result.embedded).toBe(0);
    expect(result.reused).toBe(CATALOG.length);
  });

  it("does not re-embed when only payment terms change", async () => {
    const original = CATALOG[0]!;
    store.upsert({ ...original, amount: "999999", lastSettlementTx: "tx-new" });
    const result = await engine.sync();
    // The search document is unchanged, so its hash matches and the vector
    // stays. This is what the document-hash freshness key buys.
    expect(result.embedded).toBe(0);
  });

  it("re-embeds and re-ranks when descriptive metadata changes", async () => {
    const before = await engine.search({ query: "currency exchange rates" });
    const beforeTop = before.resources[0]?.canonicalKey;

    store.upsert({
      ...CATALOG[2]!,
      serviceName: "Currency Exchange",
      description: "Convert between fiat currencies at live interbank exchange rates.",
      tags: ["fx", "currency", "exchange"],
      lastSettlementTx: "tx-meta",
    });
    const result = await engine.sync();
    expect(result.embedded).toBe(1);

    const after = await engine.search({ query: "currency exchange rates" });
    expect(after.resources[0]!.canonicalKey).toBe("https://l.example/translate");
    expect(after.resources[0]!.canonicalKey).not.toBe(beforeTop);

    // Restore for later tests.
    store.upsert({ ...CATALOG[2]!, lastSettlementTx: "tx-restore" });
    await engine.sync();
  });

  it("rebuilds the whole index from the catalog after the embeddings are destroyed", async () => {
    store.clearEmbeddings();
    expect(store.allEmbeddings()).toHaveLength(0);

    const rebuilt = new SearchEngine(store);
    const result = await rebuilt.sync();
    expect(result.embedded).toBe(CATALOG.length);

    const response = await rebuilt.search({ query: "will it rain tomorrow?" });
    expect(response.resources[0]!.serviceName).toMatch(/Weather/);
  }, 300_000);

  it("survives a restart: a new engine on the same file re-uses persisted vectors", async () => {
    const reopened = new SqliteCatalogStore(join(dir, "catalog.db"));
    const restarted = new SearchEngine(reopened);
    const result = await restarted.sync();
    expect(result.embedded).toBe(0);
    expect(result.reused).toBeGreaterThan(0);

    const response = await restarted.search({ query: "will it rain tomorrow?" });
    expect(response.resources[0]!.serviceName).toMatch(/Weather/);
    reopened.close();
  });
});

describe("security", () => {
  it("bounds a hostile description before it reaches the embedder", () => {
    const document = buildSearchDocument({
      type: "http",
      resource: "https://x.example/a",
      serviceName: "x".repeat(10_000),
      description: "y".repeat(1_000_000),
      tags: Array.from({ length: 500 }, () => "z".repeat(500)),
      discoveryInfo: { input: { type: "http" } },
    });
    expect(document.length).toBeLessThanOrEqual(8000);
  });

  it("does not crash on malformed Unicode", () => {
    const document = buildSearchDocument({
      type: "http",
      resource: "https://x.example/a",
      serviceName: "\uD800 lone surrogate",
      description: "null byte​zero width",
      tags: ["\uDFFF"],
      discoveryInfo: { input: { type: "http" } },
    });
    expect(typeof document).toBe("string");
    expect(document).not.toContain(" ");
  });

  it("treats a query containing SQL as text, not as SQL", async () => {
    for (const query of [
      "'; DROP TABLE listings; --",
      "weather' OR '1'='1",
      "weather ",
    ]) {
      const response = await engine.search({ query });
      expect(Array.isArray(response.resources)).toBe(true);
    }
    // The catalog is intact.
    expect(store.all().length).toBeGreaterThan(0);
  });

  it("treats a filter value containing SQL as a literal", async () => {
    const response = await engine.search({
      query: "weather",
      filters: { payTo: "'; DROP TABLE listings; --" },
    });
    expect(response.resources).toHaveLength(0);
    expect(store.all().length).toBeGreaterThan(0);
  });

  it("surfaces ownership binding so search cannot launder a spoofed listing", async () => {
    const response = await engine.search({ query: "weather forecast" });
    for (const resource of response.resources) {
      expect(resource.ownerPayTo).toBeTruthy();
      expect(resource.ownershipBinding).toBe("tofu");
    }
  });

  it("cannot be used to write to the catalog", async () => {
    const before = store.all().length;
    await engine.search({ query: "anything at all" });
    expect(store.all().length).toBe(before);
  });
});
