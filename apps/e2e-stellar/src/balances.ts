/**
 * Snapshot buyer / seller / facilitator balances.
 *
 * `pnpm --filter @stellar-bazaar/e2e-stellar balances [label]`
 *
 * Run before and after a conformance run to produce the deltas E-19 requires:
 * buyer USDC out, seller USDC in, facilitator XLM spent on fees. Reading the
 * chain rather than trusting a facilitator's own success flag is the same
 * discipline E-06a forced on us.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Horizon, Keypair } from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

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

async function snapshot(address: string): Promise<{ xlm: string; usdc: string }> {
  const account = await horizon.loadAccount(address);
  const native = account.balances.find((b) => b.asset_type === "native");
  const usdc = account.balances.find(
    (b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER,
  );
  return { xlm: native?.balance ?? "0", usdc: usdc?.balance ?? "0" };
}

async function main(): Promise<void> {
  const env = loadEnvFile();
  const label = process.argv[2] ?? "snapshot";

  const accounts = {
    buyer: Keypair.fromSecret(env.E2E_BUYER_SECRET!).publicKey(),
    seller: env.E2E_SELLER_ADDRESS!,
    facilitator: Keypair.fromSecret(env.E2E_FACILITATOR_SECRET!).publicKey(),
  };

  const balances: Record<string, { address: string; xlm: string; usdc: string }> = {};
  for (const [role, address] of Object.entries(accounts)) {
    const { xlm, usdc } = await snapshot(address);
    balances[role] = { address, xlm, usdc };
    console.log(`  ${role.padEnd(12)} ${address}  XLM ${xlm.padStart(16)}  USDC ${usdc.padStart(14)}`);
  }

  const out = new URL(`../../../artifacts/e2e/balances-${label}.json`, import.meta.url);
  mkdirSync(new URL(".", out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ label, at: new Date().toISOString(), balances }, null, 2)}\n`,
  );
  console.log(`\n  wrote artifacts/e2e/balances-${label}.json`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
