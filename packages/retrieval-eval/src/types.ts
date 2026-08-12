/**
 * Schema-first contracts for the Bazaar retrieval evaluation harness.
 *
 * These types are the spec. Every retriever, metric and dataset in this package
 * is validated against them before any implementation logic is written.
 *
 * Field names for catalog entries mirror the x402 Bazaar discovery shapes so a
 * corpus document can be produced directly from a `DiscoveredResource` emitted
 * by `@x402/extensions/bazaar` without a translation layer.
 * Reference: x402-foundation/x402 @ c8247c4, specs/extensions/bazaar.md
 */

/** CAIP-2 network identifier, e.g. `stellar:testnet`, `eip155:8453`. */
export type Caip2Network = string;

/** Resource kind as used by the Bazaar `type` discovery filter. */
export type ResourceType = "http" | "mcp";

/**
 * A single payment option, mirroring one entry of the x402 `accepts[]` array.
 * Only the fields that participate in hard filtering or ranking are modelled.
 */
export interface PaymentOption {
  scheme: "exact" | "upto";
  network: Caip2Network;
  /** Contract id / asset identifier as it appears in payment requirements. */
  asset: string;
  /** Human-facing asset symbol, used for lexical matching (e.g. `USDC`). */
  assetSymbol: string;
  /** Atomic amount string. Stellar SEP-41 assets use 7 decimals. */
  maxAmountRequired: string;
  /** Decimals for `maxAmountRequired`. Stellar SEP-41 == 7. */
  decimals: number;
  /** Recipient address (Bazaar `payTo` filter). */
  payTo: string;
}

/** One documented input parameter of a resource. */
export interface ParamSpec {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  /**
   * Per-parameter natural-language description. RFP §3.2 calls these out as the
   * thing that "makes an endpoint legible to an agent", so they are a
   * first-class retrieval field, not metadata trivia.
   */
  description: string;
}

/**
 * A catalog document: one indexable x402 resource.
 *
 * `id` is the canonical dedup key. For HTTP resources it is the
 * routeTemplate-canonical URL; for MCP resources it is the
 * `(resource.url, input.toolName)` tuple rendered as `mcp://tool/{toolName}`.
 */
export interface CatalogDocument {
  id: string;
  type: ResourceType;
  /** Resource URL as it appears in the Bazaar `resource` block. */
  resource: string;
  serviceName: string;
  description: string;
  tags: string[];
  /** MCP tool name. Present if and only if `type === "mcp"`. */
  toolName?: string;
  params: ParamSpec[];
  accepts: PaymentOption[];
}

/**
 * Deterministic, protocol-level constraints applied BEFORE ranking.
 *
 * These are the Bazaar spec's discovery filters. A document that fails any of
 * them is not a low-ranked result — it is not a result at all. Keeping them out
 * of the scoring function is what stops a semantically similar but unpayable
 * resource from outranking a payable one.
 */
export interface HardFilters {
  type?: ResourceType;
  network?: Caip2Network;
  scheme?: PaymentOption["scheme"];
  asset?: string;
  payTo?: string;
  /** Extension keys that must be present on the listing. */
  extensions?: string[];
}

/** Graded relevance label. Higher is more relevant. */
export type Grade = 0 | 1 | 2 | 3;

/** Which split a query belongs to. Guards against tuning on held-out data. */
export type QuerySplit = "dev" | "heldout";

/**
 * One evaluation query with author-assigned graded judgments.
 *
 * `judgments` maps `CatalogDocument.id` to a grade. Documents absent from the
 * map are treated as grade 0. Labels are committed benchmark data and are never
 * produced by a retriever — see docs/research/bazaar-retrieval-evaluation.md
 * for the labelling protocol and its known limitations.
 */
export interface EvalQuery {
  id: string;
  query: string;
  split: QuerySplit;
  /** Query archetype, used to report per-category breakdowns. */
  category:
    | "exact"
    | "natural-language"
    | "constraint"
    | "ambiguous"
    | "multi-intent"
    | "mcp"
    | "negative";
  /** Hard filters an agent would send alongside this query, if any. */
  filters?: HardFilters;
  judgments: Record<string, Grade>;
}

/** A ranked hit returned by a retriever. */
export interface ScoredHit {
  id: string;
  score: number;
}

/**
 * A retrieval strategy under evaluation.
 *
 * `index` is called once per corpus; `search` is called once per query. Any
 * cost that can be amortised across queries (tokenisation, embeddings, idf
 * tables) belongs in `index` so that `search` latency reflects query-time work.
 */
export interface Retriever {
  readonly name: string;
  /** One-line description printed in the report. */
  readonly description: string;
  index(corpus: CatalogDocument[]): Promise<void>;
  search(query: string, topK: number): Promise<ScoredHit[]>;
}

/** Metric values computed for a single query. */
export interface QueryResult {
  queryId: string;
  split: QuerySplit;
  category: EvalQuery["category"];
  ndcgAt5: number;
  ndcgAt10: number;
  mrrAt10: number;
  recallAt10: number;
  recallAt20: number;
  latencyMs: number;
}

/**
 * Aggregated metrics over a set of queries.
 *
 * Queries with no relevant documents (`category: "negative"`) are EXCLUDED from
 * every field here. nDCG is undefined when the ideal DCG is zero, and the usual
 * conventions (score 0, or score 1) either punish or reward a retriever for
 * something it was never asked to do. Negative queries are reported separately
 * in `RetrieverReport.negatives`.
 */
export interface MetricSummary {
  /** Number of scored queries. Negative-category queries are not counted. */
  queries: number;
  ndcgAt5: number;
  ndcgAt10: number;
  mrrAt10: number;
  recallAt10: number;
  recallAt20: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

/**
 * How a retriever behaves on queries the catalog genuinely cannot serve.
 *
 * `topScore` values are raw retriever scores and are NOT comparable across
 * retrievers (BM25 is unbounded, cosine is bounded). They are comparable within
 * one retriever, against that retriever's scores on answerable queries, which
 * is what makes them useful for calibrating an abstention threshold later.
 */
export interface NegativeSummary {
  queries: number;
  /** Median top-1 score on negative queries. */
  medianTopScore: number;
  /** Median top-1 score on answerable queries, for contrast. */
  medianTopScoreOnAnswerable: number;
  /**
   * `medianTopScore / medianTopScoreOnAnswerable`. Lower is better: it means
   * the retriever's confidence separates answerable from unanswerable queries,
   * which is the precondition for a usable abstention threshold.
   */
  separationRatio: number;
}

/** Full result for one retriever across the benchmark. */
export interface RetrieverReport {
  retriever: string;
  description: string;
  dev: MetricSummary;
  heldout: MetricSummary;
  all: MetricSummary;
  byCategory: Record<string, MetricSummary>;
  negatives: NegativeSummary;
  perQuery: QueryResult[];
}

/** Machine-readable benchmark artifact written to artifacts/retrieval-eval/. */
export interface BenchmarkArtifact {
  schemaVersion: 1;
  generatedAt: string;
  corpus: { version: string; documents: number };
  queries: { version: string; total: number; dev: number; heldout: number };
  environment: { node: string; platform: string };
  reports: RetrieverReport[];
}
