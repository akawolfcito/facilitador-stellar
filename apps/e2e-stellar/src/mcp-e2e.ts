/**
 * E-22/E-23/E-24/E-25: an agent discovers a paid MCP tool by intent, decides it
 * is worth paying for, pays over Stellar, and invokes it.
 *
 * `pnpm --filter @stellar-bazaar/e2e-stellar mcp`
 *
 * The agent is given a *sentence*, never a URL. Everything it needs to reach and
 * pay the tool comes out of `bazaar_search`. That is the property being proven:
 * no pre-baked integration between buyer and seller.
 */

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { buildFacilitator } from "@stellar-bazaar/facilitator/app";
import { loadConfig } from "@stellar-bazaar/facilitator/config";
import { bazaarPayAndCall, bazaarSearch, type Deps } from "@stellar-bazaar/mcp-discovery/tools";
import { USDC_TESTNET_ADDRESS, createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { x402Client } from "@x402/core/client";
import { createx402MCPClient } from "@x402/mcp";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { TOOL_NAME, startToolServer } from "./mcp-tool-server.js";

const NETWORK = "stellar:testnet" as const;
const FACILITATOR_PORT = 4530;
const TOOL_PORT = 4531;
const AMOUNT = "10000";

function loadEnvFile(): Record<string, string> {
  const raw = readFileSync(new URL("../.env.e2e", import.meta.url), "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

interface Check {
  name: string;
  status: "PASS" | "FAIL";
  detail: string;
}
const checks: Check[] = [];
function record(name: string, status: Check["status"], detail: string): void {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name.padEnd(38)} ${detail}`);
}

async function main(): Promise<void> {
  const env = loadEnvFile();
  const startedAt = new Date().toISOString();
  console.log("E-22 · agent discovers a paid MCP tool by intent, pays, invokes\n");

  const catalogPath = new URL("../.catalog-mcp.db", import.meta.url).pathname;
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${catalogPath}${suffix}`, { force: true });

  const config = loadConfig({
    PORT: String(FACILITATOR_PORT),
    STELLAR_NETWORK: "testnet",
    SIGNER_SECRET_KEYS: env.E2E_FACILITATOR_SECRET,
    STELLAR_RPC_URL: env.STELLAR_RPC_URL,
    CATALOG_PATH: catalogPath,
  });
  const built = buildFacilitator(config);
  await built.app.listen({ port: FACILITATOR_PORT, host: "127.0.0.1" });
  const facilitatorUrl = `http://127.0.0.1:${FACILITATOR_PORT}`;

  const tool = await startToolServer({
    port: TOOL_PORT,
    facilitatorUrl,
    network: NETWORK,
    payTo: env.E2E_SELLER_ADDRESS!,
    asset: USDC_TESTNET_ADDRESS,
    amount: AMOUNT,
  });

  // ---- 1. the tool enters the catalog the only way it can: by being paid ----
  // This first payment is the seed. It uses the stock MCP client directly,
  // because nothing is discoverable yet — there is nothing to search for.
  const buyer = createEd25519Signer(env.E2E_BUYER_SECRET!, NETWORK);
  const seedClient = createx402MCPClient({
    name: "seed",
    version: "0.1.0",
    schemes: [{ network: NETWORK, client: new ExactStellarScheme(buyer) }],
  });
  await seedClient.connect(new SSEClientTransport(new URL(`http://127.0.0.1:${TOOL_PORT}/sse`)));
  const seed = await seedClient.callTool(TOOL_NAME, { text: "seed payment to catalog this tool" });
  const seedSettlement = seed.paymentResponse as { success?: boolean; transaction?: string } | undefined;
  record(
    "tool cataloged by a real payment",
    seedSettlement?.success === true ? "PASS" : "FAIL",
    seedSettlement?.transaction ? `tx ${seedSettlement.transaction.slice(0, 16)}…` : "no settlement",
  );

  await built.searchSettled();

  // ---- 2. the agent gets a sentence, not a URL ----------------------------
  const deps: Deps = { facilitatorUrl, buyerSecret: env.E2E_BUYER_SECRET!, network: NETWORK };
  const QUERY = "I need something that can condense a long passage of text";

  const search = await bazaarSearch(deps, { query: QUERY, type: "mcp" });
  if (!("ok" in search) || !search.ok) {
    record("bazaar_search", "FAIL", `abstained/failed: ${JSON.stringify(search)}`);
    throw new Error("search did not return the tool");
  }

  const hit = search.results.find((r) => r.toolName === TOOL_NAME);
  record(
    "agent discovers the tool by intent",
    hit ? "PASS" : "FAIL",
    hit ? `${hit.serviceName} → ${hit.resource}` : `${search.results.length} results, none matching`,
  );
  if (!hit) throw new Error("tool not discovered");

  record(
    "discovery carries what is needed to pay",
    hit.network && hit.asset && hit.amount && hit.payTo && hit.inputSchema ? "PASS" : "FAIL",
    `${hit.network} ${hit.amount} ${hit.asset.slice(0, 10)}… schema=${hit.inputSchema ? "yes" : "no"}`,
  );
  record("ownership binding is visible", hit.ownershipBinding === "tofu" ? "PASS" : "FAIL", hit.ownershipBinding);

  // ---- 3. live requirements override the catalog --------------------------
  // A stale listing must not be able to make the agent pay the wrong terms.
  const drifted = await bazaarPayAndCall(deps, {
    resource: hit.resource,
    toolName: TOOL_NAME,
    arguments: { text: "hello" },
    expected: { ...hit, amount: "999999999" },
  });
  record(
    "stale listing terms are rejected",
    !drifted.ok && drifted.code === "PAYMENT_REQUIREMENTS_CHANGED" ? "PASS" : "FAIL",
    !drifted.ok ? drifted.code : "unexpectedly paid",
  );

  const tooExpensive = await bazaarPayAndCall(deps, {
    resource: hit.resource,
    toolName: TOOL_NAME,
    arguments: { text: "hello" },
    maxAmount: "1",
  });
  record(
    "price ceiling is enforced before signing",
    !tooExpensive.ok && tooExpensive.code === "PRICE_EXCEEDS_LIMIT" ? "PASS" : "FAIL",
    !tooExpensive.ok ? tooExpensive.code : "unexpectedly paid",
  );

  const unreachable = await bazaarPayAndCall(deps, {
    resource: "mcp://tool/summarize_text",
    toolName: TOOL_NAME,
  });
  record(
    "authority-less mcp:// URL is refused",
    !unreachable.ok && unreachable.code === "INVALID_RESOURCE" ? "PASS" : "FAIL",
    !unreachable.ok ? unreachable.code : "unexpectedly paid",
  );

  // ---- 4. pay and invoke, for real ---------------------------------------
  const TEXT =
    "The Stellar Bazaar lets an autonomous agent find a paid service by describing " +
    "what it needs, verify the price against the live offer, pay over Stellar, and " +
    "invoke the service, without any pre-existing integration between the two parties.";

  const call = await bazaarPayAndCall(deps, {
    resource: hit.resource,
    toolName: TOOL_NAME,
    arguments: { text: TEXT },
    maxAmount: AMOUNT,
    expected: {
      network: hit.network,
      scheme: hit.scheme,
      asset: hit.asset,
      payTo: hit.payTo,
      amount: hit.amount,
    },
  });

  if (!call.ok) {
    record("pay and invoke", "FAIL", `${call.code}: ${call.reason}`);
    throw new Error(`pay_and_call failed: ${call.code}`);
  }

  record("pay and invoke", "PASS", `tx ${call.payment.transaction.slice(0, 16)}…`);
  record(
    "paid in canonical testnet USDC",
    call.payment.asset === USDC_TESTNET_ADDRESS ? "PASS" : "FAIL",
    call.payment.asset,
  );

  const content = call.result as Array<{ type: string; text?: string }>;
  const payload = JSON.parse(content?.[0]?.text ?? "{}") as { summary?: string };
  record(
    "tool result returned",
    typeof payload.summary === "string" && payload.summary.includes("words") ? "PASS" : "FAIL",
    payload.summary ?? "(none)",
  );

  await Promise.all([tool.close(), built.app.close()]);

  const failed = checks.filter((c) => c.status === "FAIL");
  const artifact = {
    result: failed.length === 0 ? "PASS" : "FAIL",
    startedAt,
    finishedAt: new Date().toISOString(),
    mcpServerCommand: "pnpm --filter @stellar-bazaar/mcp-discovery start",
    toolsExposed: ["bazaar_search", "bazaar_pay_and_call"],
    searchQuery: QUERY,
    noPrebakedResourceUrl: true,
    discoveredTool: hit,
    liveRequirementsRecheck: {
      staleTermsRejected: !drifted.ok ? drifted.code : null,
      priceCeilingEnforced: !tooExpensive.ok ? tooExpensive.code : null,
      unreachableResourceRejected: !unreachable.ok ? unreachable.code : null,
    },
    payment: call.payment,
    facilitatorSigner: env.E2E_FACILITATOR_ADDRESS,
    toolArguments: { text: TEXT },
    toolResult: payload,
    timings: call.timings,
    seedTransaction: seedSettlement?.transaction ?? null,
    checks,
  };

  const out = new URL("../../../artifacts/e2e/mcp-discovery-pay-call.json", import.meta.url);
  mkdirSync(new URL(".", out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`);

  console.log(`\n  tx  ${call.payment.transaction}`);
  console.log(`  https://stellar.expert/explorer/testnet/tx/${call.payment.transaction}`);
  console.log(`  total ${call.timings.totalMs.toFixed(0)}ms, settlement ${call.timings.settlementMs.toFixed(0)}ms`);
  console.log(`\nE-22: ${artifact.result}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("\nE-22: FAIL");
  console.error(error);
  process.exitCode = 1;
});
