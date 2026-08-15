/**
 * Seller configuration, validated at startup.
 *
 * The headline property: **this service holds no secret**. A seller receives
 * payment, it does not authorise or submit one, so it needs a public address
 * and nothing else. If a future change makes a key necessary here, that is a
 * design regression worth stopping for, not an env var worth adding.
 */

import { assertOwnFacilitator } from "@stellar-bazaar/facilitator/own-facilitator";
import { STELLAR_TESTNET_CAIP2 } from "@x402/stellar";

export interface SellerConfig {
  port: number;
  /** Pinned to testnet: this is a preview, and pubnet is not in scope. */
  network: typeof STELLAR_TESTNET_CAIP2;
  /** Where the buyer's payment is verified and settled. Ours, asserted. */
  facilitatorUrl: string;
  /** Public `G…` address that receives payment. Not a key. */
  payTo: string;
  /** SEP-41 asset contract the price is denominated in. */
  asset: string;
  /** Price in atomic units. `10000` is 0.0010000 at 7 decimals. */
  amount: string;
  /**
   * Public origin this resource is reachable at.
   *
   * Required, with no default, and that is deliberate. The facilitator keys its
   * catalog on the resource URL and binds ownership to it on first settlement,
   * so a seller that advertises an internal address behind a proxy would
   * catalog a listing nobody can reach and bind the wrong canonical key. Better
   * to refuse to boot than to poison the catalog.
   */
  publicBaseUrl: string;
}

export class SellerConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new SellerConfigError(`${name} is required`);
  return value;
}

/** Canonical testnet USDC, the asset the agent demo settled in (E-22…E-25). */
export const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

function parsePort(raw: string | undefined): number {
  const port = Number(raw ?? "4420");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SellerConfigError(`PORT must be an integer in 1..65535, got "${raw}"`);
  }
  return port;
}

function parseAddress(raw: string): string {
  // Public Stellar addresses are `G…` strkeys of 56 characters. A shape check
  // here turns a typo into a boot failure instead of a payment sent nowhere.
  if (!/^G[A-Z2-7]{55}$/.test(raw)) {
    throw new SellerConfigError("SELLER_ADDRESS is not a valid Stellar public address");
  }
  return raw;
}

function parseAmount(raw: string | undefined): string {
  const amount = (raw ?? "10000").trim();
  if (!/^[1-9]\d*$/.test(amount)) {
    throw new SellerConfigError(`PRICE_AMOUNT must be a positive integer of atomic units, got "${raw}"`);
  }
  return amount;
}

function parseBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SellerConfigError(`PUBLIC_BASE_URL is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SellerConfigError("PUBLIC_BASE_URL must be http or https");
  }
  // Normalised without a trailing slash so the resource URL is built once and
  // matches what the catalog will key on.
  return parsed.origin;
}

export function loadSellerConfig(env: NodeJS.ProcessEnv = process.env): SellerConfig {
  const network = env.STELLAR_NETWORK?.trim() || "testnet";
  if (network !== "testnet" && network !== STELLAR_TESTNET_CAIP2) {
    throw new SellerConfigError(
      `STELLAR_NETWORK must be testnet for this preview, got "${network}"`,
    );
  }

  return {
    port: parsePort(env.PORT),
    network: STELLAR_TESTNET_CAIP2,
    // Refuses a missing URL and refuses the public x402.org facilitator: a
    // demo that settles through somebody else's facilitator proves nothing
    // about ours, and we have already shipped that bug once (E-06a).
    facilitatorUrl: assertOwnFacilitator(required(env, "FACILITATOR_URL"), "demo-seller"),
    payTo: parseAddress(required(env, "SELLER_ADDRESS")),
    asset: env.ASSET?.trim() || USDC_TESTNET,
    amount: parseAmount(env.PRICE_AMOUNT),
    publicBaseUrl: parseBaseUrl(required(env, "PUBLIC_BASE_URL")),
  };
}
