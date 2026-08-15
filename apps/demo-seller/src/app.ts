/**
 * One paid HTTP resource, for demonstrating the payment loop end to end.
 *
 * Everything protocol-facing is stock upstream — `paymentMiddleware` from
 * `@x402/fastify`, `declareDiscoveryExtension` from `@x402/extensions/bazaar`,
 * `ExactStellarScheme` from `@x402/stellar/exact/server` — wired the same way
 * `apps/e2e-stellar/src/catalog-seller.ts` wires it. Nothing about x402 seller
 * behaviour is reimplemented here; what is new is only that it can be operated
 * as a service instead of started by a test harness.
 *
 * One resource, on purpose. The point is proof of the loop, not catalog
 * breadth — the facilitator's catalog already has breadth, and it gets it the
 * only way it can: by being paid for.
 */

import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import {
  declareDiscoveryExtension,
  type DeclareQueryDiscoveryExtensionConfig,
} from "@x402/extensions/bazaar";
import { paymentMiddleware } from "@x402/fastify";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import Fastify, { type FastifyInstance } from "fastify";
import type { SellerConfig } from "./config.js";

/** Path of the single paid resource. */
export const RESOURCE_PATH = "/summarize";

/** Longest input accepted, so a request cannot be made arbitrarily expensive. */
export const MAX_TEXT_LENGTH = 4_000;

/**
 * Condense text to its opening words and a count.
 *
 * Deliberately trivial and deterministic: the same input always produces the
 * same output, there is no model, no network call and no state. A demo resource
 * should be honest about what it does — this one does exactly what it says,
 * which a canned "weather forecast" returning a fixed temperature would not.
 *
 * Same function as the MCP tool in `apps/e2e-stellar/src/mcp-tool-server.ts`,
 * kept here rather than imported so a public service does not depend on a test
 * harness workspace.
 */
export function summarize(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const head = words.slice(0, 8).join(" ");
  return `${head}${words.length > 8 ? "…" : ""} (${words.length} words)`;
}

/**
 * Typed explicitly: `DeclareDiscoveryExtensionInput` is a union, and inference
 * picks the MCP branch for a bare literal — which has no `method`.
 */
const DISCOVERY: DeclareQueryDiscoveryExtensionConfig = {
  method: "GET",
  input: { text: "the quick brown fox jumped over the lazy dog" },
  inputSchema: {
    properties: {
      text: {
        type: "string",
        description: `Text to summarize, up to ${MAX_TEXT_LENGTH} characters`,
      },
    },
    required: ["text"],
  },
  output: { example: { summary: "the quick brown fox jumped over the lazy… (9 words)" } },
};

export function buildSeller(config: SellerConfig): FastifyInstance {
  const app = Fastify({
    logger: false,
    // A summarisation request is a query string; nothing here needs a large
    // body, and a bounded one is one less thing to reason about.
    bodyLimit: 16 * 1024,
    requestTimeout: 15_000,
    keepAliveTimeout: 30_000,
  });

  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: config.facilitatorUrl }),
  );
  server.register(config.network, new ExactStellarScheme());

  /**
   * The advertised resource URL is configured, not derived from the request.
   *
   * Behind a proxy the derived value would be the internal origin, and the
   * facilitator keys its catalog — and binds ownership — on exactly this
   * string. Getting it from configuration is what makes a hosted listing point
   * at somewhere a reviewer can actually reach.
   */
  const resourceUrl = `${config.publicBaseUrl}${RESOURCE_PATH}`;

  paymentMiddleware(
    app,
    {
      [`GET ${RESOURCE_PATH}`]: {
        accepts: {
          payTo: config.payTo,
          scheme: "exact",
          network: config.network,
          price: { asset: config.asset, amount: config.amount },
        },
        resource: resourceUrl,
        serviceName: "Text Summarizer",
        description:
          "Condense a passage of text into one short line: its opening words and a word count. " +
          "Deterministic — the same text always returns the same summary.",
        tags: ["summarization", "text", "nlp"],
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(DISCOVERY),
      },
    } as never,
    server,
  );

  app.get(RESOURCE_PATH, async (request, reply) => {
    const { text } = request.query as { text?: string };
    if (typeof text !== "string" || text.trim() === "") {
      return reply.code(400).send({ error: "text is required" });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return reply
        .code(400)
        .send({ error: `text must be ${MAX_TEXT_LENGTH} characters or fewer` });
    }
    return { summary: summarize(text) };
  });

  /** Unpaid on purpose: a health check must not need a wallet. */
  app.get("/health", async () => ({
    status: "ok",
    service: "x402seek-demo-seller",
    network: config.network,
    resource: resourceUrl,
    price: { asset: config.asset, amount: config.amount },
  }));

  return app;
}

export interface StartedSeller {
  app: FastifyInstance;
  address: string;
  stop(): Promise<void>;
}

export async function startSeller(config: SellerConfig): Promise<StartedSeller> {
  const app = buildSeller(config);
  const address = await app.listen({ port: config.port, host: "0.0.0.0" });
  return { app, address, stop: () => app.close() };
}
