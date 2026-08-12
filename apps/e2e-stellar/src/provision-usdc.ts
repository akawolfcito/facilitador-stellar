/**
 * Add testnet USDC trustlines to the buyer and seller, and report balances.
 *
 * The upstream e2e suite prices its Stellar route in USD, which resolves to the
 * default stablecoin — testnet USDC, `CBIELTK6…` from `@x402/stellar`'s
 * `constants.ts`. A Stellar account cannot receive a SEP-41 asset without a
 * trustline first, which is the prerequisite RFP §3.5 calls out by name, and
 * without one the client's own simulation fails with
 * `Error(Contract, #13): trustline entry is missing for account`.
 *
 * Trustlines this script can create. Balance it cannot: testnet USDC is issued
 * by Circle and only their faucet mints it.
 */

import { readFileSync } from "node:fs";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

/** Circle's testnet USDC issuer, matching `USDC_TESTNET_ADDRESS`. */
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC = new Asset("USDC", USDC_ISSUER);

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

const horizon = new Horizon.Server(HORIZON_URL);

async function hasTrustline(address: string): Promise<boolean> {
  const account = await horizon.loadAccount(address);
  return account.balances.some(
    (balance) =>
      "asset_code" in balance &&
      balance.asset_code === "USDC" &&
      balance.asset_issuer === USDC_ISSUER,
  );
}

async function usdcBalance(address: string): Promise<string> {
  const account = await horizon.loadAccount(address);
  const found = account.balances.find(
    (balance) =>
      "asset_code" in balance &&
      balance.asset_code === "USDC" &&
      balance.asset_issuer === USDC_ISSUER,
  );
  return found?.balance ?? "none";
}

async function addTrustline(secret: string, role: string): Promise<void> {
  const keypair = Keypair.fromSecret(secret);
  const address = keypair.publicKey();

  if (await hasTrustline(address)) {
    console.log(`  ${role.padEnd(7)} ${address} — trustline already present`);
    return;
  }

  const account = await horizon.loadAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();

  tx.sign(keypair);
  const result = await horizon.submitTransaction(tx);
  console.log(`  ${role.padEnd(7)} ${address} — trustline created, tx ${result.hash.slice(0, 16)}…`);
}

async function main(): Promise<void> {
  const env = loadEnvFile();
  console.log(`testnet USDC ${USDC_ISSUER}\n`);

  await addTrustline(env.E2E_BUYER_SECRET!, "buyer");
  await addTrustline(env.E2E_SELLER_SECRET!, "seller");

  const buyer = Keypair.fromSecret(env.E2E_BUYER_SECRET!).publicKey();
  const seller = Keypair.fromSecret(env.E2E_SELLER_SECRET!).publicKey();

  const buyerBalance = await usdcBalance(buyer);
  const sellerBalance = await usdcBalance(seller);
  console.log(`\n  buyer USDC balance:  ${buyerBalance}`);
  console.log(`  seller USDC balance: ${sellerBalance}`);

  if (buyerBalance === "none" || Number(buyerBalance) === 0) {
    console.log(
      `\n  ⚠ The buyer holds no USDC. Trustlines are in place, but only Circle can mint\n` +
        `    testnet USDC. Fund ${buyer} at https://faucet.circle.com (select Stellar\n` +
        `    testnet), then re-run the upstream conformance suite.`,
    );
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
