/**
 * Configuration, validated at startup.
 *
 * The facilitator refuses to boot on bad configuration rather than failing on
 * the first payment. RFP §3.1 requires the mainnet fee to be configurable
 * rather than hard wired, and §3.6 asks for a stated degraded-mode story; both
 * start with knowing exactly what the process was given.
 */

import { STELLAR_PUBNET_CAIP2, STELLAR_TESTNET_CAIP2 } from "@x402/stellar";

export type StellarNetwork = typeof STELLAR_TESTNET_CAIP2 | typeof STELLAR_PUBNET_CAIP2;

export interface FacilitatorConfig {
  port: number;
  network: StellarNetwork;
  /** Secret keys of the fee-sponsoring signers. Never logged. */
  signerSecrets: string[];
  rpcUrl: string;
  /**
   * Whether `/supported` advertises `extra.areFeesSponsored`. Sponsoring is the
   * default because RFP §3.1 requires the buyer to need only the payment asset.
   */
  areFeesSponsored: boolean;
  /**
   * SQLite file backing the discovery catalog. `:memory:` makes the index
   * non-durable and is only appropriate for tests.
   */
  catalogPath: string;
}

const DEFAULT_RPC_URL: Record<StellarNetwork, string> = {
  [STELLAR_TESTNET_CAIP2]: "https://soroban-testnet.stellar.org",
  [STELLAR_PUBNET_CAIP2]: "https://mainnet.sorobanrpc.com",
};

export class ConfigError extends Error {}

function parseNetwork(raw: string | undefined): StellarNetwork {
  const value = raw ?? "testnet";
  if (value === "testnet" || value === STELLAR_TESTNET_CAIP2) return STELLAR_TESTNET_CAIP2;
  if (value === "pubnet" || value === "mainnet" || value === STELLAR_PUBNET_CAIP2) {
    return STELLAR_PUBNET_CAIP2;
  }
  throw new ConfigError(`STELLAR_NETWORK must be testnet or pubnet, got "${value}"`);
}

function parsePort(raw: string | undefined): number {
  const port = Number(raw ?? "4402");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be an integer in 1..65535, got "${raw}"`);
  }
  return port;
}

/**
 * Stellar secret keys are `S…` strkeys of 56 characters. Checking the shape
 * here means a typo surfaces at boot with a useful message instead of as an
 * opaque throw from the SDK on the first settlement.
 */
function parseSigners(raw: string | undefined): string[] {
  const secrets = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (secrets.length === 0) {
    throw new ConfigError("SIGNER_SECRET_KEYS is required (comma-separated Stellar S… secrets)");
  }
  for (const [i, secret] of secrets.entries()) {
    if (!/^S[A-Z2-7]{55}$/.test(secret)) {
      // The value itself is never echoed.
      throw new ConfigError(`SIGNER_SECRET_KEYS[${i}] is not a valid Stellar secret key`);
    }
  }
  return secrets;
}

/** Build and validate configuration from an environment-like record. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): FacilitatorConfig {
  const network = parseNetwork(env.STELLAR_NETWORK);
  return {
    port: parsePort(env.PORT),
    network,
    signerSecrets: parseSigners(env.SIGNER_SECRET_KEYS),
    rpcUrl: env.STELLAR_RPC_URL?.trim() || DEFAULT_RPC_URL[network],
    areFeesSponsored: (env.ARE_FEES_SPONSORED ?? "true") !== "false",
    catalogPath: env.CATALOG_PATH?.trim() || "./catalog.db",
  };
}

/** Configuration with secrets removed, safe to log. */
export function redact(config: FacilitatorConfig): Record<string, unknown> {
  return { ...config, signerSecrets: `${config.signerSecrets.length} signer(s)` };
}
