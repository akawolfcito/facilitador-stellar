/** Process entry point. Validates configuration, then serves. */

import { buildFacilitator } from "./app.js";
import { loadConfig, redact } from "./config.js";

const config = loadConfig();
const { app, signerAddresses } = buildFacilitator(config);

console.log(JSON.stringify({ event: "config", ...redact(config) }));
console.log(JSON.stringify({ event: "signers", addresses: signerAddresses }));

await app.listen({ port: config.port, host: "0.0.0.0" });
console.log(JSON.stringify({ event: "listening", port: config.port }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
