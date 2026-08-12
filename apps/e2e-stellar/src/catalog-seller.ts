/**
 * A seller exposing several paid resources with deliberately overlapping
 * discovery metadata.
 *
 * The overlap is the point. Three weather services and three translation
 * services, one of which — "Token Translation Table" — is a lexical distractor
 * that resolves asset identifiers and performs no language translation. A
 * substring matcher cannot tell them apart; that is what the search evidence
 * has to demonstrate it can.
 *
 * Everything is stock upstream: `paymentMiddleware` from `@x402/fastify`,
 * `declareDiscoveryExtension` from `@x402/extensions/bazaar`.
 */

import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import {
  declareDiscoveryExtension,
  type DeclareQueryDiscoveryExtensionConfig,
} from "@x402/extensions/bazaar";
import { paymentMiddleware } from "@x402/fastify";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import Fastify, { type FastifyInstance } from "fastify";

export interface PaidResource {
  path: string;
  serviceName: string;
  description: string;
  tags: string[];
  discovery: DeclareQueryDiscoveryExtensionConfig;
  body: Record<string, unknown>;
}

export const PAID_RESOURCES: PaidResource[] = [
  {
    path: "/weather/forecast",
    serviceName: "Weather Forecast",
    description:
      "Short-range weather forecast for a city. Returns temperature, precipitation probability, wind speed and conditions for the next 48 hours.",
    tags: ["weather", "forecast", "rain"],
    discovery: {
      method: "GET",
      input: { city: "Medellin" },
      inputSchema: {
        properties: {
          city: { type: "string", description: "City name to forecast, for example Medellin" },
        },
        required: ["city"],
      },
      output: { example: { city: "Medellin", temperature: 22, unit: "C", rainChance: 0.4 } },
    },
    body: { city: "Medellin", temperature: 22, unit: "C", rainChance: 0.4 },
  },
  {
    path: "/weather/history",
    serviceName: "Historical Weather",
    description:
      "Historical weather observations for a location and date range. Daily aggregates of temperature, rainfall and wind going back thirty years.",
    tags: ["weather", "historical", "climate"],
    discovery: {
      method: "GET",
      input: { city: "Medellin", from: "2025-01-01" },
      inputSchema: {
        properties: {
          city: { type: "string", description: "City name to look up" },
          from: { type: "string", description: "Start date in ISO 8601 format" },
        },
        required: ["city", "from"],
      },
      output: { example: { city: "Medellin", meanTemperature: 21.4, totalRainfallMm: 88 } },
    },
    body: { city: "Medellin", meanTemperature: 21.4, totalRainfallMm: 88 },
  },
  {
    path: "/weather/alerts",
    serviceName: "Severe Weather Alerts",
    description:
      "Active severe weather warnings and advisories issued by national meteorological agencies for a region. Covers storms, floods, heat and wind.",
    tags: ["weather", "alerts", "storm", "safety"],
    discovery: {
      method: "GET",
      input: { region: "CO" },
      inputSchema: {
        properties: {
          region: { type: "string", description: "ISO country or subdivision code" },
        },
        required: ["region"],
      },
      output: { example: { region: "CO", alerts: [], severity: "none" } },
    },
    body: { region: "CO", alerts: [], severity: "none" },
  },
  {
    path: "/translate/text",
    serviceName: "Text Translation",
    description:
      "Translate short text between one hundred languages. Automatic source language detection, formal and informal register options.",
    tags: ["translation", "language", "nlp"],
    discovery: {
      method: "GET",
      input: { text: "hello", target: "es" },
      inputSchema: {
        properties: {
          text: { type: "string", description: "Text to translate, up to 5000 characters" },
          target: { type: "string", description: "Target language code, for example es or ja" },
        },
        required: ["text", "target"],
      },
      output: { example: { translated: "hola", detectedSource: "en" } },
    },
    body: { translated: "hola", detectedSource: "en" },
  },
  {
    path: "/translate/document",
    serviceName: "Document Translation",
    description:
      "Translate a whole PDF, DOCX or HTML document while preserving layout, tables and inline formatting. Returns a download URL for the translated file.",
    tags: ["translation", "document", "pdf", "layout"],
    discovery: {
      method: "GET",
      input: { documentUrl: "https://example.com/a.pdf", target: "es" },
      inputSchema: {
        properties: {
          documentUrl: {
            type: "string",
            description: "Publicly reachable URL of the source document to translate",
          },
          target: { type: "string", description: "Target language code" },
        },
        required: ["documentUrl", "target"],
      },
      output: { example: { downloadUrl: "https://example.com/a.es.pdf", pages: 12 } },
    },
    body: { downloadUrl: "https://example.com/a.es.pdf", pages: 12 },
  },
  {
    // The distractor: "translation" in the name, nothing to do with language.
    path: "/tokens/translation-table",
    serviceName: "Token Translation Table",
    description:
      "Map a token symbol or contract address to its canonical identifiers across chains. Despite the name this performs no language translation; it resolves asset identifiers.",
    tags: ["tokens", "identifiers", "mapping", "cross-chain"],
    discovery: {
      method: "GET",
      input: { symbol: "USDC" },
      inputSchema: {
        properties: {
          symbol: {
            type: "string",
            description: "Token symbol to resolve to canonical contract identifiers",
          },
        },
        required: ["symbol"],
      },
      output: { example: { symbol: "USDC", identifiers: { stellar: "C…", base: "0x…" } } },
    },
    body: { symbol: "USDC", identifiers: { stellar: "C...", base: "0x..." } },
  },
];

export interface CatalogSellerConfig {
  facilitatorUrl: string;
  network: `${string}:${string}`;
  payTo: string;
  asset: string;
  amount: string;
}

export function buildCatalogSeller(config: CatalogSellerConfig): FastifyInstance {
  const app = Fastify({ logger: false });

  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: config.facilitatorUrl }));
  server.register(config.network, new ExactStellarScheme());

  const routes: Record<string, unknown> = {};
  for (const resource of PAID_RESOURCES) {
    routes[`GET ${resource.path}`] = {
      accepts: {
        payTo: config.payTo,
        scheme: "exact",
        network: config.network,
        price: { asset: config.asset, amount: config.amount },
      },
      serviceName: resource.serviceName,
      description: resource.description,
      tags: resource.tags,
      mimeType: "application/json",
      extensions: declareDiscoveryExtension(resource.discovery),
    };
  }

  paymentMiddleware(app, routes as never, server);

  for (const resource of PAID_RESOURCES) {
    app.get(resource.path, async () => resource.body);
  }
  app.get("/health", async () => ({ status: "ok", resources: PAID_RESOURCES.length }));

  return app;
}
