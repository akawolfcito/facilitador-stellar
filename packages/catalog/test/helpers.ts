import {
  declareDiscoveryExtension,
  type DeclareQueryDiscoveryExtensionConfig,
} from "@x402/extensions/bazaar";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";

export const SELLER_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASELLERA";
export const SELLER_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSELLERB";
export const ASSET = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const NETWORK: Network = "stellar:testnet";

/** A well-formed bazaar extension for a GET endpoint with one query param. */
export function validExtension(): Record<string, unknown> {
  // Typed explicitly: `DeclareDiscoveryExtensionInput` is a union and inference
  // picks the MCP branch for a bare literal, which has no `method`.
  const config: DeclareQueryDiscoveryExtensionConfig = {
    method: "GET",
    input: { city: "Medellin" },
    inputSchema: {
      properties: { city: { type: "string", description: "City to look up" } },
      required: ["city"],
    },
    output: { example: { city: "Medellin", temperature: 22, unit: "C" } },
  };
  return declareDiscoveryExtension(config);
}

export function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: ASSET,
    amount: "10000",
    payTo: SELLER_A,
    maxTimeoutSeconds: 60,
    extra: {},
    ...overrides,
  };
}

export interface PayloadOptions {
  url?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  description?: string;
  /** Replaces the whole bazaar extension object. */
  extension?: unknown;
  /** Adds routeTemplate to the bazaar extension. */
  routeTemplate?: string;
  /** Omits the bazaar extension entirely. */
  noBazaar?: boolean;
}

export function payload(
  options: PayloadOptions = {},
  reqs: PaymentRequirements = requirements(),
): PaymentPayload {
  const base = options.extension ?? validExtension().bazaar;
  const bazaar =
    options.routeTemplate !== undefined && base && typeof base === "object"
      ? { ...(base as Record<string, unknown>), routeTemplate: options.routeTemplate }
      : base;

  return {
    x402Version: 2,
    resource: {
      url: options.url ?? "https://seller-a.example/weather",
      description: options.description ?? "Weather for a city",
      ...(options.serviceName !== undefined ? { serviceName: options.serviceName } : {}),
      ...(options.tags !== undefined ? { tags: options.tags } : {}),
      ...(options.iconUrl !== undefined ? { iconUrl: options.iconUrl } : {}),
    },
    accepted: reqs,
    payload: { transaction: "AAAA" },
    ...(options.noBazaar ? {} : { extensions: { bazaar } }),
  };
}
