/**
 * Demo buyer configuration.
 *
 * Unlike the seller, this service *does* hold a key, and that is the whole
 * reason the rest of the design is shaped the way it is. Two consequences show
 * up here:
 *
 *   `redact()` names each secret field explicitly rather than filtering by a
 *   pattern, so a field added later is opaque by default instead of leaking
 *   because nobody updated a regular expression;
 *   nothing about the payment is configurable. The network, asset, payee,
 *   amount and resource live in `invariants.ts` as constants, not as env vars,
 *   because an env var is a thing that can be set wrong at three in the
 *   morning and a constant is a thing that needs a code review.
 */

import { STELLAR_TESTNET_CAIP2 } from "@x402/stellar";

export interface DemoBuyerConfig {
  port: number;
  /** Pinned. There is no pubnet path through this service. */
  network: typeof STELLAR_TESTNET_CAIP2;
  /** The buyer's signing key. Never logged, never returned, never derived from. */
  buyerSecret: string;
  /** Where the ledger lives. A Railway volume in production. */
  dataDir: string;
  /** Off by default in effect: an unfunded buyer cannot pay anyway. */
  enabled: boolean;
  /** Refuse below this many USDC base units, before signing. */
  balanceFloorUnits: bigint;
  /** Guards `/internal/metrics`. Absent means the route is not registered. */
  metricsToken?: string;
  /** Horizon, for reading the buyer's own balance. Read-only. */
  horizonUrl: string;
}

export class DemoBuyerConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new DemoBuyerConfigError(`${name} is required`);
  return value;
}

function parsePort(raw: string | undefined): number {
  const port = Number(raw ?? "4430");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DemoBuyerConfigError(`PORT must be an integer in 1..65535, got "${raw}"`);
  }
  return port;
}

/**
 * Shape check only. A `S…` strkey is 56 characters, and catching a truncated
 * paste here turns a boot failure into the cheapest possible error.
 */
function parseSecret(raw: string): string {
  if (!/^S[A-Z2-7]{55}$/.test(raw)) {
    // Deliberately says nothing about what was received.
    throw new DemoBuyerConfigError("DEMO_BUYER_SECRET is not a valid Stellar secret key");
  }
  return raw;
}

function parseFloor(raw: string | undefined): bigint {
  // 0.5 USDC at 7 decimals. Three days of runway at the full daily cap.
  const value = (raw ?? "5000000").trim();
  if (!/^\d+$/.test(value)) {
    throw new DemoBuyerConfigError(`BALANCE_FLOOR_UNITS must be a non-negative integer, got "${raw}"`);
  }
  return BigInt(value);
}

export function loadDemoBuyerConfig(env: NodeJS.ProcessEnv = process.env): DemoBuyerConfig {
  const network = env.STELLAR_NETWORK?.trim() || "testnet";
  if (network !== "testnet" && network !== STELLAR_TESTNET_CAIP2) {
    throw new DemoBuyerConfigError(
      `STELLAR_NETWORK must be testnet for this service, got "${network}"`,
    );
  }

  return {
    port: parsePort(env.PORT),
    network: STELLAR_TESTNET_CAIP2,
    buyerSecret: parseSecret(required(env, "DEMO_BUYER_SECRET")),
    dataDir: env.DATA_DIR?.trim() || "/data",
    // One switch, so an operator can stop the demo without a deploy.
    enabled: (env.DEMO_ENABLED?.trim() || "true") !== "false",
    balanceFloorUnits: parseFloor(env.BALANCE_FLOOR_UNITS),
    metricsToken: env.METRICS_TOKEN?.trim() || undefined,
    horizonUrl: env.HORIZON_URL?.trim() || "https://horizon-testnet.stellar.org",
  };
}

/** Every secret field named. Adding one without adding it here is the bug. */
export function redact(config: DemoBuyerConfig): Record<string, unknown> {
  const { buyerSecret, metricsToken, ...rest } = config;
  return {
    ...rest,
    balanceFloorUnits: config.balanceFloorUnits.toString(),
    buyerSecret: buyerSecret ? "[redacted]" : undefined,
    metricsToken: metricsToken ? "[redacted]" : undefined,
  };
}
