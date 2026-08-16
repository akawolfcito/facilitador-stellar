/**
 * Process entry point.
 *
 * Binds `::` rather than `0.0.0.0`. Railway's private network is IPv6-only, so
 * an IPv4-only listener is reachable from nowhere at all, which is a confusing
 * way to discover a networking model.
 */

import { Horizon } from "@stellar/stellar-sdk";
import { createEd25519Signer } from "@x402/stellar";
import { type BalanceReading, buildDemoBuyer } from "./app.js";
import { loadDemoBuyerConfig, redact } from "./config.js";

import { SpendLedger } from "./ledger.js";
import { payForDemo, readLiveTerms } from "./pay.js";

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
 * The buyer's USDC position, read from the classic trustline.
 *
 * Read-only. `units: null` means Horizon could not be asked, which readiness
 * reports as unreadable rather than as broke. The budget is the real ceiling;
 * the floor is a courtesy that stops the demo before it starts failing on chain.
 */
async function buyerUsdcPosition(): Promise<BalanceReading> {
  try {
    const account = await horizon.accounts().accountId(buyerAddress).call();
    const line = account.balances.find(
      (b) =>
        (b as { asset_code?: string }).asset_code === "USDC" &&
        (b as { asset_issuer?: string }).asset_issuer === USDC_CLASSIC_ISSUER,
    ) as { balance?: string } | undefined;

    // No trustline and an empty trustline fail differently and are reported
    // differently. Collapsing them into "zero" is what hid the missing
    // trustline for an afternoon.
    if (!line) return { trustline: false, units: 0n };
    return { trustline: true, units: BigInt(Math.round(Number(line.balance ?? "0") * 1e7)) };
  } catch {
    // Only a failure to ask is unknown.
    return { trustline: false, units: null };
  }
}

const app = buildDemoBuyer(config, ledger, {
  pay: (text) => payForDemo(config.buyerSecret, config.network, text),
  balance: buyerUsdcPosition,
  // Readiness asks the seller what it is charging right now. The answer is
  // cached in app.ts, so this is not called per probe.
  liveTerms: async () => {
    const verdict = await readLiveTerms();
    return { ok: verdict.ok };
  },
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
