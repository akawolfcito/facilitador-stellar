/**
 * Adapter that exposes our facilitator to the upstream x402 e2e suite.
 *
 * The suite discovers facilitators under
 * `e2e/facilitators/external-proxies/<name>/` (a directory upstream gitignores
 * precisely so third parties can drop one in), spawns them with `run.sh`, waits
 * for the line `Facilitator listening`, and drives `/verify`, `/settle`,
 * `/supported` and `/close` over HTTP.
 *
 * Everything here is **configuration and process shape**. No client or protocol
 * package is patched, and `buildFacilitator` is imported unmodified from
 * `apps/facilitator` — the same code path the real deployment runs.
 *
 * The `.mts` extension is load-bearing: `tsx` picks the module format from the
 * nearest `package.json`, and this file sits outside any package that declares
 * `"type": "module"`, so a plain `.ts` compiles to CJS and the top-level
 * `await app.listen(...)` below fails to transform.
 *
 * Env the harness injects (see `e2e/src/facilitators/generic-facilitator.ts`
 * and `e2e/config/mechanisms_stellar.json`):
 *
 *   PORT                             harness-assigned
 *   STELLAR_NETWORK                  CAIP-2, e.g. `stellar:testnet`
 *   STELLAR_RPC_URL                  resolved RPC endpoint
 *   FACILITATOR_STELLAR_PRIVATE_KEY  the fee-sponsoring signer
 *
 * Our `loadConfig` already understands `STELLAR_NETWORK` and `STELLAR_RPC_URL`;
 * the only mapping needed is the signer key name.
 */

import { buildFacilitator } from "@stellar-bazaar/facilitator/app";
import { loadConfig, redact } from "@stellar-bazaar/facilitator/config";
import { assertOwnFacilitator } from "@stellar-bazaar/facilitator/own-facilitator";

const port = Number(process.env.PORT ?? "4022");

const signer = process.env.FACILITATOR_STELLAR_PRIVATE_KEY;
if (!signer) {
  console.error("FACILITATOR_STELLAR_PRIVATE_KEY is required by the upstream harness");
  process.exit(1);
}

/**
 * Refuse to run if the harness has been pointed at a facilitator that is not
 * ours. A conformance run settled through the public facilitator proves nothing
 * about this deployment, and it has happened here before (E-06a).
 */
assertOwnFacilitator(`http://127.0.0.1:${port}`, "upstream-e2e-proxy (self)");
if (process.env.FACILITATOR_URL) {
  assertOwnFacilitator(process.env.FACILITATOR_URL, "upstream-e2e-proxy (harness FACILITATOR_URL)");
}

const config = loadConfig({
  PORT: String(port),
  STELLAR_NETWORK: process.env.STELLAR_NETWORK ?? "testnet",
  STELLAR_RPC_URL: process.env.STELLAR_RPC_URL,
  SIGNER_SECRET_KEYS: signer,
  CATALOG_PATH: process.env.CATALOG_PATH ?? "./.catalog-upstream-e2e.db",
});

const { app, signerAddresses } = buildFacilitator(config);

/**
 * Graceful shutdown endpoint the harness calls between scenarios.
 *
 * It lives in the adapter rather than in `apps/facilitator`, so a production
 * deployment never exposes a remote-shutdown route just to satisfy a test rig.
 */
app.post("/close", async (_request, reply) => {
  reply.send({ status: "closing" });
  setTimeout(() => process.exit(0), 100);
});

await app.listen({ port, host: "0.0.0.0" });

console.log(JSON.stringify({ event: "config", ...redact(config) }));
console.log(JSON.stringify({ event: "signers", addresses: signerAddresses }));
// The exact string `GenericFacilitatorProxy` waits for. Do not reword.
console.log(`Facilitator listening on port ${port}`);
