import { describe, expect, it } from "vitest";
import { applyFilters, filterHits, matchesFilters } from "../src/filters.js";
import { CORPUS } from "../src/corpus/index.js";
import type { CatalogDocument, PaymentOption } from "../src/types.js";

function option(overrides: Partial<PaymentOption> = {}): PaymentOption {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    asset: "C_USDC_TESTNET",
    assetSymbol: "USDC",
    maxAmountRequired: "10000",
    decimals: 7,
    payTo: "G_ALICE",
    ...overrides,
  };
}

function doc(id: string, accepts: PaymentOption[], type: CatalogDocument["type"] = "http"): CatalogDocument {
  return {
    id,
    type,
    resource: id,
    serviceName: id,
    description: "",
    tags: [],
    params: [],
    accepts,
    ...(type === "mcp" ? { toolName: id } : {}),
  };
}

describe("matchesFilters", () => {
  it("passes everything when there are no filters", () => {
    expect(matchesFilters(doc("a", [option()]), undefined)).toBe(true);
    expect(matchesFilters(doc("a", [option()]), {})).toBe(true);
  });

  it("filters on resource type", () => {
    expect(matchesFilters(doc("a", [option()], "http"), { type: "mcp" })).toBe(false);
    expect(matchesFilters(doc("a", [option()], "mcp"), { type: "mcp" })).toBe(true);
  });

  it("filters on network, scheme, asset and payTo", () => {
    const d = doc("a", [option()]);
    expect(matchesFilters(d, { network: "stellar:pubnet" })).toBe(false);
    expect(matchesFilters(d, { network: "stellar:testnet" })).toBe(true);
    expect(matchesFilters(d, { scheme: "upto" })).toBe(false);
    expect(matchesFilters(d, { asset: "C_OTHER" })).toBe(false);
    expect(matchesFilters(d, { payTo: "G_BOB" })).toBe(false);
    expect(matchesFilters(d, { payTo: "G_ALICE" })).toBe(true);
  });

  it("requires ONE payment option to satisfy ALL payment constraints together", () => {
    // Testnet+exact and pubnet+upto. Neither option is pubnet AND exact, so a
    // filter asking for both must reject the document.
    const d = doc("a", [
      option({ network: "stellar:testnet", scheme: "exact" }),
      option({ network: "stellar:pubnet", scheme: "upto" }),
    ]);
    expect(matchesFilters(d, { network: "stellar:pubnet", scheme: "upto" })).toBe(true);
    expect(matchesFilters(d, { network: "stellar:pubnet", scheme: "exact" })).toBe(false);
  });

  it("accepts the bazaar extension and rejects unknown ones", () => {
    const d = doc("a", [option()]);
    expect(matchesFilters(d, { extensions: ["bazaar"] })).toBe(true);
    expect(matchesFilters(d, { extensions: ["builder-code"] })).toBe(false);
  });
});

describe("applyFilters over the real corpus", () => {
  it("narrows to MCP tools only", () => {
    const mcp = applyFilters(CORPUS, { type: "mcp" });
    expect(mcp.length).toBeGreaterThan(0);
    expect(mcp.every((d) => d.type === "mcp")).toBe(true);
    expect(mcp.length).toBeLessThan(CORPUS.length);
  });

  it("excludes non-Stellar listings when a Stellar network is requested", () => {
    const testnet = applyFilters(CORPUS, { network: "stellar:testnet" });
    expect(testnet.every((d) => d.accepts.some((a) => a.network === "stellar:testnet"))).toBe(true);
    expect(testnet.some((d) => d.accepts.some((a) => a.network === "eip155:8453"))).toBe(false);
  });
});

describe("filterHits", () => {
  const ranked = [
    { id: "high-but-unpayable", score: 0.99 },
    { id: "lower-but-payable", score: 0.42 },
    { id: "also-payable", score: 0.11 },
  ];
  const allowed = new Set(["lower-but-payable", "also-payable"]);

  it("NEVER lets an unpayable result outrank a payable one, however similar", () => {
    const kept = filterHits(ranked, allowed, 10);
    expect(kept.map((h) => h.id)).toEqual(["lower-but-payable", "also-payable"]);
    expect(kept.some((h) => h.id === "high-but-unpayable")).toBe(false);
  });

  it("preserves the relative order of the surviving hits", () => {
    const kept = filterHits(ranked, allowed, 10);
    expect(kept[0]!.score).toBeGreaterThan(kept[1]!.score);
  });

  it("truncates after filtering, not before", () => {
    // Naively slicing to 1 first would yield the unpayable hit and then nothing.
    expect(filterHits(ranked, allowed, 1).map((h) => h.id)).toEqual(["lower-but-payable"]);
  });

  it("returns an empty list when nothing is payable", () => {
    expect(filterHits(ranked, new Set<string>(), 10)).toEqual([]);
  });
});
