/**
 * The protected resource. Entirely stock upstream x402.
 *
 * `paymentMiddleware` from `@x402/fastify` and `ExactStellarScheme` from
 * `@x402/stellar/exact/server` do all the protocol work: emitting the 402 with
 * payment requirements, calling our facilitator's `/verify` and `/settle`, and
 * releasing the resource. Nothing here is patched — the only thing we supply is
 * configuration and a two-field JSON body.
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

export interface SellerConfig {
  port: number;
  facilitatorUrl: string;
  network: `${string}:${string}`;
  payTo: string;
  asset: string;
  amount: string;
}

export const PAID_PATH = "/paid-ping";

export function buildSeller(config: SellerConfig): FastifyInstance {
  const app = Fastify({ logger: false });

  // `HTTPFacilitatorClient` takes a config object, not a URL string. Passing a
  // string leaves `config.url` undefined and the client silently falls back to
  // DEFAULT_FACILITATOR_URL — the public x402.org facilitator — so the resource
  // server keeps working while settling through a third party. See UPSTREAM-01
  // in docs/scf/evidence-log.md.
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: config.facilitatorUrl }));
  server.register(config.network, new ExactStellarScheme());

  /**
   * Discovery metadata, declared with the upstream helper.
   *
   * Per-parameter descriptions are the point, not decoration: RFP §3.2 asks for
   * metadata that "makes an endpoint legible to an agent", and these strings are
   * what a discovery index has to rank on.
   */
  const discoveryConfig: DeclareQueryDiscoveryExtensionConfig = {
    method: "GET",
    input: { city: "Medellin" },
    inputSchema: {
      properties: {
        city: { type: "string", description: "City name to look up, for example Medellin" },
      },
      required: ["city"],
    },
    output: { example: { ok: true, message: "paid" } },
  };

  paymentMiddleware(
    app,
    {
      [`GET ${PAID_PATH}`]: {
        accepts: {
          payTo: config.payTo,
          scheme: "exact",
          network: config.network,
          price: { asset: config.asset, amount: config.amount },
        },
        serviceName: "Paid Ping",
        description: "Returns a fixed acknowledgement once a payment settles.",
        tags: ["demo", "ping", "stellar"],
        mimeType: "application/json",
        extensions: declareDiscoveryExtension(discoveryConfig),
      },
    },
    server,
  );

  app.get(PAID_PATH, async () => ({ ok: true, message: "paid" }));
  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
