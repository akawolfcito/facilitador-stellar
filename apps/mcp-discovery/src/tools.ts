/**
 * The two agent-facing operations, as plain functions.
 *
 * They are separated from the MCP wiring so they can be unit-tested without a
 * transport, and so it stays obvious what this layer owns:
 *
 *   owns:         MCP schemas, orchestration, error translation
 *   does not own: ranking, settlement, verification, catalog persistence
 *
 * `bazaar_search` is an adapter over `GET /discovery/search`. There is no second
 * search stack here — the same hard filters, the same dense ranking, the same
 * abstention policy and the same cursor semantics apply, because it is literally
 * the same endpoint.
 *
 * `bazaar_pay_and_call` is an adapter over the stock x402 MCP client
 * (`createx402MCPClient` from `@x402/mcp`). It builds no payloads of its own.
 */

import { createx402MCPClient } from "@x402/mcp";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";
import { failure, safeReason, type McpFailure } from "./errors.js";

export interface DiscoveryHit {
  resource: string;
  type: string;
  toolName?: string;
  serviceName?: string;
  description?: string;
  network: string;
  scheme: string;
  asset: string;
  amount: string;
  payTo: string;
  ownershipBinding: string;
  inputSchema?: unknown;
}

export interface SearchInput {
  query: string;
  network?: string;
  scheme?: string;
  asset?: string;
  type?: "http" | "mcp";
  limit?: number;
  cursor?: string;
}

export interface SearchSuccess {
  ok: true;
  results: DiscoveryHit[];
  pagination: { limit: number; cursor: string | null } | null;
  partialResults: boolean;
}

export interface Deps {
  /** Base URL of our facilitator, which serves the discovery endpoints. */
  facilitatorUrl: string;
  /** Buyer secret. Never returned, never logged. */
  buyerSecret: string;
  network: `${string}:${string}`;
  fetchImpl?: typeof fetch;
}

/** Shape of one item in a `/discovery/search` response. */
interface WireResource {
  resource: string;
  type: string;
  toolName?: string;
  serviceName?: string;
  description?: string;
  ownerPayTo?: string;
  ownershipBinding?: string;
  accepts?: Array<{
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
  }>;
  extensions?: Record<string, unknown>;
}

function toHit(item: WireResource): DiscoveryHit {
  const option = item.accepts?.[0];
  const bazaar = item.extensions?.bazaar as
    | { info?: { input?: { inputSchema?: unknown } } }
    | undefined;

  return {
    resource: item.resource,
    type: item.type,
    ...(item.toolName ? { toolName: item.toolName } : {}),
    ...(item.serviceName ? { serviceName: item.serviceName } : {}),
    ...(item.description ? { description: item.description } : {}),
    network: option?.network ?? "",
    scheme: option?.scheme ?? "",
    asset: option?.asset ?? "",
    amount: option?.amount ?? "",
    payTo: option?.payTo ?? "",
    // Surfaced, never hidden: the binding is trust-on-first-use and an agent
    // deciding whether to spend is entitled to know that.
    ownershipBinding: item.ownershipBinding ?? "unknown",
    ...(bazaar?.info?.input?.inputSchema
      ? { inputSchema: bazaar.info.input.inputSchema }
      : {}),
  };
}

export async function bazaarSearch(
  deps: Deps,
  input: SearchInput,
): Promise<SearchSuccess | McpFailure> {
  const doFetch = deps.fetchImpl ?? fetch;
  const params = new URLSearchParams({ query: input.query });
  if (input.network) params.set("network", input.network);
  if (input.scheme) params.set("scheme", input.scheme);
  if (input.type) params.set("type", input.type);
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);

  let body: {
    resources?: WireResource[];
    pagination?: { limit: number; cursor: string | null } | null;
    partialResults?: boolean;
    abstained?: { reason: string; topScore: number; threshold: number };
  };

  try {
    const response = await doFetch(`${deps.facilitatorUrl}/discovery/search?${params}`);
    if (!response.ok) {
      return failure("DISCOVERY_UNAVAILABLE", `discovery returned HTTP ${response.status}`);
    }
    body = (await response.json()) as typeof body;
  } catch (error) {
    return failure("DISCOVERY_UNAVAILABLE", safeReason(error, "discovery endpoint unreachable"));
  }

  if (body.abstained) {
    // The catalog declined to recommend anything. That is an answer, not an
    // error, and it is reported with the reason the engine gave.
    const code =
      body.abstained.reason === "BELOW_RELEVANCE_THRESHOLD"
        ? "BELOW_RELEVANCE_THRESHOLD"
        : "NO_MATCH";
    return failure(
      code,
      `no resource met the relevance threshold (best score ${body.abstained.topScore.toFixed(4)}, ` +
        `threshold ${body.abstained.threshold})`,
    );
  }

  const results = (body.resources ?? []).map(toHit);
  if (results.length === 0) return failure("NO_MATCH", "no resource matched the query");

  // `asset` is not a spec filter on the discovery endpoint, so it is applied
  // here rather than pretended to be server-side.
  const filtered = input.asset ? results.filter((r) => r.asset === input.asset) : results;
  if (filtered.length === 0) {
    return failure("UNSUPPORTED_ASSET", `no result priced in asset ${input.asset}`);
  }

  return {
    ok: true,
    results: filtered,
    pagination: body.pagination ?? null,
    partialResults: body.partialResults ?? false,
  };
}

export interface PayAndCallInput {
  /** Canonical resource from a search result, e.g. `mcp://host:port/tool/name`. */
  resource: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  /** Atomic ceiling. If the live price exceeds it, nothing is signed. */
  maxAmount?: string;
  /** Terms the caller believes it agreed to, from the search result. */
  expected?: { network?: string; scheme?: string; asset?: string; payTo?: string; amount?: string };
}

export interface PayAndCallSuccess {
  ok: true;
  result: unknown;
  payment: {
    transaction: string;
    network: string;
    scheme: string;
    asset: string;
    amount: string;
    payer: string;
    payTo: string;
  };
  timings: { totalMs: number; settlementMs: number };
}

/**
 * Turn `mcp://host:port/tool/name` into the SSE endpoint to connect to.
 *
 * The Bazaar spec has **no field for an MCP server's reachable endpoint**:
 * `McpDiscoveryInfo.transport` is constrained to a transport *kind*
 * (`"sse" | "streamable-http"`), not an address. Its canonical example is
 * `mcp://tool/{toolName}`, which carries no authority and is therefore not
 * dialable — discovery can identify an MCP tool but not reach it.
 *
 * We work around that by having sellers publish an authority in `resource.url`.
 * That keeps the spec's `(resource.url, toolName)` identity intact while making
 * the listing actionable. It is a gap in the spec, recorded in the evidence log
 * as an upstream discussion item, not a private extension: any facilitator
 * reading the same URL reaches the same server.
 */
export function endpointFromResource(resource: string): { base: string } | undefined {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return undefined;
  }
  if (url.protocol !== "mcp:") return undefined;
  if (!url.hostname || url.hostname === "tool") return undefined;
  const port = url.port ? `:${url.port}` : "";
  return { base: `http://${url.hostname}${port}` };
}

/** Terms that must match between the catalog and the live 402. */
const MATERIAL_TERMS = ["network", "scheme", "asset", "payTo", "amount"] as const;

export async function bazaarPayAndCall(
  deps: Deps,
  input: PayAndCallInput,
): Promise<PayAndCallSuccess | McpFailure> {
  const startedAt = performance.now();

  const endpoint = endpointFromResource(input.resource);
  if (!endpoint) {
    return failure(
      "INVALID_RESOURCE",
      "resource is not a dialable mcp:// URL with a host; the listing cannot be reached",
    );
  }

  const buyer = createEd25519Signer(deps.buyerSecret, deps.network);
  const mcp = createx402MCPClient({
    name: "stellar-bazaar-agent",
    version: "0.1.0",
    schemes: [{ network: deps.network, client: new ExactStellarScheme(buyer) }],
    // Defence in depth: the ceiling is enforced here too, so even a bug in the
    // pre-flight check below cannot let the stock client sign something dearer
    // than the caller allowed.
    ...(input.maxAmount !== undefined
      ? {
          policies: [
            (_version: number, accepts: Array<{ amount: string }>) =>
              accepts.filter((a) => BigInt(a.amount) <= BigInt(input.maxAmount!)),
          ] as never,
        }
      : {}),
  });

  try {
    await mcp.connect(new SSEClientTransport(new URL(`${endpoint.base}/sse`)));
  } catch (error) {
    return failure("TOOL_INVOCATION_FAILED", safeReason(error, "could not connect to the MCP server"));
  }

  const args = input.arguments ?? {};

  // ---- the live 402 is the contract -------------------------------------
  // Catalog terms are advisory. They describe what someone paid once, not what
  // this server will charge now. Ask the server itself before signing anything.
  let live: { accepts?: Array<Record<string, unknown>> };
  try {
    live = (await mcp.getToolPaymentRequirements(input.toolName, args)) as typeof live;
  } catch (error) {
    return failure("PAYMENT_FAILED", safeReason(error, "the tool did not return payment requirements"));
  }

  const option = live.accepts?.[0] as
    | { network?: string; scheme?: string; asset?: string; payTo?: string; amount?: string }
    | undefined;
  if (!option) {
    return failure("PAYMENT_FAILED", "the tool returned no acceptable payment requirements");
  }

  if (option.network !== deps.network) {
    return failure(
      "UNSUPPORTED_NETWORK",
      `tool requires ${String(option.network)}, this agent is configured for ${deps.network}`,
    );
  }

  const drift = MATERIAL_TERMS.filter((term) => {
    const want = input.expected?.[term];
    return want !== undefined && want !== option[term];
  });
  if (drift.length > 0) {
    return failure(
      "PAYMENT_REQUIREMENTS_CHANGED",
      `live terms differ from the discovered listing on: ${drift.join(", ")}`,
    );
  }

  if (input.maxAmount !== undefined) {
    let exceeds: boolean;
    try {
      exceeds = BigInt(option.amount ?? "0") > BigInt(input.maxAmount);
    } catch {
      return failure("PRICE_EXCEEDS_LIMIT", "maxAmount is not an integer atomic amount");
    }
    if (exceeds) {
      return failure(
        "PRICE_EXCEEDS_LIMIT",
        `live price ${String(option.amount)} exceeds the ceiling ${input.maxAmount}`,
      );
    }
  }

  // ---- pay, then invoke --------------------------------------------------
  // `autoPayment` defaults to true, so the stock client answers the 402,
  // signs the Soroban auth entry and retries. We build no payload ourselves.
  const settleStart = performance.now();
  let call: Awaited<ReturnType<typeof mcp.callTool>>;
  try {
    call = await mcp.callTool(input.toolName, args);
  } catch (error) {
    return failure("PAYMENT_FAILED", safeReason(error, "payment could not be created or submitted"));
  }
  const settlementMs = performance.now() - settleStart;

  const settlement = call.paymentResponse as
    | { success?: boolean; transaction?: string; errorReason?: string }
    | undefined;

  if (!settlement?.success || !settlement.transaction) {
    return failure(
      "SETTLEMENT_FAILED",
      settlement?.errorReason
        ? `settlement did not complete: ${settlement.errorReason}`
        : "settlement did not complete",
    );
  }

  const paid = {
    transaction: settlement.transaction,
    amount: String(option.amount),
    asset: String(option.asset),
    network: String(option.network),
  };

  if (call.isError) {
    // Money moved and the tool failed. There is no atomicity in x402 across
    // settlement and invocation, so say so with the hash rather than hiding it.
    return failure("TOOL_INVOCATION_FAILED", "the tool returned an error after payment", paid);
  }

  return {
    ok: true,
    result: call.content,
    payment: {
      transaction: settlement.transaction,
      network: String(option.network),
      scheme: String(option.scheme),
      asset: String(option.asset),
      amount: String(option.amount),
      payer: buyer.address,
      payTo: String(option.payTo),
    },
    timings: { totalMs: performance.now() - startedAt, settlementMs },
  };
}
