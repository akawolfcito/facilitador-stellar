/**
 * E-12/E-13/E-14/E-15: search over a catalog built only by real payments.
 *
 * `pnpm --filter @stellar-bazaar/e2e-stellar search`
 *
 * Six paid resources are each bought once with an unmodified stock x402 client,
 * settling for real on stellar:testnet. Nothing is inserted into the database
 * directly — every listing exists because a payment for it settled. Then the
 * catalog is queried through the live `GET /discovery/search`.
 *
 * The resources overlap on purpose: three weather services, three
 * "translation" services one of which resolves token identifiers rather than
 * language. Distinguishing them is the whole claim.
 */

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { buildFacilitator } from "@stellar-bazaar/facilitator/app";
import { loadConfig } from "@stellar-bazaar/facilitator/config";
import { PAID_RESOURCES, buildCatalogSeller } from "./catalog-seller.js";

const NETWORK = "stellar:testnet" as const;
const FACILITATOR_PORT = 4412;
const SELLER_PORT = 4413;

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
  console.log(`  [${status}] ${name.padEnd(34)} ${detail}`);
}

interface SearchResponse {
  resources: Array<{ canonicalKey: string; serviceName?: string; network: string }>;
  partialResults: boolean;
  pagination: { limit: number; cursor: string | null } | null;
  abstained?: { reason: string; topScore: number; threshold: number };
}

async function main(): Promise<void> {
  const env = loadEnvFile();
  const startedAt = new Date().toISOString();
  console.log("E-12 · real payments → catalog → natural-language search\n");

  const catalogPath = new URL("../.catalog-search.db", import.meta.url).pathname;
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

  const sellerApp = buildCatalogSeller({
    facilitatorUrl,
    network: NETWORK,
    payTo: env.E2E_SELLER_ADDRESS!,
    asset: env.E2E_ASSET!,
    amount: env.E2E_AMOUNT!,
  });
  await sellerApp.listen({ port: SELLER_PORT, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${SELLER_PORT}`;

  // ---- buy every resource, for real ---------------------------------------
  const buyer = createEd25519Signer(env.E2E_BUYER_SECRET!, NETWORK);
  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactStellarScheme(buyer) }],
  });
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  const settlements: Array<{ path: string; transaction: string }> = [];
  for (const resource of PAID_RESOURCES) {
    const response = await fetchWithPay(`${base}${resource.path}?probe=1`);
    const header =
      response.headers.get("payment-response") ?? response.headers.get("x-payment-response");
    const settlement = header
      ? (decodePaymentResponseHeader(header) as { success?: boolean; transaction?: string })
      : undefined;

    const ok = response.status === 200 && settlement?.success === true && !!settlement.transaction;
    record(
      `paid ${resource.path}`,
      ok ? "PASS" : "FAIL",
      ok ? `tx ${settlement!.transaction!.slice(0, 16)}…` : `HTTP ${response.status}`,
    );
    if (ok) settlements.push({ path: resource.path, transaction: settlement!.transaction! });
  }

  // Index maintenance is now off the settle response path, so wait for the
  // background sync to quiesce before querying search.
  await built.searchSettled();

  const listed = (await (
    await fetch(`${facilitatorUrl}/discovery/resources?limit=50`)
  ).json()) as { resources: unknown[]; pagination: { total: number } };
  record(
    "catalog built by payments only",
    listed.pagination.total === PAID_RESOURCES.length ? "PASS" : "FAIL",
    `${listed.pagination.total} listings from ${settlements.length} settlements, 0 direct inserts`,
  );

  // ---- the queries ---------------------------------------------------------
  const search = async (
    query: string,
    extra = "",
  ): Promise<{ response: SearchResponse; ms: number }> => {
    const started = performance.now();
    const response = (await (
      await fetch(`${facilitatorUrl}/discovery/search?query=${encodeURIComponent(query)}${extra}`)
    ).json()) as SearchResponse;
    return { response, ms: performance.now() - started };
  };

  const latencies: number[] = [];
  const queryEvidence: Array<Record<string, unknown>> = [];

  const cases = [
    {
      query: "will it rain tomorrow?",
      expect: "/weather/forecast",
      why: "paraphrase with no shared term",
    },
    {
      query: "translate this document",
      expect: "/translate/document",
      why: "document translation must outrank the token distractor",
    },
    {
      query: "what is the current token translation?",
      expect: "/tokens/translation-table",
      why: "the distractor is correct only when the query means identifier translation",
    },
  ] as const;

  for (const testCase of cases) {
    const { response, ms } = await search(testCase.query);
    latencies.push(ms);
    const top = response.resources[0];
    const hit = top?.canonicalKey.endsWith(testCase.expect) ?? false;
    record(
      `"${testCase.query.slice(0, 30)}"`,
      hit ? "PASS" : "FAIL",
      `→ ${top?.serviceName ?? "ABSTAINED"} (${testCase.why})`,
    );
    queryEvidence.push({
      query: testCase.query,
      expected: testCase.expect,
      topResult: top?.canonicalKey ?? null,
      topServiceName: top?.serviceName ?? null,
      ranking: response.resources.map((r) => r.serviceName),
      abstained: response.abstained ?? null,
      latencyMs: Number(ms.toFixed(1)),
    });
  }

  // Abstention on a query the catalog genuinely cannot serve.
  const dentist = await search("book me a dentist appointment");
  latencies.push(dentist.ms);
  record(
    '"book me a dentist appointment"',
    dentist.response.resources.length === 0 && dentist.response.abstained ? "PASS" : "FAIL",
    dentist.response.abstained
      ? `ABSTAINED (${dentist.response.abstained.reason}, top ${dentist.response.abstained.topScore.toFixed(4)} < ${dentist.response.abstained.threshold})`
      : `returned ${dentist.response.resources.length} result(s)`,
  );
  queryEvidence.push({
    query: "book me a dentist appointment",
    expected: "abstention",
    topResult: null,
    abstained: dentist.response.abstained ?? null,
    latencyMs: Number(dentist.ms.toFixed(1)),
  });

  // ---- hard filters before ranking ----------------------------------------
  const wrongNetwork = await search("will it rain tomorrow?", "&network=stellar:pubnet");
  record(
    "filter before ranking",
    wrongNetwork.response.resources.length === 0 ? "PASS" : "FAIL",
    `network=stellar:pubnet → ${wrongNetwork.response.resources.length} results (${wrongNetwork.response.abstained?.reason ?? "none"})`,
  );

  const typeFiltered = await search("will it rain tomorrow?", "&type=mcp");
  record(
    "type filter",
    typeFiltered.response.resources.length === 0 ? "PASS" : "FAIL",
    `type=mcp → ${typeFiltered.response.resources.length} results`,
  );

  // ---- pagination ----------------------------------------------------------
  const page1 = await search("weather", "&limit=1");
  const cursor = page1.response.pagination?.cursor;
  const page2 = cursor
    ? await search("weather", `&limit=1&cursor=${encodeURIComponent(cursor)}`)
    : undefined;
  record(
    "cursor pagination",
    page1.response.partialResults && !!cursor && !!page2 &&
      page2.response.resources[0]?.canonicalKey !== page1.response.resources[0]?.canonicalKey
      ? "PASS"
      : "FAIL",
    `partialResults=${page1.response.partialResults}, page2=${page2?.response.resources[0]?.serviceName ?? "none"}`,
  );

  // ---- restart -------------------------------------------------------------
  await built.app.close();
  const restartedPort = FACILITATOR_PORT + 10;
  const restarted = buildFacilitator({ ...config, port: restartedPort });
  await restarted.app.listen({ port: restartedPort, host: "127.0.0.1" });
  const syncAfterRestart = await restarted.search.sync();

  const afterRestart = (await (
    await fetch(
      `http://127.0.0.1:${restartedPort}/discovery/search?query=${encodeURIComponent("will it rain tomorrow?")}`,
    )
  ).json()) as SearchResponse;
  record(
    "search after restart",
    afterRestart.resources[0]?.canonicalKey.endsWith("/weather/forecast") ? "PASS" : "FAIL",
    `${syncAfterRestart.reused} vectors reused, ${syncAfterRestart.embedded} rebuilt → ${afterRestart.resources[0]?.serviceName}`,
  );

  await Promise.all([sellerApp.close(), restarted.app.close()]);

  const failed = checks.filter((c) => c.status === "FAIL");
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(Math.ceil((q / 100) * sorted.length) - 1, sorted.length - 1)] ?? 0;

  const artifact = {
    result: failed.length === 0 ? "PASS" : "FAIL",
    startedAt,
    finishedAt: new Date().toISOString(),
    network: NETWORK,
    catalog: {
      listings: listed.pagination.total,
      builtBy: "settled x402 payments only",
      directInserts: 0,
      settlements,
    },
    queries: queryEvidence,
    latency: { p50Ms: Number(p(50).toFixed(1)), p95Ms: Number(p(95).toFixed(1)), samples: sorted.length },
    restart: syncAfterRestart,
    checks,
    versions: { "@x402/core": "2.22.0", "@x402/stellar": "2.22.0", node: process.version },
  };

  const out = new URL("../../../artifacts/e2e/stellar-testnet-bazaar-search.json", import.meta.url);
  mkdirSync(new URL(".", out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`);

  console.log(`\n  search latency p50 ${p(50).toFixed(1)}ms, p95 ${p(95).toFixed(1)}ms`);
  console.log(`\nE-12: ${artifact.result}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("\nE-12: FAIL");
  console.error(error);
  process.exitCode = 1;
});
