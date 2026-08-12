/**
 * E-06: an unmodified stock x402 client completes a real payment on
 * stellar:testnet against our facilitator.
 *
 * The buyer is `wrapFetchWithPayment` from `@x402/fetch` driving an
 * `x402Client` with `ExactStellarScheme` from `@x402/stellar/exact/client` —
 * the same two symbols the upstream e2e harness uses
 * (`e2e/clients/typescript/client.ts:20-21,242-246`). No client or protocol
 * code is patched; only configuration is ours.
 *
 * Nothing is mocked. The transaction hash printed at the end is a real Stellar
 * testnet transaction, independently verified against Horizon before the run is
 * allowed to pass.
 */

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { Horizon } from "@stellar/stellar-sdk";
import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { buildFacilitator } from "@stellar-bazaar/facilitator/app";
import { loadConfig } from "@stellar-bazaar/facilitator/config";
import { PAID_PATH, buildSeller } from "./seller.js";

const NETWORK = "stellar:testnet" as const;
const FACILITATOR_PORT = 4402;
const SELLER_PORT = 4403;
const HORIZON_URL = "https://horizon-testnet.stellar.org";

/** Read `.env.e2e` without pulling in a dotenv dependency. */
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

interface Stage {
  stage: string;
  status: "PASS" | "FAIL";
  detail: string;
}

const stages: Stage[] = [];
function record(stage: string, status: Stage["status"], detail: string): void {
  stages.push({ stage, status, detail });
  console.log(`  [${status === "PASS" ? "PASS" : "FAIL"}] ${stage.padEnd(26)} ${detail}`);
}

interface ExtensionResponses {
  bazaar?: { status?: string; rejectedReason?: string };
}
let capturedExtensionResponses: ExtensionResponses | undefined;

/**
 * Observe the `EXTENSION-RESPONSES` header on the facilitator hop.
 *
 * The seller's `HTTPFacilitatorClient` calls the facilitator through global
 * fetch, and both run in this process, so wrapping fetch is enough to see the
 * header the spec puts on the settle response. This is harness instrumentation
 * only — no production code path is altered.
 */
function observeFacilitatorHeaders(): void {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await original(input, init);
    const header = response.headers.get("extension-responses");
    if (header) {
      try {
        capturedExtensionResponses = JSON.parse(
          Buffer.from(header, "base64").toString("utf8"),
        ) as ExtensionResponses;
      } catch {
        capturedExtensionResponses = undefined;
      }
    }
    return response;
  };
}

async function main(): Promise<void> {
  const env = loadEnvFile();
  const required = ["E2E_BUYER_SECRET", "E2E_SELLER_ADDRESS", "E2E_FACILITATOR_SECRET", "E2E_ASSET", "E2E_AMOUNT"];
  for (const key of required) {
    if (!env[key]) throw new Error(`${key} missing from .env.e2e — run pnpm provision first`);
  }

  const startedAt = new Date().toISOString();
  console.log(`E-06/E-09 · stock x402 client → real ${NETWORK} settlement → auto-catalog\n`);

  observeFacilitatorHeaders();

  // A fresh catalog file per run, so "the listing is there" can only be caused
  // by this run's payment.
  const catalogPath = new URL("../.catalog-e2e.db", import.meta.url).pathname;
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${catalogPath}${suffix}`, { force: true });

  // ---- our facilitator (payment plane) -----------------------------------
  const facilitatorConfig = loadConfig({
    PORT: String(FACILITATOR_PORT),
    STELLAR_NETWORK: "testnet",
    SIGNER_SECRET_KEYS: env.E2E_FACILITATOR_SECRET,
    STELLAR_RPC_URL: env.STELLAR_RPC_URL,
    CATALOG_PATH: catalogPath,
  });
  const { app: facilitatorApp } = buildFacilitator(facilitatorConfig);
  await facilitatorApp.listen({ port: FACILITATOR_PORT, host: "127.0.0.1" });
  const facilitatorUrl = `http://127.0.0.1:${FACILITATOR_PORT}`;

  const supported = (await (await fetch(`${facilitatorUrl}/supported`)).json()) as {
    kinds?: Array<{ network?: string; extra?: { areFeesSponsored?: boolean } }>;
  };
  const stellarKind = supported.kinds?.find((k) => k.network === NETWORK);
  record(
    "facilitator/supported",
    stellarKind?.extra?.areFeesSponsored === true ? "PASS" : "FAIL",
    JSON.stringify(stellarKind),
  );

  // ---- the seller (stock @x402/fastify middleware) ------------------------
  const sellerApp = buildSeller({
    port: SELLER_PORT,
    facilitatorUrl,
    network: NETWORK,
    payTo: env.E2E_SELLER_ADDRESS!,
    asset: env.E2E_ASSET!,
    amount: env.E2E_AMOUNT!,
  });
  await sellerApp.listen({ port: SELLER_PORT, host: "127.0.0.1" });
  const resourceUrl = `http://127.0.0.1:${SELLER_PORT}${PAID_PATH}`;

  // ---- 1. unpaid request must be 402 --------------------------------------
  const unpaid = await fetch(resourceUrl);
  const unpaidBody = await unpaid.text();
  record(
    "402 on unpaid",
    unpaid.status === 402 ? "PASS" : "FAIL",
    `HTTP ${unpaid.status}`,
  );
  if (unpaid.status !== 402) throw new Error(`expected 402, got ${unpaid.status}: ${unpaidBody}`);

  // ---- 2. stock client: sign, verify, settle, retry ------------------------
  const buyerSigner = createEd25519Signer(env.E2E_BUYER_SECRET!, NETWORK);
  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactStellarScheme(buyerSigner) }],
  });
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  record("payer", "PASS", buyerSigner.address);

  const paid = await fetchWithPay(resourceUrl);
  const body = (await paid.json()) as unknown;
  const settledAt = new Date().toISOString();

  record("retry", paid.status === 200 ? "PASS" : "FAIL", `HTTP ${paid.status}`);
  record(
    "resource body",
    JSON.stringify(body) === JSON.stringify({ ok: true, message: "paid" }) ? "PASS" : "FAIL",
    JSON.stringify(body),
  );

  // v2 emits `PAYMENT-RESPONSE`; `X-PAYMENT-RESPONSE` is the v1 fallback the
  // stock client also accepts (`@x402/core/http/x402HTTPClient.ts:145,151`).
  const header =
    paid.headers.get("payment-response") ?? paid.headers.get("x-payment-response");
  if (!header) {
    throw new Error(
      `no PAYMENT-RESPONSE header on the 200; got [${[...paid.headers.keys()].join(", ")}]`,
    );
  }
  const settlement = decodePaymentResponseHeader(header) as {
    success?: boolean;
    transaction?: string;
    network?: string;
    payer?: string;
  };
  record(
    "settle",
    settlement.success === true ? "PASS" : "FAIL",
    JSON.stringify(settlement),
  );

  const transactionHash = settlement.transaction;
  if (!transactionHash) throw new Error("settlement carried no transaction hash");

  // ---- 3. independent on-chain verification -------------------------------
  // The facilitator saying "success" is not evidence. Horizon is.
  const horizon = new Horizon.Server(HORIZON_URL);
  let onChain: { successful: boolean; ledger: number; sourceAccount: string } | undefined;
  for (let attempt = 0; attempt < 12 && !onChain; attempt++) {
    try {
      const tx = await horizon.transactions().transaction(transactionHash).call();
      onChain = {
        successful: tx.successful,
        ledger: tx.ledger_attr ?? (tx as unknown as { ledger: number }).ledger,
        sourceAccount: tx.source_account,
      };
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  record(
    "on-chain (horizon)",
    onChain?.successful === true ? "PASS" : "FAIL",
    onChain ? `ledger ${onChain.ledger}, source ${onChain.sourceAccount}` : "not found on Horizon",
  );

  /**
   * Prove OUR facilitator settled this, not somebody else's.
   *
   * The first green run of this harness was settled by the public x402.org
   * facilitator, because a misconfigured `HTTPFacilitatorClient` silently fell
   * back to its default URL. Every stage still reported PASS. The only thing
   * that caught it was noticing that the transaction's source account was not
   * our signer — so that check is now part of the test.
   */
  record(
    "settled by us",
    onChain?.sourceAccount === env.E2E_FACILITATOR_ADDRESS ? "PASS" : "FAIL",
    `tx source ${onChain?.sourceAccount} vs our signer ${env.E2E_FACILITATOR_ADDRESS}`,
  );

  // And that the value actually moved buyer -> seller, for the declared amount.
  const opsResponse = await fetch(`${HORIZON_URL}/transactions/${transactionHash}/operations`);
  const ops = (await opsResponse.json()) as {
    _embedded: {
      records: Array<{
        asset_balance_changes?: Array<{ from: string; to: string; amount: string; type: string }>;
      }>;
    };
  };
  const transfer = ops._embedded.records
    .flatMap((op) => op.asset_balance_changes ?? [])
    .find((c) => c.type === "transfer");
  const expectedAmount = (Number(env.E2E_AMOUNT) / 1e7).toFixed(7);
  record(
    "value moved",
    transfer?.from === buyerSigner.address &&
      transfer?.to === env.E2E_SELLER_ADDRESS &&
      transfer?.amount === expectedAmount
      ? "PASS"
      : "FAIL",
    transfer ? `${transfer.amount} ${transfer.from.slice(0, 6)}… → ${transfer.to.slice(0, 6)}…` : "no transfer found",
  );

  // ---- 4. automatic Bazaar cataloging ------------------------------------
  // No registration call was ever made. The listing exists because a payment
  // for it settled (RFP §3.2).
  //
  // `EXTENSION-RESPONSES` is a facilitator→caller header: the spec puts it on
  // the verify/settle response, and the caller here is the seller's
  // `HTTPFacilitatorClient`, not the buyer. It is therefore observed on the
  // facilitator hop (captured by `observeFacilitatorHeaders` below), not on the
  // buyer's 200 — looking for it there was our own mistake, not a gap.
  const extensionOutcome = capturedExtensionResponses;
  record(
    "EXTENSION-RESPONSES",
    extensionOutcome?.bazaar?.status === "success" ? "PASS" : "FAIL",
    JSON.stringify(extensionOutcome ?? "absent"),
  );

  const discovery = (await (
    await fetch(`${facilitatorUrl}/discovery/resources?network=${NETWORK}`)
  ).json()) as { resources: Array<Record<string, unknown>>; pagination: unknown };

  const canonicalResource = `http://127.0.0.1:${SELLER_PORT}${PAID_PATH}`;
  const listing = discovery.resources.find((r) => r.canonicalKey === canonicalResource);

  record("cataloged automatically", listing ? "PASS" : "FAIL", `${discovery.resources.length} listing(s)`);
  record(
    "terms from settled payment",
    listing?.payTo === env.E2E_SELLER_ADDRESS &&
      listing?.asset === env.E2E_ASSET &&
      listing?.amount === env.E2E_AMOUNT &&
      listing?.ownerPayTo === env.E2E_SELLER_ADDRESS
      ? "PASS"
      : "FAIL",
    `payTo=${String(listing?.payTo).slice(0, 8)}… amount=${String(listing?.amount)} binding=${String(listing?.ownershipBinding)}`,
  );
  record(
    "provenance links settlement",
    listing?.lastSettlementTx === transactionHash ? "PASS" : "FAIL",
    String(listing?.lastSettlementTx).slice(0, 16) + "…",
  );

  // ---- 5. restart durability ----------------------------------------------
  // Close the facilitator entirely — process state, SQLite handle and all —
  // then open a new one against the same file. Nothing is replayed: the row has
  // to already be on disk. The new instance binds a different port so that a
  // pooled keep-alive socket to the dead server cannot be mistaken for
  // durability (it produced an ECONNRESET the first time we tried same-port).
  await facilitatorApp.close();
  const restartedPort = FACILITATOR_PORT + 10;
  const { app: restarted } = buildFacilitator({ ...facilitatorConfig, port: restartedPort });
  await restarted.listen({ port: restartedPort, host: "127.0.0.1" });
  const restartedUrl = `http://127.0.0.1:${restartedPort}`;

  const afterRestart = (await (
    await fetch(`${restartedUrl}/discovery/resources`)
  ).json()) as { resources: Array<Record<string, unknown>> };
  const survived = afterRestart.resources.find((r) => r.canonicalKey === canonicalResource);
  record("persists across restart", survived ? "PASS" : "FAIL", `${afterRestart.resources.length} listing(s)`);

  // ---- 6. filters over the persisted index ---------------------------------
  const filtered = (await (
    await fetch(
      `${restartedUrl}/discovery/resources?type=http&payTo=${env.E2E_SELLER_ADDRESS}&extensions=bazaar&limit=10&offset=0`,
    )
  ).json()) as { resources: Array<Record<string, unknown>>; pagination: Record<string, number> };
  const excluded = (await (
    await fetch(`${restartedUrl}/discovery/resources?type=mcp`)
  ).json()) as { resources: unknown[] };
  record(
    "filters",
    filtered.resources.length > 0 && excluded.resources.length === 0 ? "PASS" : "FAIL",
    `type+payTo+extensions → ${filtered.resources.length}; type=mcp → ${excluded.resources.length}`,
  );

  await Promise.all([sellerApp.close(), restarted.close()]);

  const failed = stages.filter((s) => s.status === "FAIL");

  const artifact = {
    result: failed.length === 0 ? "PASS" : "FAIL",
    network: NETWORK,
    scheme: "exact",
    x402Version: 2,
    transactionHash,
    horizonUrl: `${HORIZON_URL}/transactions/${transactionHash}`,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${transactionHash}`,
    onChain,
    valueTransfer: transfer,
    amount: env.E2E_AMOUNT,
    asset: env.E2E_ASSET,
    assetNote: "native XLM Stellar Asset Contract (SEP-41 interface), 7 decimals",
    payer: buyerSigner.address,
    payTo: env.E2E_SELLER_ADDRESS,
    facilitatorSigner: env.E2E_FACILITATOR_ADDRESS,
    resource: `GET ${PAID_PATH}`,
    startedAt,
    settledAt,
    stages,
    versions: {
      "@x402/core": "2.22.0",
      "@x402/stellar": "2.22.0",
      "@x402/fetch": "2.22.0",
      "@x402/fastify": "2.22.0",
      node: process.version,
    },
  };

  const out = new URL("../../../artifacts/e2e/stellar-testnet-exact.json", import.meta.url);
  mkdirSync(new URL(".", out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`);

  const catalogArtifact = {
    result: failed.length === 0 ? "PASS" : "FAIL",
    transactionHash,
    canonicalResource,
    payTo: env.E2E_SELLER_ADDRESS,
    network: NETWORK,
    scheme: "exact",
    asset: env.E2E_ASSET,
    amount: env.E2E_AMOUNT,
    catalogedAt: listing?.firstSeenAt,
    automatic: true,
    registrationCallsMade: 0,
    ownership: {
      ownerPayTo: listing?.ownerPayTo,
      binding: listing?.ownershipBinding,
      note: "trust on first use — x402 proves payment recipient authenticity, not URL ownership. See docs/security/catalog-ownership-model.md",
    },
    persistedAcrossRestart: Boolean(survived),
    extensionOutcome,
    discoveryResponse: { query: `network=${NETWORK}`, ...discovery },
    filterCheck: { resources: filtered.resources.length, pagination: filtered.pagination },
    versions: artifact.versions,
  };
  const catalogOut = new URL(
    "../../../artifacts/e2e/stellar-testnet-bazaar-catalog.json",
    import.meta.url,
  );
  writeFileSync(catalogOut, `${JSON.stringify(catalogArtifact, null, 2)}\n`);

  console.log(`\n  tx  ${transactionHash}`);
  console.log(`  ${artifact.explorerUrl}`);
  console.log(`\nE-06: ${artifact.result}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("\nE-06: FAIL");
  console.error(error);
  process.exitCode = 1;
});
