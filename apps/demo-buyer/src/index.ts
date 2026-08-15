/**
 * Process entry point.
 *
 * Binds `::` rather than `0.0.0.0`. Railway's private network is IPv6-only, so
 * an IPv4-only listener is reachable from nowhere at all, which is a confusing
 * way to discover a networking model.
 */

import { Horizon } from "@stellar/stellar-sdk";
import { createEd25519Signer } from "@x402/stellar";
import { buildDemoBuyer } from "./app.js";
import { loadDemoBuyerConfig, redact } from "./config.js";

import { SpendLedger } from "./ledger.js";
import { payForDemo } from "./pay.js";

const config = loadDemoBuyerConfig();

// Redacted by naming each secret field, not by pattern. See config.ts.
console.log(JSON.stringify({ event: "config", ...redact(config) }));

const signer = createEd25519Signer(config.buyerSecret, config.network);
const buyerAddress = signer.address;
console.log(JSON.stringify({ event: "buyer", address: buyerAddress }));

const ledger = new SpendLedger(`${config.dataDir}/demo-buyer.db`, {
  // The two daily ceilings, argued in the plan. Whichever binds first wins.
  maxPaymentsPerDay: 150,
  maxUnitsPerDay: 1_500_000,
});
ledger.prune();

const horizon = new Horizon.Server(config.horizonUrl);

/**
 * Canonical testnet USDC, in its classic form.
 *
 * The 402 quotes `CBIELTK6…`, the Stellar Asset Contract. The balance lives in
 * the classic trustline behind it, keyed on issuer and code. Same asset, two
 * representations, and reading the balance by the contract address finds
 * nothing at all: the first version of this file did exactly that and reported
 * zero for accounts that were holding USDC perfectly well.
 */
const USDC_CLASSIC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/**
 * The buyer's own USDC balance, in base units.
 *
 * Read-only, and failure is not fatal: `null` means "could not tell", and the
 * floor check treats that as "carry on" rather than blocking the demo because
 * Horizon had a bad minute. The budget is the real ceiling; the floor is a
 * courtesy that stops the demo before it starts failing on chain.
 */
async function buyerBalanceUnits(): Promise<bigint | null> {
  try {
    const account = await horizon.accounts().accountId(buyerAddress).call();
    const balance = account.balances.find(
      (b) =>
        (b as { asset_code?: string }).asset_code === "USDC" &&
        (b as { asset_issuer?: string }).asset_issuer === USDC_CLASSIC_ISSUER,
    ) as { balance?: string } | undefined;
    // No trustline means no balance, and also means none can arrive. Zero, not
    // unknown: reporting it as unknown would let the floor wave through a buyer
    // that cannot possibly pay.
    if (!balance?.balance) return 0n;
    return BigInt(Math.round(Number(balance.balance) * 1e7));
  } catch {
    // Only a failure to ask is unknown.
    return null;
  }
}

const app = buildDemoBuyer(config, ledger, {
  pay: (text) => payForDemo(config.buyerSecret, config.network, text),
  balance: buyerBalanceUnits,
});

await app.listen({ port: config.port, host: "::" });
console.log(JSON.stringify({ event: "listening", port: config.port }));

// Housekeeping, unref'd so it can never be the reason the process stays up.
const prune = setInterval(() => ledger.prune(), 60 * 60 * 1000);
prune.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(prune);
    void app.close().then(() => {
      ledger.close();
      process.exit(0);
    });
  });
}
