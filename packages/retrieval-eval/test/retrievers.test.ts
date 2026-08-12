import { describe, expect, it } from "vitest";
import { BaselineIncludesRetriever } from "../src/retrievers/baseline.js";
import { Bm25Retriever } from "../src/retrievers/bm25.js";
import { rrfFuse } from "../src/retrievers/rrf.js";
import { documentHaystack, tokenize } from "../src/retrievers/text.js";
import type { CatalogDocument, ScoredHit } from "../src/types.js";

function doc(
  id: string,
  serviceName: string,
  description: string,
  tags: string[] = [],
): CatalogDocument {
  return {
    id,
    type: "http",
    resource: id,
    serviceName,
    description,
    tags,
    params: [],
    accepts: [
      {
        scheme: "exact",
        network: "stellar:testnet",
        asset: "C_ASSET",
        assetSymbol: "USDC",
        maxAmountRequired: "10000",
        decimals: 7,
        payTo: "G_SELLER",
      },
    ],
  };
}

const corpus: CatalogDocument[] = [
  doc("d1", "Weather Forecast", "Short range forecast of rain and temperature", ["weather", "rain"]),
  doc("d2", "Historical Weather", "Past weather observations and climate archive", ["weather", "history"]),
  doc("d3", "Token Prices", "Spot price for a crypto asset in USD", ["price", "crypto"]),
];

describe("tokenize", () => {
  it("lowercases, splits on non-alphanumerics and drops stopwords", () => {
    expect(tokenize("The Rain, in Spain-2024!")).toEqual(["rain", "spain", "2024"]);
  });

  it("drops single characters", () => {
    expect(tokenize("a b cd")).toEqual(["cd"]);
  });
});

describe("documentHaystack", () => {
  it("is lowercase and contains every searchable field", () => {
    const h = documentHaystack(corpus[0]!);
    expect(h).toBe(h.toLowerCase());
    expect(h).toContain("weather forecast");
    expect(h).toContain("rain");
  });
});

describe("BaselineIncludesRetriever", () => {
  it("matches on raw substring, as the upstream reference does", async () => {
    const r = new BaselineIncludesRetriever();
    await r.index(corpus);
    const hits = await r.search("weather", 10);
    expect(hits.map((h) => h.id)).toEqual(["d1", "d2"]);
  });

  it("returns nothing when the whole query is not a literal substring", async () => {
    const r = new BaselineIncludesRetriever();
    await r.index(corpus);
    // This is the upstream failure mode we are measuring: a natural-language
    // query is one long needle, so `includes` finds nothing.
    expect(await r.search("will it rain tomorrow", 10)).toEqual([]);
  });

  it("is case insensitive", async () => {
    const r = new BaselineIncludesRetriever();
    await r.index(corpus);
    expect((await r.search("WEATHER", 10)).length).toBe(2);
  });

  it("preserves corpus order and assigns no ranking signal", async () => {
    const r = new BaselineIncludesRetriever();
    await r.index(corpus);
    const hits = await r.search("weather", 10);
    expect(new Set(hits.map((h) => h.score)).size).toBe(1);
  });

  it("respects topK", async () => {
    const r = new BaselineIncludesRetriever();
    await r.index(corpus);
    expect((await r.search("weather", 1)).map((h) => h.id)).toEqual(["d1"]);
  });
});

describe("Bm25Retriever", () => {
  it("finds documents for a natural-language query the baseline misses", async () => {
    const r = new Bm25Retriever();
    await r.index(corpus);
    const hits = await r.search("will it rain tomorrow", 10);
    expect(hits[0]!.id).toBe("d1");
  });

  it("ranks by term specificity, not just presence", async () => {
    const r = new Bm25Retriever();
    await r.index(corpus);
    // "weather" appears in d1 and d2; "climate" only in d2.
    const hits = await r.search("climate archive", 10);
    expect(hits[0]!.id).toBe("d2");
  });

  it("returns descending scores", async () => {
    const r = new Bm25Retriever();
    await r.index(corpus);
    const scores = (await r.search("weather price", 10)).map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("returns an empty list when no query term occurs in the corpus", async () => {
    const r = new Bm25Retriever();
    await r.index(corpus);
    expect(await r.search("dentist appointment", 10)).toEqual([]);
  });

  it("respects topK", async () => {
    const r = new Bm25Retriever();
    await r.index(corpus);
    expect((await r.search("weather", 1)).length).toBe(1);
  });
});

describe("rrfFuse", () => {
  const a: ScoredHit[] = [
    { id: "x", score: 9 },
    { id: "y", score: 5 },
  ];
  const b: ScoredHit[] = [
    { id: "y", score: 0.9 },
    { id: "z", score: 0.8 },
  ];

  it("uses rank, never the raw score, so incomparable scales can be fused", () => {
    const fused = rrfFuse([a, b], 60, 10);
    const y = fused.find((h) => h.id === "y")!;
    // y is rank 2 in a and rank 1 in b: 1/62 + 1/61
    expect(y.score).toBeCloseTo(1 / 62 + 1 / 61, 12);
  });

  it("ranks a document appearing in both lists above one appearing in either", () => {
    const fused = rrfFuse([a, b], 60, 10);
    expect(fused[0]!.id).toBe("y");
  });

  it("keeps documents that appear in only one list", () => {
    expect(new Set(rrfFuse([a, b], 60, 10).map((h) => h.id))).toEqual(new Set(["x", "y", "z"]));
  });

  it("returns descending scores and respects topK", () => {
    const fused = rrfFuse([a, b], 60, 2);
    expect(fused.length).toBe(2);
    expect(fused[0]!.score).toBeGreaterThanOrEqual(fused[1]!.score);
  });

  it("is unaffected by the magnitude of the input scores", () => {
    const scaled: ScoredHit[] = a.map((h) => ({ ...h, score: h.score * 1_000_000 }));
    expect(rrfFuse([a, b], 60, 10)).toEqual(rrfFuse([scaled, b], 60, 10));
  });

  it("ignores empty result lists", () => {
    expect(rrfFuse([a, []], 60, 10).map((h) => h.id)).toEqual(["x", "y"]);
  });
});
