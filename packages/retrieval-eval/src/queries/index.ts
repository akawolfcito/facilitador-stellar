/**
 * Versioned evaluation queries with author-assigned graded relevance judgments.
 *
 * Labelling protocol (see docs/research/bazaar-retrieval-evaluation.md for the
 * full write-up and its limitations):
 *
 *   3 — the query is asking for essentially this service
 *   2 — a clearly usable answer to the query
 *   1 — tangentially relevant; an agent might reasonably consider it
 *   0 — irrelevant (omitted from `judgments`, or listed explicitly when the
 *       document is a deliberate distractor we want on the record)
 *
 * Labels are committed benchmark data. No retriever in this package produces or
 * modifies them; they were written against the corpus before any retriever
 * existed, and the ordering of this file is independent of any ranking.
 *
 * The split is 70/30 dev/heldout, assigned per query and fixed. Tuning happens
 * against `dev` only. `heldout` exists so that a reported improvement can be
 * distinguished from a fit to the labels.
 */

import type { EvalQuery } from "../types.js";

export const QUERIES_VERSION = "2026-08-11.1";

/** Canonical id of an HTTP corpus document. */
const H = (slug: string): string => {
  const [host, ...rest] = slug.split("/");
  return `https://${host}.example.com/${rest.join("/")}`;
};
/** Canonical id of an MCP corpus document. */
const M = (tool: string): string => `mcp://tool/${tool}`;

export const QUERIES: EvalQuery[] = [
  // ======================= EXACT =========================================
  {
    id: "ex-01",
    query: "weather",
    split: "dev",
    category: "exact",
    judgments: {
      [H("meteo/v1/forecast")]: 3,
      [M("get_weather")]: 3,
      [H("meteo/v1/alerts")]: 2,
      [H("meteo/v1/history")]: 2,
      [H("meteo/v1/marine")]: 1,
      [H("meteo/v1/air-quality")]: 1,
      [H("cargo/v1/weather-risk")]: 1,
    },
  },
  {
    id: "ex-02",
    query: "translation",
    split: "dev",
    category: "exact",
    judgments: {
      [H("lingua/v1/translate")]: 3,
      [M("translate_text")]: 3,
      [H("lingua/v1/translate-document")]: 2,
      [H("lingua/v1/translate-speech")]: 2,
      // deliberate lexical distractor: asset id mapping, not language
      [H("ledger/v1/token-translation")]: 0,
    },
  },
  {
    id: "ex-03",
    query: "OCR",
    split: "dev",
    category: "exact",
    judgments: { [H("pixel/v1/ocr")]: 3, [M("extract_invoice")]: 1, [H("pixel/v1/qr-decode")]: 1 },
  },
  {
    id: "ex-04",
    query: "vector search",
    split: "dev",
    category: "exact",
    judgments: {
      [H("vector/v1/vector-search")]: 3,
      [H("vector/v1/embed")]: 2,
      [H("vector/v1/rerank")]: 1,
      [H("vector/v1/web-search")]: 1,
    },
  },
  {
    id: "ex-05",
    query: "image generation",
    split: "dev",
    category: "exact",
    judgments: { [H("pixel/v1/generate")]: 3, [H("pixel/v1/upscale")]: 1, [H("pixel/v1/describe")]: 1 },
  },
  {
    id: "ex-06",
    query: "flight status",
    split: "heldout",
    category: "exact",
    judgments: {
      [H("travel/v1/flight-status")]: 3,
      [M("check_flight_status")]: 3,
      [H("travel/v1/flight-search")]: 1,
    },
  },
  {
    id: "ex-07",
    query: "email verification",
    split: "heldout",
    category: "exact",
    judgments: { [H("ident/v1/email-verify")]: 3, [H("ident/v1/phone-verify")]: 1, [H("ident/v1/fraud-score")]: 1 },
  },
  {
    id: "ex-08",
    query: "fraud detection",
    split: "heldout",
    category: "exact",
    judgments: {
      [H("ident/v1/fraud-score")]: 3,
      [H("ident/v1/sanctions-screen")]: 2,
      [H("pixel/v1/moderate")]: 1,
      [H("ident/v1/email-verify")]: 1,
    },
  },

  // ================== NATURAL LANGUAGE ===================================
  {
    id: "nl-01",
    query: "what service can tell me whether it will rain tomorrow?",
    split: "dev",
    category: "natural-language",
    judgments: { [H("meteo/v1/forecast")]: 3, [M("get_weather")]: 3, [H("meteo/v1/alerts")]: 1 },
  },
  {
    id: "nl-02",
    query: "I need to know how much it costs to ship a pallet to Rotterdam",
    split: "dev",
    category: "natural-language",
    judgments: {
      [H("cargo/v1/quote")]: 3,
      [H("cargo/v1/customs")]: 2,
      [H("cargo/v1/track")]: 1,
      [H("cargo/v1/port-congestion")]: 1,
    },
  },
  {
    id: "nl-03",
    query: "something that reads text out of a scanned receipt",
    split: "dev",
    category: "natural-language",
    judgments: { [H("pixel/v1/ocr")]: 3, [M("extract_invoice")]: 3, [H("lingua/v1/extract")]: 2 },
  },
  {
    id: "nl-04",
    query: "how do I turn a long report into a few bullet points",
    split: "dev",
    category: "natural-language",
    judgments: { [H("lingua/v1/summarize")]: 3, [M("summarize_pdf")]: 3, [H("lingua/v1/extract")]: 1 },
  },
  {
    id: "nl-05",
    query: "check if a Stellar account can receive USDC",
    split: "dev",
    category: "natural-language",
    judgments: {
      [H("ledger/v1/trustline-check")]: 3,
      [H("ledger/v1/stellar-analytics")]: 1,
      [M("send_stellar_payment")]: 2,
    },
  },
  {
    id: "nl-06",
    query: "I want to run some python code without setting up a server",
    split: "dev",
    category: "natural-language",
    judgments: { [H("vector/v1/code-exec")]: 3, [M("run_sql")]: 1 },
  },
  {
    id: "nl-07",
    query: "find me a place to stay in Bogota next weekend",
    split: "dev",
    category: "natural-language",
    judgments: { [H("travel/v1/hotel-search")]: 3, [H("travel/v1/flight-search")]: 1 },
  },
  {
    id: "nl-08",
    query: "is this photo safe to show to users",
    split: "dev",
    category: "natural-language",
    judgments: { [H("pixel/v1/moderate")]: 3, [H("pixel/v1/describe")]: 1 },
  },
  {
    id: "nl-09",
    query: "why was my shipment delayed and will the weather make it worse",
    split: "dev",
    category: "natural-language",
    judgments: {
      [H("cargo/v1/weather-risk")]: 3,
      [H("cargo/v1/track")]: 2,
      [H("cargo/v1/port-congestion")]: 2,
      [H("meteo/v1/forecast")]: 1,
      [H("meteo/v1/alerts")]: 1,
    },
  },
  {
    id: "nl-10",
    query: "what were the temperatures in Medellin last January",
    split: "dev",
    category: "natural-language",
    judgments: { [H("meteo/v1/history")]: 3, [H("meteo/v1/forecast")]: 1 },
  },
  {
    id: "nl-11",
    query: "turn an address into coordinates",
    split: "heldout",
    category: "natural-language",
    judgments: { [M("geocode")]: 3, [H("vector/v1/geoip")]: 1 },
  },
  {
    id: "nl-12",
    query: "does this person appear on any sanctions list",
    split: "heldout",
    category: "natural-language",
    judgments: { [H("ident/v1/sanctions-screen")]: 3, [H("ident/v1/kyc-check")]: 2, [H("ident/v1/company-lookup")]: 1 },
  },
  {
    id: "nl-13",
    query: "make this blurry picture bigger without it looking terrible",
    split: "heldout",
    category: "natural-language",
    judgments: { [H("pixel/v1/upscale")]: 3, [H("pixel/v1/generate")]: 1 },
  },
  {
    id: "nl-14",
    query: "do I need a visa to travel there",
    split: "heldout",
    category: "natural-language",
    judgments: { [H("travel/v1/visa-requirements")]: 3, [H("travel/v1/currency-tips")]: 1 },
  },

  // ====================== CONSTRAINT =====================================
  {
    id: "co-01",
    query: "translate text for less than one cent",
    split: "dev",
    category: "constraint",
    judgments: {
      [H("lingua/v1/translate")]: 3, // 5000 = $0.0005
      [M("translate_text")]: 3,
      [H("lingua/v1/translate-speech")]: 0, // 80000 = $0.008, over budget
      [H("lingua/v1/translate-document")]: 0, // 450000 = $0.045, over budget
    },
  },
  {
    id: "co-02",
    query: "cheapest way to get a crypto price",
    split: "dev",
    category: "constraint",
    judgments: {
      [H("ledger/v1/token-price")]: 3,
      [H("ledger/v1/historical-price")]: 1,
      [M("convert_currency")]: 2,
    },
  },
  {
    id: "co-03",
    query: "weather forecast that costs under a tenth of a cent",
    split: "dev",
    category: "constraint",
    judgments: { [H("meteo/v1/forecast")]: 3, [M("get_weather")]: 3, [H("meteo/v1/history")]: 0 },
  },
  {
    id: "co-04",
    query: "search the web, paid per query on Stellar testnet",
    split: "dev",
    category: "constraint",
    filters: { network: "stellar:testnet" },
    judgments: { [H("vector/v1/web-search")]: 3, [M("web_search")]: 3, [H("vector/v1/scrape")]: 1 },
  },
  {
    id: "co-05",
    query: "an MCP tool I can call for under a cent",
    split: "dev",
    category: "constraint",
    filters: { type: "mcp" },
    judgments: {
      [M("geocode")]: 2,
      [M("convert_currency")]: 2,
      [M("send_stellar_payment")]: 2,
      [M("translate_text")]: 2,
      [M("get_weather")]: 2,
      [M("web_search")]: 1,
      [M("check_flight_status")]: 1,
    },
  },
  {
    id: "co-06",
    query: "on-chain analytics available on stellar mainnet",
    split: "heldout",
    category: "constraint",
    filters: { network: "stellar:pubnet" },
    judgments: { [H("ledger/v1/historical-price")]: 2, [H("ident/v1/kyc-check")]: 0 },
  },
  {
    id: "co-07",
    query: "identity verification I can pay for with USDC",
    split: "heldout",
    category: "constraint",
    judgments: { [H("ident/v1/kyc-check")]: 3, [H("ident/v1/sanctions-screen")]: 2, [H("ident/v1/email-verify")]: 1 },
  },
  {
    id: "co-08",
    query: "very cheap blockchain rpc access",
    split: "heldout",
    category: "constraint",
    judgments: { [H("ledger/v1/stellar-rpc")]: 3, [H("ledger/v1/gas-estimate")]: 1 },
  },

  // ====================== AMBIGUOUS ======================================
  {
    id: "am-01",
    query: "price",
    split: "dev",
    category: "ambiguous",
    judgments: {
      [H("ledger/v1/token-price")]: 3,
      [H("ledger/v1/fx")]: 2,
      [H("cargo/v1/quote")]: 2,
      [H("ledger/v1/historical-price")]: 2,
      [H("cargo/v1/customs")]: 1,
      [M("convert_currency")]: 1,
      [H("ledger/v1/gas-estimate")]: 1,
    },
  },
  {
    id: "am-02",
    query: "extraction",
    split: "dev",
    category: "ambiguous",
    judgments: {
      [H("lingua/v1/extract")]: 3,
      [H("pixel/v1/ocr")]: 2,
      [M("extract_invoice")]: 2,
      [H("vector/v1/scrape")]: 2,
    },
  },
  {
    id: "am-03",
    query: "search",
    split: "dev",
    category: "ambiguous",
    judgments: {
      [H("vector/v1/web-search")]: 3,
      [H("vector/v1/vector-search")]: 3,
      [M("web_search")]: 2,
      [H("travel/v1/flight-search")]: 1,
      [H("travel/v1/hotel-search")]: 1,
      [H("vector/v1/rerank")]: 1,
    },
  },
  {
    id: "am-04",
    query: "risk",
    split: "dev",
    category: "ambiguous",
    judgments: {
      [H("ident/v1/fraud-score")]: 3,
      [H("cargo/v1/weather-risk")]: 2,
      [H("ident/v1/sanctions-screen")]: 2,
    },
  },
  {
    id: "am-05",
    query: "conversion",
    split: "dev",
    category: "ambiguous",
    judgments: {
      [H("ledger/v1/fx")]: 3,
      [M("convert_currency")]: 3,
      [H("ledger/v1/token-translation")]: 1,
      [H("lingua/v1/translate")]: 0,
    },
  },
  {
    id: "am-06",
    query: "verification",
    split: "heldout",
    category: "ambiguous",
    judgments: {
      [H("ident/v1/email-verify")]: 3,
      [H("ident/v1/phone-verify")]: 3,
      [H("ident/v1/kyc-check")]: 2,
      [H("ident/v1/sanctions-screen")]: 1,
    },
  },
  {
    id: "am-07",
    query: "tracking",
    split: "heldout",
    category: "ambiguous",
    judgments: { [H("cargo/v1/track")]: 3, [H("travel/v1/flight-status")]: 1, [H("cargo/v1/port-congestion")]: 1 },
  },
  {
    id: "am-08",
    query: "analysis",
    split: "heldout",
    category: "ambiguous",
    judgments: {
      [H("lingua/v1/sentiment")]: 2,
      [H("ledger/v1/stellar-analytics")]: 2,
      [H("ledger/v1/evm-analytics")]: 2,
      [H("lingua/v1/classify")]: 1,
      [H("pixel/v1/describe")]: 1,
    },
  },

  // ===================== MULTI-INTENT ====================================
  {
    id: "mi-01",
    query: "find an API that converts currencies and accepts Stellar USDC",
    split: "dev",
    category: "multi-intent",
    judgments: { [H("ledger/v1/fx")]: 3, [M("convert_currency")]: 3, [H("ledger/v1/token-price")]: 1 },
  },
  {
    id: "mi-02",
    query: "read a PDF invoice and pull out the line items and totals",
    split: "dev",
    category: "multi-intent",
    judgments: {
      [M("extract_invoice")]: 3,
      [H("lingua/v1/extract")]: 3,
      [H("pixel/v1/ocr")]: 2,
      [M("summarize_pdf")]: 1,
    },
  },
  {
    id: "mi-03",
    query: "translate a contract and check the company that signed it is real",
    split: "dev",
    category: "multi-intent",
    judgments: {
      [H("lingua/v1/translate-document")]: 3,
      [H("ident/v1/company-lookup")]: 3,
      [H("lingua/v1/translate")]: 1,
    },
  },
  {
    id: "mi-04",
    query: "score an incoming signup for fraud using its IP and email",
    split: "dev",
    category: "multi-intent",
    judgments: {
      [H("ident/v1/fraud-score")]: 3,
      [H("ident/v1/email-verify")]: 2,
      [H("vector/v1/geoip")]: 2,
    },
  },
  {
    id: "mi-05",
    query: "build a RAG pipeline: embed documents then search and rerank them",
    split: "dev",
    category: "multi-intent",
    judgments: {
      [H("vector/v1/embed")]: 3,
      [H("vector/v1/vector-search")]: 3,
      [H("vector/v1/rerank")]: 3,
      [H("vector/v1/scrape")]: 1,
    },
  },
  {
    id: "mi-06",
    query: "estimate import duty and the shipping cost for the same container",
    split: "heldout",
    category: "multi-intent",
    judgments: { [H("cargo/v1/customs")]: 3, [H("cargo/v1/quote")]: 3, [H("cargo/v1/track")]: 1 },
  },
  {
    id: "mi-07",
    query: "generate an image and then strip its background",
    split: "heldout",
    category: "multi-intent",
    judgments: { [H("pixel/v1/generate")]: 3, [H("pixel/v1/background-remove")]: 3, [H("pixel/v1/upscale")]: 1 },
  },
  {
    id: "mi-08",
    query: "pay someone on Stellar but first estimate the network fee",
    split: "heldout",
    category: "multi-intent",
    judgments: {
      [M("send_stellar_payment")]: 3,
      [H("ledger/v1/gas-estimate")]: 3,
      [H("ledger/v1/trustline-check")]: 2,
    },
  },

  // ========================== MCP ========================================
  {
    id: "mc-01",
    query: "tool that can summarize a PDF",
    split: "dev",
    category: "mcp",
    filters: { type: "mcp" },
    judgments: { [M("summarize_pdf")]: 3, [M("extract_invoice")]: 1 },
  },
  {
    id: "mc-02",
    query: "MCP tool for querying a database with SQL",
    split: "dev",
    category: "mcp",
    filters: { type: "mcp" },
    judgments: { [M("run_sql")]: 3 },
  },
  {
    id: "mc-03",
    query: "agent tool to look up live weather",
    split: "dev",
    category: "mcp",
    filters: { type: "mcp" },
    judgments: { [M("get_weather")]: 3 },
  },
  {
    id: "mc-04",
    query: "a tool my agent can use to send a payment",
    split: "dev",
    category: "mcp",
    filters: { type: "mcp" },
    judgments: { [M("send_stellar_payment")]: 3, [M("convert_currency")]: 1 },
  },
  {
    id: "mc-05",
    query: "MCP tool that searches the internet",
    split: "heldout",
    category: "mcp",
    filters: { type: "mcp" },
    judgments: { [M("web_search")]: 3 },
  },
  {
    id: "mc-06",
    query: "tool to find latitude and longitude for a street address",
    split: "heldout",
    category: "mcp",
    filters: { type: "mcp" },
    judgments: { [M("geocode")]: 3 },
  },

  // ======================== NEGATIVE =====================================
  // No document in the corpus can serve these. They are excluded from nDCG,
  // MRR and recall aggregates and reported under NegativeSummary instead.
  {
    id: "ng-01",
    query: "book me a dentist appointment",
    split: "dev",
    category: "negative",
    judgments: {},
  },
  {
    id: "ng-02",
    query: "stream live football matches in 4k",
    split: "dev",
    category: "negative",
    judgments: {},
  },
  {
    id: "ng-03",
    query: "hire a plumber in my neighbourhood tonight",
    split: "heldout",
    category: "negative",
    judgments: {},
  },
  {
    id: "ng-04",
    query: "print and mail a physical postcard",
    split: "heldout",
    category: "negative",
    judgments: {},
  },
];

/**
 * Guards the properties the benchmark depends on: unique ids, every judged
 * document present in the corpus, negatives genuinely empty, and a split that
 * is at least 70/30.
 */
export function assertQuerySetIntegrity(
  queries: EvalQuery[],
  corpusIds: ReadonlySet<string>,
): void {
  const seen = new Set<string>();
  for (const q of queries) {
    if (seen.has(q.id)) throw new Error(`duplicate query id: ${q.id}`);
    seen.add(q.id);
    for (const docId of Object.keys(q.judgments)) {
      if (!corpusIds.has(docId)) {
        throw new Error(`query ${q.id} judges unknown document: ${docId}`);
      }
    }
    const relevant = Object.values(q.judgments).filter((g) => g >= 1).length;
    if (q.category === "negative" && relevant > 0) {
      throw new Error(`negative query ${q.id} has ${relevant} relevant documents`);
    }
    if (q.category !== "negative" && relevant === 0) {
      throw new Error(`non-negative query ${q.id} has no relevant documents`);
    }
  }
  const dev = queries.filter((q) => q.split === "dev").length;
  const ratio = dev / queries.length;
  if (ratio > 0.75 || ratio < 0.6) {
    throw new Error(`dev split is ${(ratio * 100).toFixed(0)}%, expected ~70%`);
  }
}
