/**
 * One canonical payment against the *hosted* deployment.
 *
 * `run.ts` cannot do this: it starts its own facilitator and seller in-process,
 * which is the right shape for testing the implementation and the wrong shape
 * for testing an operated service. This talks to nothing but two public URLs.
 *
 * The buyer here is a stock x402 client. It signs an auth entry and sends it to
 * the seller; the *seller* is what calls `/verify` and `/settle` on its
 * configured facilitator. So this script never contacts the facilitator to make
 * the payment happen — it reads it afterwards to prove which facilitator did,
 * because the transaction's source account is the only thing that cannot be
 * misconfigured into lying (E-06a).
 *
 * Terms come from the live 402 and nowhere else. Nothing about price, asset or
 * recipient is hard-coded into the payment path; the expectations below are
 * assertions, checked before signing, not inputs.
 *
 * Usage:
 *   SELLER_URL=… FACILITATOR_URL=… BUYER_SECRET=… tsx src/hosted-client.ts
 */

import { Horizon } from "@stellar/stellar-sdk";
import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { createEd25519Signer, STELLAR_TESTNET_CAIP2 } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const NETWORK = STELLAR_TESTNET_CAIP2;
const HORIZON = "https://horizon-testnet.stellar.org";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Hosts this script is willing to talk to. Anything else is a misconfiguration. */
const EXPECTED_SELLER_HOST = "demo-api.testnet.x402seek.xyz";
const EXPECTED_FACILITATOR_HOST = "facilitator.testnet.x402seek.xyz";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertHost(url: string, expected: string, label: string): string {
  const host = new URL(url).hostname;
  if (host !== expected) {
    throw new Error(`${label} must be ${expected}, got ${host}`);
  }
  return url;
}

interface Balances {
  xlm: string;
  usdc: string;
}

const horizon = new Horizon.Server(HORIZON);

async function balances(address: string): Promise<Balances> {
  const account = await horizon.loadAccount(address);
  const xlm = account.balances.find((b) => b.asset_type === "native")?.balance ?? "0";
  const usdc =
    account.balances.find(
      (b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER,
    )?.balance ?? "0";
  return { xlm, usdc };
}

const delta = (before: string, after: string): string => {
  const d = Number(after) - Number(before);
  return `${d >= 0 ? "+" : ""}${d.toFixed(7)}`;
};

const sellerUrl = assertHost(required("SELLER_URL"), EXPECTED_SELLER_HOST, "SELLER_URL");
const facilitatorUrl = assertHost(
  required("FACILITATOR_URL"),
  EXPECTED_FACILITATOR_HOST,
  "FACILITATOR_URL",
);
const buyerSecret = required("BUYER_SECRET");

const resourceUrl = `${sellerUrl.replace(/\/$/, "")}/summarize`;
const text = "The quick brown fox jumps over the lazy dog and keeps running";

// ---- 1. the live 402 ------------------------------------------------------

const unpaid = await fetch(`${resourceUrl}?text=${encodeURIComponent(text)}`);
if (unpaid.status !== 402) throw new Error(`expected 402 from the seller, got ${unpaid.status}`);

const header = unpaid.headers.get("payment-required");
if (!header) throw new Error("402 carried no payment-required header");
const required402 = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
  resource: { url: string; serviceName?: string };
  accepts: Array<{
    network: string;
    scheme: string;
    asset: string;
    amount: string;
    payTo: string;
  }>;
};
const terms = required402.accepts[0]!;

console.log("live 402");
console.log(`  resource   ${required402.resource.url}`);
console.log(`  network    ${terms.network}`);
console.log(`  scheme     ${terms.scheme}`);
console.log(`  asset      ${terms.asset}`);
console.log(`  amount     ${terms.amount} (${(Number(terms.amount) / 1e7).toFixed(7)})`);
console.log(`  payTo      ${terms.payTo}`);

// ---- 2. fail closed on anything unexpected --------------------------------
//
// These are assertions about what we are about to pay for, checked against the
// live terms. They do not feed the payment — the client below reads the same
// header itself.
if (terms.network !== NETWORK) throw new Error(`network is ${terms.network}, refusing`);
if (terms.scheme !== "exact") throw new Error(`scheme is ${terms.scheme}, refusing`);
if (required402.resource.url !== resourceUrl) {
  throw new Error(`resource is ${required402.resource.url}, expected ${resourceUrl}`);
}
if (JSON.stringify(required402).includes("x402.org")) {
  throw new Error("the 402 references the public facilitator, refusing");
}

// ---- 3. balances before ---------------------------------------------------

const buyerSigner = createEd25519Signer(buyerSecret, NETWORK);
const buyerAddress = buyerSigner.address;

const facilitatorSupported = (await (await fetch(`${facilitatorUrl}/supported`)).json()) as {
  kinds: Array<{ network: string; extra?: Record<string, unknown> }>;
};
const kind = facilitatorSupported.kinds.find((k) => k.network === NETWORK);
if (!kind) throw new Error("the hosted facilitator does not advertise stellar:testnet");

const before = {
  buyer: await balances(buyerAddress),
  seller: await balances(terms.payTo),
};

console.log("\nbalances before");
console.log(`  buyer   ${buyerAddress}  ${before.buyer.usdc} USDC  ${before.buyer.xlm} XLM`);
console.log(`  seller  ${terms.payTo}  ${before.seller.usdc} USDC`);

if (Number(before.buyer.usdc) < Number(terms.amount) / 1e7) {
  throw new Error("buyer USDC balance is below the price");
}

// ---- 4. pay ---------------------------------------------------------------
//
// `wrapFetchWithPayment` re-reads the 402, builds the payment from those terms,
// and retries. The seller takes it from there: it is the party that calls the
// facilitator's /verify and /settle.

const client = x402Client.fromConfig({
  schemes: [{ network: NETWORK, client: new ExactStellarScheme(buyerSigner) }],
});
const fetchWithPay = wrapFetchWithPayment(fetch, client);

console.log("\npaying…");
const paid = await fetchWithPay(`${resourceUrl}?text=${encodeURIComponent(text)}`);
console.log(`  status     ${paid.status}`);
if (paid.status !== 200) {
  throw new Error(`paid request returned ${paid.status}: ${(await paid.text()).slice(0, 200)}`);
}

const body = (await paid.json()) as { summary?: string };
console.log(`  body       ${JSON.stringify(body)}`);

const receipt = paid.headers.get("payment-response");
const settlement = receipt ? decodePaymentResponseHeader(receipt) : undefined;
const txHash = (settlement as { transaction?: string } | undefined)?.transaction;
console.log(`  tx         ${txHash ?? "(no transaction in payment-response)"}`);

// ---- 5. who actually settled it -------------------------------------------
//
// Read from the chain, not from anybody's success flag. The source account of
// the transaction is the facilitator that submitted it.

if (txHash) {
  const tx = (await (await fetch(`${HORIZON}/transactions/${txHash}`)).json()) as {
    source_account?: string;
    fee_charged?: string;
    successful?: boolean;
  };
  console.log("\nchain");
  console.log(`  successful     ${tx.successful}`);
  console.log(`  source account ${tx.source_account}  <- the facilitator that submitted`);
  console.log(`  fee charged    ${tx.fee_charged} stroops`);
}

// ---- 6. balances after ----------------------------------------------------

// Give the ledger a moment to reflect the payment in account balances.
await new Promise((r) => setTimeout(r, 6000));

const after = {
  buyer: await balances(buyerAddress),
  seller: await balances(terms.payTo),
};

console.log("\ndeltas");
console.log(`  buyer USDC   ${delta(before.buyer.usdc, after.buyer.usdc)}`);
console.log(`  buyer XLM    ${delta(before.buyer.xlm, after.buyer.xlm)}`);
console.log(`  seller USDC  ${delta(before.seller.usdc, after.seller.usdc)}`);

console.log("\nsummary");
console.log(`  resource   ${resourceUrl}`);
console.log(`  network    ${terms.network}`);
console.log(`  scheme     ${terms.scheme}`);
console.log(`  asset      ${terms.asset}`);
console.log(`  amount     ${terms.amount}`);
console.log(`  buyer      ${buyerAddress}`);
console.log(`  seller     ${terms.payTo}`);
console.log(`  tx         ${txHash ?? "—"}`);
