/** Process entry point. Validates configuration, then serves. */

import { startFacilitator } from "./app.js";
import { loadConfig, redact } from "./config.js";

const config = loadConfig();

console.log(JSON.stringify({ event: "config", ...redact(config) }));

// Boots, listens, and rebuilds the derived search index — in that order, and
// all inside `startFacilitator` so tests exercise the same sequence production
// does. The index used to be left empty until the first settlement, which made
// a restarted process refuse every discovery query.
const facilitator = await startFacilitator(config);

console.log(JSON.stringify({ event: "signers", addresses: facilitator.signerAddresses }));
console.log(JSON.stringify({ event: "listening", port: config.port }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void facilitator.stop().then(() => process.exit(0));
  });
}
