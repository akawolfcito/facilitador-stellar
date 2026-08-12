/**
 * Versioned synthetic Bazaar catalog.
 *
 * The corpus models what a Stellar x402 facilitator's discovery index would
 * actually hold: services declared through `declareDiscoveryExtension` and
 * cataloged at settlement time. It is synthetic because no Stellar Bazaar index
 * exists yet to sample from — that absence is the whole point of the RFP.
 *
 * Design constraints, all of which exist to stop the benchmark from being easy:
 *
 * 1. Near-duplicate families. `weather`, `historical weather`, `weather alerts`
 *    and `shipping weather risk` all exist, so lexical overlap alone cannot
 *    identify the right one.
 * 2. Lexical distractors. "token translation" is a text-encoding service, not a
 *    language one; "price" spans market data, shipping quotes and FX.
 * 3. Mixed networks. Most listings are `stellar:testnet`, some are
 *    `stellar:pubnet`, and a handful are EVM/SVM so that network hard filters
 *    have something to exclude.
 * 4. Both resource types. HTTP endpoints and MCP tools, the latter keyed on
 *    `mcp://tool/{toolName}` per specs/extensions/bazaar.md.
 *
 * Asset contract ids are the real ones from `@x402/stellar@2.22.0`
 * `src/constants.ts` (USDC_TESTNET_ADDRESS / USDC_PUBNET_ADDRESS); everything
 * else — service names, descriptions, `payTo` addresses — is invented.
 */

import type { CatalogDocument, ParamSpec, PaymentOption } from "../types.js";

export const CORPUS_VERSION = "2026-08-11.1";

const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const USDC_PUBNET = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Synthetic seller addresses. Distinct sellers matter for the payTo filter. */
const SELLERS = {
  meteo: "GAMETEO4WXHQ7ZKPRQ6ULMDT3XSWWZQ2VJHNKQ7BLGXAMETEO000001",
  lingua: "GALINGUA5RTYU2MNBVCXZLKJHGFDSAQWERTYUIOPLKJHLINGUA00002",
  pixel: "GAPIXEL6QWERTYUIOPASDFGHJKLZXCVBNMQWERTYUIPIXEL000003",
  ledger: "GALEDGER7ZXCVBNMASDFGHJKLQWERTYUIOPZXCVBNMLEDGER0004",
  cargo: "GACARGO8MNBVCXZASDFGHJKLPOIUYTREWQMNBVCXZACARGO00005",
  ident: "GAIDENT9POIUYTREWQLKJHGFDSAMNBVCXZQWERTYUIDENT00006",
  vector: "GAVECTORAQWERTYUIOPLKJHGFDSAZXCVBNMQWERTYVECTOR0007",
  travel: "GATRAVELBLKJHGFDSAPOIUYTREWQMNBVCXZASDFGHTRAVEL0008",
} as const;

interface PriceSpec {
  /** Atomic amount. Stellar SEP-41 assets use 7 decimals: $0.001 -> "10000". */
  amount: string;
  network?: PaymentOption["network"];
  scheme?: PaymentOption["scheme"];
  seller?: keyof typeof SELLERS;
}

function payment({
  amount,
  network = "stellar:testnet",
  scheme = "exact",
  seller = "meteo",
}: PriceSpec): PaymentOption {
  const known: Record<string, { asset: string; assetSymbol: string; decimals: number }> = {
    "stellar:testnet": { asset: USDC_TESTNET, assetSymbol: "USDC", decimals: 7 },
    "stellar:pubnet": { asset: USDC_PUBNET, assetSymbol: "USDC", decimals: 7 },
    "eip155:8453": { asset: USDC_BASE, assetSymbol: "USDC", decimals: 6 },
  };
  const a = known[network] ?? known["stellar:testnet"]!;
  return {
    scheme,
    network,
    asset: a.asset,
    assetSymbol: a.assetSymbol,
    maxAmountRequired: amount,
    decimals: a.decimals,
    payTo: SELLERS[seller],
  };
}

function p(name: string, description: string, required = true, type: ParamSpec["type"] = "string"): ParamSpec {
  return { name, type, required, description };
}

function http(
  slug: string,
  serviceName: string,
  description: string,
  tags: string[],
  params: ParamSpec[],
  price: PriceSpec,
): CatalogDocument {
  const resource = `https://${slug.split("/")[0]}.example.com/${slug.split("/").slice(1).join("/")}`;
  return {
    id: resource,
    type: "http",
    resource,
    serviceName,
    description,
    tags,
    params,
    accepts: [payment(price)],
  };
}

function mcp(
  toolName: string,
  serviceName: string,
  description: string,
  tags: string[],
  params: ParamSpec[],
  price: PriceSpec,
): CatalogDocument {
  const resource = `mcp://tool/${toolName}`;
  return {
    id: resource,
    type: "mcp",
    resource,
    serviceName,
    description,
    tags,
    toolName,
    params,
    accepts: [payment(price)],
  };
}

/**
 * The catalog.
 *
 * Grouped by family so that the adversarial structure is visible in the source
 * rather than buried in a flat list.
 */
export const CORPUS: CatalogDocument[] = [
  // ---- weather family: four services, heavy lexical overlap -----------------
  http(
    "meteo/v1/forecast",
    "Meteo Forecast",
    "Short-range weather forecast for a city or coordinate pair. Returns temperature, precipitation probability, wind speed and conditions for the next 48 hours.",
    ["weather", "forecast", "rain", "temperature", "meteorology"],
    [p("city", "City name to forecast, for example Medellin"), p("hours", "Forecast horizon in hours, 1 to 48", false, "number")],
    { amount: "10000", seller: "meteo" },
  ),
  http(
    "meteo/v1/history",
    "Meteo Historical Weather",
    "Historical weather observations for a location and date range. Daily aggregates of temperature, rainfall and wind going back thirty years.",
    ["weather", "historical", "climate", "archive", "observations"],
    [p("city", "City name to look up"), p("from", "Start date, ISO 8601"), p("to", "End date, ISO 8601")],
    { amount: "25000", seller: "meteo" },
  ),
  http(
    "meteo/v1/alerts",
    "Meteo Severe Weather Alerts",
    "Active severe weather warnings and advisories issued by national meteorological agencies for a region. Covers storms, floods, heat and wind.",
    ["weather", "alerts", "warnings", "severe", "storm", "safety"],
    [p("region", "ISO country or subdivision code")],
    { amount: "15000", seller: "meteo" },
  ),
  http(
    "cargo/v1/weather-risk",
    "Cargo Weather Risk Score",
    "Weather-driven delay risk score for a shipping lane. Combines forecast conditions along the route with historical port congestion to estimate probability of late delivery.",
    ["shipping", "logistics", "risk", "weather", "supply-chain", "delay"],
    [p("origin", "Origin port UN/LOCODE"), p("destination", "Destination port UN/LOCODE")],
    { amount: "120000", seller: "cargo" },
  ),

  // ---- translation family + deliberate lexical distractor ------------------
  http(
    "lingua/v1/translate",
    "Lingua Text Translation",
    "Translate short text between one hundred languages. Automatic source language detection, formal and informal register options.",
    ["translation", "language", "nlp", "localization", "i18n"],
    [p("text", "Text to translate, up to 5000 characters"), p("target", "Target language code, for example es or ja"), p("source", "Source language code; omit to auto-detect", false)],
    { amount: "5000", seller: "lingua" },
  ),
  http(
    "lingua/v1/translate-document",
    "Lingua Document Translation",
    "Translate a whole PDF, DOCX or HTML document while preserving layout, tables and inline formatting. Returns a download URL for the translated file.",
    ["translation", "document", "pdf", "docx", "layout", "localization"],
    [p("documentUrl", "Publicly reachable URL of the source document"), p("target", "Target language code")],
    { amount: "450000", seller: "lingua" },
  ),
  http(
    "lingua/v1/translate-speech",
    "Lingua Speech Translation",
    "Translate spoken audio into text in another language. Accepts WAV, MP3 and OGG, performs transcription and translation in a single call.",
    ["translation", "speech", "audio", "transcription", "asr", "voice"],
    [p("audioUrl", "URL of the audio file to translate"), p("target", "Target language code")],
    { amount: "80000", seller: "lingua" },
  ),
  http(
    "ledger/v1/token-translation",
    "Token Translation Table",
    "Map a token symbol or contract address to its canonical identifiers across chains. Despite the name this performs no language translation; it resolves asset identifiers.",
    ["tokens", "identifiers", "mapping", "cross-chain", "metadata", "translation"],
    [p("symbol", "Token symbol to resolve, for example USDC")],
    { amount: "3000", seller: "ledger" },
  ),

  // ---- price / market data: the "price" ambiguity cluster -------------------
  http(
    "ledger/v1/token-price",
    "Ledger Token Prices",
    "Spot price for a crypto asset in USD or any supported quote currency. Volume weighted across major venues, updated every ten seconds.",
    ["price", "crypto", "market-data", "spot", "tokens", "oracle"],
    [p("symbol", "Asset symbol, for example XLM or BTC"), p("quote", "Quote currency, defaults to USD", false)],
    { amount: "2000", seller: "ledger" },
  ),
  http(
    "ledger/v1/fx",
    "Ledger FX Conversion",
    "Convert an amount between fiat currencies at the current interbank rate. Supports one hundred and fifty currencies with mid-market and bid-ask pricing.",
    ["fx", "currency", "conversion", "forex", "exchange-rate", "price", "fiat"],
    [p("from", "Source currency ISO 4217 code"), p("to", "Target currency ISO 4217 code"), p("amount", "Amount to convert", true, "number")],
    { amount: "2000", seller: "ledger" },
  ),
  http(
    "cargo/v1/quote",
    "Cargo Shipping Quote",
    "Price a freight shipment between two addresses. Returns carrier options with cost, transit time and service level for parcel, pallet and container loads.",
    ["shipping", "quote", "price", "freight", "logistics", "carrier"],
    [p("origin", "Origin postal code"), p("destination", "Destination postal code"), p("weightKg", "Gross weight in kilograms", true, "number")],
    { amount: "60000", seller: "cargo" },
  ),
  http(
    "ledger/v1/historical-price",
    "Ledger Historical Prices",
    "OHLCV candles for a crypto asset over a chosen interval and date range. Minute, hourly and daily resolutions available.",
    ["price", "historical", "ohlcv", "candles", "market-data", "crypto"],
    [p("symbol", "Asset symbol"), p("interval", "Candle interval: 1m, 1h or 1d"), p("from", "Range start, ISO 8601")],
    { amount: "9000", seller: "ledger", network: "stellar:pubnet" },
  ),

  // ---- image / vision -------------------------------------------------------
  http(
    "pixel/v1/generate",
    "Pixel Image Generation",
    "Generate an image from a text prompt. Supports aspect ratio, style presets and a negative prompt; returns a hosted PNG URL valid for 24 hours.",
    ["image", "generation", "ai", "text-to-image", "art", "diffusion"],
    [p("prompt", "Text description of the image to generate"), p("aspectRatio", "Aspect ratio such as 1:1 or 16:9", false)],
    { amount: "300000", seller: "pixel" },
  ),
  http(
    "pixel/v1/ocr",
    "Pixel OCR",
    "Extract text from an image or scanned page. Handles rotated pages, multi-column layouts and handwriting, returning text with bounding boxes.",
    ["ocr", "text-extraction", "vision", "scan", "document", "handwriting"],
    [p("imageUrl", "URL of the image to read"), p("language", "Expected language hint", false)],
    { amount: "40000", seller: "pixel" },
  ),
  http(
    "pixel/v1/upscale",
    "Pixel Image Upscale",
    "Increase the resolution of an image up to four times using a learned upscaler, preserving edges and text legibility.",
    ["image", "upscale", "super-resolution", "enhance", "vision"],
    [p("imageUrl", "URL of the image to upscale"), p("factor", "Scale factor, 2 or 4", false, "number")],
    { amount: "150000", seller: "pixel" },
  ),
  http(
    "pixel/v1/describe",
    "Pixel Image Description",
    "Produce a natural language caption and structured tags for an image, including detected objects, scene type and readable text.",
    ["image", "caption", "vision", "tagging", "alt-text", "accessibility"],
    [p("imageUrl", "URL of the image to describe")],
    { amount: "35000", seller: "pixel" },
  ),

  // ---- documents / text -----------------------------------------------------
  http(
    "lingua/v1/summarize",
    "Lingua Document Summary",
    "Summarize a long document into a short abstract, bullet points or an executive brief. Accepts PDF, plain text and HTML up to two hundred pages.",
    ["summarization", "document", "pdf", "nlp", "abstract", "condense"],
    [p("documentUrl", "URL of the document to summarize"), p("style", "Output style: abstract, bullets or brief", false)],
    { amount: "70000", seller: "lingua" },
  ),
  http(
    "lingua/v1/extract",
    "Lingua Structured Extraction",
    "Pull structured fields out of unstructured text or documents given a JSON schema. Useful for invoices, contracts and forms.",
    ["extraction", "structured-data", "parsing", "invoice", "nlp", "schema"],
    [p("documentUrl", "URL of the source document"), p("schema", "JSON Schema describing the fields to extract")],
    { amount: "90000", seller: "lingua" },
  ),
  http(
    "lingua/v1/classify",
    "Lingua Text Classification",
    "Assign one or more labels to a piece of text from a caller-supplied label set, with confidence scores.",
    ["classification", "nlp", "labels", "categorization", "text"],
    [p("text", "Text to classify"), p("labels", "Comma-separated candidate labels")],
    { amount: "8000", seller: "lingua" },
  ),

  // ---- search ---------------------------------------------------------------
  http(
    "vector/v1/web-search",
    "Vector Web Search",
    "Search the live web and return ranked results with titles, URLs and extracted snippets. Freshness filter and site restriction supported.",
    ["search", "web", "serp", "results", "crawl", "index"],
    [p("query", "Search query"), p("freshness", "Restrict to results newer than: day, week or month", false)],
    { amount: "12000", seller: "vector" },
  ),
  http(
    "vector/v1/vector-search",
    "Vector Similarity Search",
    "Nearest-neighbour search over a hosted embedding collection. Upsert vectors, then query by vector or by text with automatic embedding.",
    ["vector", "embeddings", "similarity", "ann", "retrieval", "search", "rag"],
    [p("collection", "Collection name to search"), p("query", "Query text or vector"), p("topK", "Number of neighbours to return", false, "number")],
    { amount: "6000", seller: "vector" },
  ),
  http(
    "vector/v1/embed",
    "Vector Embeddings",
    "Turn text into dense vectors for retrieval and clustering. Batch requests up to one thousand inputs per call.",
    ["embeddings", "vectors", "nlp", "representation", "rag"],
    [p("input", "Text to embed, or a JSON array of texts")],
    { amount: "1000", seller: "vector" },
  ),
  http(
    "vector/v1/rerank",
    "Vector Reranker",
    "Reorder a candidate list against a query using a cross-encoder, improving the precision of a first-stage retriever.",
    ["rerank", "retrieval", "relevance", "cross-encoder", "search", "ranking"],
    [p("query", "The user query"), p("documents", "JSON array of candidate documents")],
    { amount: "7000", seller: "vector" },
  ),

  // ---- travel ---------------------------------------------------------------
  http(
    "travel/v1/flight-search",
    "Travel Flight Search",
    "Find bookable flights between two airports on a date, with fare, airline, duration and stop count for each itinerary.",
    ["travel", "flights", "search", "airfare", "booking", "itinerary"],
    [p("origin", "Origin airport IATA code"), p("destination", "Destination airport IATA code"), p("date", "Departure date, ISO 8601")],
    { amount: "50000", seller: "travel" },
  ),
  http(
    "travel/v1/flight-status",
    "Travel Flight Status",
    "Live status for a specific flight: gate, delay minutes, departure and arrival estimates, and aircraft registration.",
    ["travel", "flights", "status", "delay", "gate", "live"],
    [p("flightNumber", "Flight number including carrier code, for example AV8020"), p("date", "Scheduled date of the flight")],
    { amount: "15000", seller: "travel" },
  ),
  http(
    "travel/v1/hotel-search",
    "Travel Hotel Search",
    "Search available hotels in a city for a date range, returning nightly rate, rating, distance to centre and cancellation policy.",
    ["travel", "hotels", "accommodation", "search", "booking", "lodging"],
    [p("city", "City to search"), p("checkIn", "Check-in date"), p("checkOut", "Check-out date")],
    { amount: "50000", seller: "travel" },
  ),

  // ---- identity / trust -----------------------------------------------------
  http(
    "ident/v1/email-verify",
    "Ident Email Verification",
    "Check whether an email address is deliverable. Syntax, domain, MX and mailbox checks plus disposable-provider detection.",
    ["email", "verification", "deliverability", "validation", "anti-fraud"],
    [p("email", "Email address to verify")],
    { amount: "4000", seller: "ident" },
  ),
  http(
    "ident/v1/phone-verify",
    "Ident Phone Verification",
    "Validate a phone number and return line type, carrier and country, flagging numbers associated with fraud.",
    ["phone", "verification", "validation", "carrier", "anti-fraud"],
    [p("phone", "Phone number in E.164 format")],
    { amount: "6000", seller: "ident" },
  ),
  http(
    "ident/v1/fraud-score",
    "Ident Fraud Score",
    "Risk score for a transaction or signup from device, network and behavioural signals. Returns a 0 to 100 score with contributing reasons.",
    ["fraud", "risk", "score", "anti-abuse", "security", "trust"],
    [p("ip", "Client IP address"), p("email", "Account email", false), p("amount", "Transaction amount in USD", false, "number")],
    { amount: "20000", seller: "ident" },
  ),
  http(
    "ident/v1/kyc-check",
    "Ident Identity Verification",
    "Verify a person against government identity documents and sanctions lists, returning a match decision and evidence references.",
    ["kyc", "identity", "compliance", "sanctions", "aml", "verification"],
    [p("documentUrl", "URL of the identity document image"), p("fullName", "Full legal name as printed")],
    { amount: "900000", seller: "ident", network: "stellar:pubnet" },
  ),

  // ---- blockchain / Stellar-specific ----------------------------------------
  http(
    "ledger/v1/stellar-rpc",
    "Ledger Stellar RPC",
    "Metered access to a Soroban RPC endpoint on testnet and pubnet. Standard JSON-RPC methods with per-request billing and no monthly minimum.",
    ["rpc", "stellar", "soroban", "node", "infrastructure", "blockchain"],
    [p("method", "JSON-RPC method name"), p("params", "JSON-encoded parameter array", false)],
    { amount: "500", seller: "ledger" },
  ),
  http(
    "ledger/v1/stellar-analytics",
    "Ledger Stellar Analytics",
    "Aggregated on-chain metrics for a Stellar account or asset: transfer volume, holder counts, trustline growth and top counterparties.",
    ["analytics", "stellar", "onchain", "metrics", "blockchain", "data"],
    [p("account", "Stellar account or contract address"), p("window", "Lookback window: 24h, 7d or 30d", false)],
    { amount: "30000", seller: "ledger" },
  ),
  http(
    "ledger/v1/trustline-check",
    "Ledger Trustline Checker",
    "Check whether a Stellar account holds a trustline for a SEP-41 asset, and report the balance and authorization flags.",
    ["stellar", "trustline", "sep-41", "account", "asset", "payments"],
    [p("account", "Stellar account address to inspect"), p("asset", "Asset contract address")],
    { amount: "1000", seller: "ledger" },
  ),
  http(
    "ledger/v1/tx-decode",
    "Ledger Transaction Decoder",
    "Decode a Stellar or Soroban transaction envelope into human-readable operations, including auth entries and contract invocations.",
    ["stellar", "soroban", "transaction", "decode", "xdr", "debugging"],
    [p("xdr", "Base64-encoded transaction envelope")],
    { amount: "1000", seller: "ledger" },
  ),
  http(
    "ledger/v1/evm-analytics",
    "Ledger EVM Analytics",
    "On-chain analytics for EVM addresses: token flows, counterparties and contract interaction history across Base and Ethereum.",
    ["analytics", "evm", "ethereum", "base", "onchain", "blockchain"],
    [p("address", "EVM address to analyse")],
    { amount: "30000", seller: "ledger", network: "eip155:8453" },
  ),

  // ---- compute --------------------------------------------------------------
  http(
    "vector/v1/code-exec",
    "Vector Code Execution",
    "Run a short Python or JavaScript snippet in an isolated sandbox and return stdout, stderr and any produced files. Ten second wall clock limit.",
    ["code", "execution", "sandbox", "python", "javascript", "compute", "repl"],
    [p("language", "Either python or javascript"), p("source", "Source code to run")],
    { amount: "20000", seller: "vector" },
  ),
  http(
    "vector/v1/render",
    "Vector Chart Render",
    "Render a chart specification to PNG or SVG. Accepts a Vega-Lite spec and returns a hosted image.",
    ["chart", "render", "visualization", "svg", "png", "graph"],
    [p("spec", "Vega-Lite specification as JSON")],
    { amount: "10000", seller: "vector" },
  ),
  http(
    "vector/v1/scrape",
    "Vector Page Scraper",
    "Fetch a web page and return clean article text, metadata and links, with JavaScript rendering for dynamic pages.",
    ["scrape", "crawl", "extraction", "web", "html", "content"],
    [p("url", "URL of the page to fetch"), p("render", "Execute JavaScript before extracting", false, "boolean")],
    { amount: "8000", seller: "vector" },
  ),

  // ---- MCP tools ------------------------------------------------------------
  mcp(
    "summarize_pdf",
    "PDF Summarizer Tool",
    "MCP tool that downloads a PDF and returns a structured summary with section headings, key findings and a list of cited sources.",
    ["mcp", "pdf", "summarization", "document", "agent", "tool"],
    [p("url", "URL of the PDF to summarize"), p("maxWords", "Approximate length of the summary", false, "number")],
    { amount: "70000", seller: "lingua" },
  ),
  mcp(
    "web_search",
    "Web Search Tool",
    "MCP tool giving an agent live web search with ranked results and snippets, billed per query.",
    ["mcp", "search", "web", "agent", "tool", "research"],
    [p("query", "Search query")],
    { amount: "12000", seller: "vector" },
  ),
  mcp(
    "get_weather",
    "Weather Tool",
    "MCP tool returning current conditions and a short forecast for a named location, for agents that need weather without an HTTP integration.",
    ["mcp", "weather", "forecast", "agent", "tool", "conditions"],
    [p("location", "City name or coordinates")],
    { amount: "10000", seller: "meteo" },
  ),
  mcp(
    "convert_currency",
    "Currency Conversion Tool",
    "MCP tool converting an amount between currencies at live rates, including crypto to fiat pairs.",
    ["mcp", "fx", "currency", "conversion", "agent", "tool", "price"],
    [p("from", "Source currency code"), p("to", "Target currency code"), p("amount", "Amount to convert", true, "number")],
    { amount: "2000", seller: "ledger" },
  ),
  mcp(
    "run_sql",
    "SQL Query Tool",
    "MCP tool that runs a read-only SQL query against a hosted analytics warehouse and returns rows as JSON.",
    ["mcp", "sql", "database", "query", "analytics", "agent", "tool"],
    [p("query", "Read-only SQL statement to execute")],
    { amount: "25000", seller: "vector" },
  ),
  mcp(
    "send_stellar_payment",
    "Stellar Payment Tool",
    "MCP tool that builds and submits a SEP-41 asset payment on Stellar, handling trustline checks and fee sponsorship for the caller.",
    ["mcp", "stellar", "payment", "sep-41", "agent", "tool", "usdc"],
    [p("destination", "Recipient Stellar address"), p("amount", "Amount to send", true, "number"), p("asset", "Asset contract address", false)],
    { amount: "5000", seller: "ledger" },
  ),
  mcp(
    "extract_invoice",
    "Invoice Extraction Tool",
    "MCP tool that reads an invoice image or PDF and returns line items, totals, tax and supplier details as structured JSON.",
    ["mcp", "invoice", "extraction", "ocr", "accounting", "agent", "tool"],
    [p("url", "URL of the invoice file")],
    { amount: "90000", seller: "lingua" },
  ),
  mcp(
    "geocode",
    "Geocoding Tool",
    "MCP tool converting a free-form address into latitude and longitude with a confidence score, and the reverse.",
    ["mcp", "geocoding", "address", "coordinates", "maps", "agent", "tool"],
    [p("address", "Address or place name to geocode")],
    { amount: "3000", seller: "travel" },
  ),
  mcp(
    "translate_text",
    "Translation Tool",
    "MCP tool translating text between languages with automatic source detection, for agents operating across locales.",
    ["mcp", "translation", "language", "agent", "tool", "i18n"],
    [p("text", "Text to translate"), p("target", "Target language code")],
    { amount: "5000", seller: "lingua" },
  ),
  mcp(
    "check_flight_status",
    "Flight Status Tool",
    "MCP tool returning live status, gate and delay information for a flight number on a given date.",
    ["mcp", "travel", "flights", "status", "agent", "tool"],
    [p("flightNumber", "Flight number with carrier code"), p("date", "Scheduled date")],
    { amount: "15000", seller: "travel" },
  ),

  // ---- long tail, to give the index realistic breadth -----------------------
  http(
    "ident/v1/company-lookup",
    "Ident Company Lookup",
    "Resolve a company name or registration number to its official record: legal name, jurisdiction, status and registered address.",
    ["company", "registry", "lookup", "business", "compliance", "data"],
    [p("name", "Company name or registration number"), p("jurisdiction", "ISO country code", false)],
    { amount: "40000", seller: "ident" },
  ),
  http(
    "cargo/v1/track",
    "Cargo Shipment Tracking",
    "Track a parcel or container across carriers from a single tracking number, returning normalised status events and an ETA.",
    ["shipping", "tracking", "logistics", "parcel", "container", "eta"],
    [p("trackingNumber", "Carrier tracking number")],
    { amount: "10000", seller: "cargo" },
  ),
  http(
    "cargo/v1/customs",
    "Cargo Customs Duty Estimate",
    "Estimate import duty and tax for a shipment given HS code, declared value and destination country.",
    ["customs", "duty", "tax", "import", "trade", "logistics", "price"],
    [p("hsCode", "Harmonised System commodity code"), p("value", "Declared value in USD", true, "number"), p("destination", "Destination country code")],
    { amount: "35000", seller: "cargo" },
  ),
  http(
    "pixel/v1/background-remove",
    "Pixel Background Removal",
    "Remove the background from a photograph and return a transparent PNG, with edge refinement for hair and fine detail.",
    ["image", "background", "cutout", "transparent", "vision", "editing"],
    [p("imageUrl", "URL of the image to process")],
    { amount: "45000", seller: "pixel" },
  ),
  http(
    "pixel/v1/moderate",
    "Pixel Content Moderation",
    "Classify an image or block of text against a safety taxonomy, returning per-category scores for adult, violent and abusive content.",
    ["moderation", "safety", "classification", "abuse", "trust", "vision"],
    [p("imageUrl", "URL of the image to moderate", false), p("text", "Text to moderate", false)],
    { amount: "15000", seller: "pixel" },
  ),
  http(
    "vector/v1/geoip",
    "Vector GeoIP Lookup",
    "Resolve an IP address to country, region, city, ASN and connection type.",
    ["geoip", "ip", "location", "network", "asn", "lookup"],
    [p("ip", "IPv4 or IPv6 address")],
    { amount: "1000", seller: "vector" },
  ),
  http(
    "meteo/v1/air-quality",
    "Meteo Air Quality",
    "Current and forecast air quality index for a location, with pollutant breakdown for PM2.5, PM10, ozone and nitrogen dioxide.",
    ["air-quality", "aqi", "pollution", "environment", "health", "forecast"],
    [p("city", "City name"), p("hours", "Forecast horizon in hours", false, "number")],
    { amount: "12000", seller: "meteo" },
  ),
  http(
    "meteo/v1/marine",
    "Meteo Marine Conditions",
    "Wave height, swell direction, sea temperature and tide times for a coastal point, for shipping and recreation.",
    ["marine", "waves", "tides", "ocean", "sea", "forecast", "weather"],
    [p("lat", "Latitude", true, "number"), p("lon", "Longitude", true, "number")],
    { amount: "18000", seller: "meteo" },
  ),
  http(
    "travel/v1/visa-requirements",
    "Travel Visa Requirements",
    "Entry requirements for a passport holder travelling to a destination: visa type, maximum stay and required documents.",
    ["travel", "visa", "immigration", "passport", "requirements", "borders"],
    [p("passport", "Passport country ISO code"), p("destination", "Destination country ISO code")],
    { amount: "20000", seller: "travel" },
  ),
  http(
    "travel/v1/currency-tips",
    "Travel Money Guide",
    "Practical money guidance for a destination: typical card acceptance, ATM fees, tipping norms and cash denominations in use.",
    ["travel", "money", "cash", "tipping", "guide", "currency"],
    [p("country", "Destination country ISO code")],
    { amount: "8000", seller: "travel" },
  ),
  http(
    "lingua/v1/grammar",
    "Lingua Grammar Check",
    "Correct grammar, spelling and punctuation in a passage of text and explain each change.",
    ["grammar", "spelling", "proofreading", "writing", "nlp", "editing"],
    [p("text", "Text to proofread"), p("dialect", "Language dialect, for example en-GB", false)],
    { amount: "5000", seller: "lingua" },
  ),
  http(
    "lingua/v1/sentiment",
    "Lingua Sentiment Analysis",
    "Score the sentiment and emotional tone of text, returning polarity, intensity and detected emotions.",
    ["sentiment", "emotion", "nlp", "analysis", "polarity", "text"],
    [p("text", "Text to analyse")],
    { amount: "4000", seller: "lingua" },
  ),
  http(
    "ledger/v1/gas-estimate",
    "Ledger Fee Estimator",
    "Estimate the network fee for a transaction on Stellar, Base or Solana at current congestion, with fast and economy tiers.",
    ["fees", "gas", "estimate", "stellar", "solana", "base", "blockchain"],
    [p("network", "CAIP-2 network identifier"), p("txSize", "Approximate transaction size in bytes", false, "number")],
    { amount: "500", seller: "ledger" },
  ),
  http(
    "ident/v1/sanctions-screen",
    "Ident Sanctions Screening",
    "Screen a name or wallet address against global sanctions and politically exposed person lists, returning matches with confidence.",
    ["sanctions", "screening", "compliance", "aml", "pep", "risk"],
    [p("name", "Name to screen", false), p("address", "Wallet address to screen", false)],
    { amount: "60000", seller: "ident" },
  ),
  http(
    "vector/v1/dedupe",
    "Vector Record Deduplication",
    "Find duplicate and near-duplicate records in a supplied dataset using fuzzy matching over chosen key fields.",
    ["deduplication", "matching", "records", "data-quality", "fuzzy", "etl"],
    [p("records", "JSON array of records"), p("keys", "Comma-separated field names to match on")],
    { amount: "25000", seller: "vector" },
  ),
  http(
    "pixel/v1/qr-decode",
    "Pixel QR and Barcode Decoder",
    "Decode QR codes and one-dimensional barcodes from an image, returning payloads and their positions.",
    ["qr", "barcode", "decode", "scan", "vision", "image"],
    [p("imageUrl", "URL of the image containing the code")],
    { amount: "3000", seller: "pixel" },
  ),
  http(
    "cargo/v1/port-congestion",
    "Cargo Port Congestion",
    "Current berth waiting times and vessel queue length for a port, with a seven day trend.",
    ["port", "congestion", "shipping", "logistics", "vessels", "delay"],
    [p("port", "Port UN/LOCODE")],
    { amount: "30000", seller: "cargo" },
  ),
];

/** Fail fast if the corpus ever develops duplicate canonical ids. */
export function assertCorpusIntegrity(docs: CatalogDocument[] = CORPUS): void {
  const seen = new Set<string>();
  for (const doc of docs) {
    if (seen.has(doc.id)) throw new Error(`duplicate corpus id: ${doc.id}`);
    seen.add(doc.id);
    if (doc.type === "mcp" && !doc.toolName) {
      throw new Error(`mcp document without toolName: ${doc.id}`);
    }
    if (doc.type === "http" && doc.toolName) {
      throw new Error(`http document with toolName: ${doc.id}`);
    }
    if (doc.accepts.length === 0) throw new Error(`document without accepts: ${doc.id}`);
  }
}
