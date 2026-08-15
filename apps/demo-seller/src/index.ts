/** Process entry point. Validates configuration, then serves one paid resource. */

import { startSeller } from "./app.js";
import { loadSellerConfig } from "./config.js";

const config = loadSellerConfig();

// Safe to log in full: this service has no secret to redact. That is the point.
console.log(JSON.stringify({ event: "config", ...config }));

const seller = await startSeller(config);

console.log(JSON.stringify({ event: "listening", port: config.port }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void seller.stop().then(() => process.exit(0));
  });
}
