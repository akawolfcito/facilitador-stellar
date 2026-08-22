/** Process entry point. Validates configuration, then serves one paid resource. */

import { startSeller } from "./app.js";
import { loadSellerConfig } from "./config.js";

const config = loadSellerConfig();

// Safe to log in full: this service has no secret to redact. That is the point.
console.log(JSON.stringify({ event: "config", ...config }));

// Not awaited on the facilitator. The port opens now; readiness catches up, and
// says so at /ready while it does.
const seller = await startSeller(config);

console.log(
  JSON.stringify({
    event: "listening",
    port: config.port,
    ready: seller.readiness().ready,
  }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // stop() cancels the pending retry and aborts a probe in flight, so this
    // does not sit out a five second fetch before the process can exit.
    void seller.stop().then(() => process.exit(0));
  });
}
