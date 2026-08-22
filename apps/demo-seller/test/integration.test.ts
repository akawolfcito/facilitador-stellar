/**
 * Seller and facilitator, together, without touching the chain.
 *
 * The seller cannot emit a 402 on its own: `x402ResourceServer` asks the
 * facilitator which payment kinds it supports, and refuses to serve terms it
 * has not confirmed somebody can settle. That is the right dependency — a
 * seller advertising a scheme no facilitator honours would be selling something
 * nobody can buy — so proving the 402 means running both.
 *
 * Everything up to the point where money moves is exercised here. The steps
 * that need a funded buyer and a real ledger are a separate, documented manual
 * command; see the note at the bottom of this file.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { SqliteCatalogStore } from "@stellar-bazaar/catalog";
import { buildFacilitator, type BuiltFacilitator } from "@stellar-bazaar/facilitator/app";
import { STELLAR_TESTNET_CAIP2 } from "@x402/stellar";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESOURCE_PATH, buildSeller } from "../src/app.js";
import { USDC_TESTNET, type SellerConfig } from "../src/config.js";

const PAY_TO = "GDOEUTRI3CA534VATJBFTEFDOOAQR47UQBBLNRQ2IWAPLHV2OF433ULR";
const PUBLIC_BASE = "https://demo-api.testnet.x402seek.xyz";

let facilitator: BuiltFacilitator;
let facilitatorUrl: string;
const sellers: FastifyInstance[] = [];

beforeAll(async () => {
  facilitator = buildFacilitator(
    {
      port: 0,
      network: STELLAR_TESTNET_CAIP2,
      // Unfunded and never used to sign: nothing in this file settles.
      signerSecrets: [Keypair.random().secret()],
      rpcUrl: "https://soroban-testnet.stellar.org",
      areFeesSponsored: true,
      catalogPath: ":memory:",
    },
    new SqliteCatalogStore(":memory:"),
  );
  facilitatorUrl = await facilitator.app.listen({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  await Promise.all(sellers.splice(0).map((s) => s.close()));
  await facilitator.app.close();
});

function seller(overrides: Partial<SellerConfig> = {}): FastifyInstance {
  const config: SellerConfig = {
    port: 0,
    network: STELLAR_TESTNET_CAIP2,
    facilitatorUrl,
    payTo: PAY_TO,
    asset: USDC_TESTNET,
    amount: "10000",
    publicBaseUrl: PUBLIC_BASE,
    ...overrides,
  };
  const app = buildSeller(config);
  sellers.push(app);
  return app;
}

/**
 * Decode the `payment-required` header.
 *
 * x402 v2 carries the terms base64 in that header, not in the body — the body
 * of an unpaid response is the seller's own placeholder. Reading the header is
 * therefore what a real client does, and asserting against the body would have
 * been asserting against nothing.
 */
interface PaymentRequired {
  x402Version: number;
  resource: { url: string; serviceName?: string; tags?: string[] };
  accepts: Record<string, unknown>[];
  extensions?: Record<string, unknown>;
}

function paymentRequired(response: { headers: Record<string, unknown> }): PaymentRequired {
  const header = response.headers["payment-required"];
  if (typeof header !== "string") throw new Error("no payment-required header on the 402");
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentRequired;
}

const terms = (response: { headers: Record<string, unknown> }) => paymentRequired(response).accepts[0]!;

describe("the facilitator the seller was pointed at", () => {
  it("advertises the Stellar exact scheme with fee sponsorship", async () => {
    const supported = (
      await facilitator.app.inject({ method: "GET", url: "/supported" })
    ).json();
    const kind = supported.kinds.find(
      (k: { network: string }) => k.network === STELLAR_TESTNET_CAIP2,
    );
    expect(kind.scheme).toBe("exact");
    expect(kind.extra.areFeesSponsored).toBe(true);
  });
});

describe("an unpaid request to the public resource", () => {
  it("returns 402 with terms a buyer can act on", async () => {
    const response = await seller().inject({
      method: "GET",
      url: `${RESOURCE_PATH}?text=hello%20world`,
    });

    expect(response.statusCode).toBe(402);
    const accepts = terms(response);
    expect(accepts.network).toBe(STELLAR_TESTNET_CAIP2);
    expect(accepts.scheme).toBe("exact");
    expect(accepts.asset).toBe(USDC_TESTNET);
    expect(accepts.amount).toBe("10000");
    expect(accepts.payTo).toBe(PAY_TO);
  });

  it("advertises the configured public URL, not the host it was reached on", async () => {
    // Behind a proxy the derived origin is internal, and the facilitator keys
    // its catalog — and binds ownership — on exactly this string.
    const response = await seller().inject({
      method: "GET",
      url: `${RESOURCE_PATH}?text=hello`,
      headers: { host: "10.0.0.7:8080" },
    });

    const required = paymentRequired(response);
    expect(required.resource.url).toBe(`${PUBLIC_BASE}${RESOURCE_PATH}`);
    expect(JSON.stringify(required)).not.toContain("10.0.0.7");
  });

  it("carries Bazaar metadata the facilitator can catalog, and nothing invented", async () => {
    const required = paymentRequired(
      await seller().inject({ method: "GET", url: `${RESOURCE_PATH}?text=hi` }),
    );
    const text = JSON.stringify(required);

    expect(required.resource.serviceName).toBe("Text Summarizer");
    expect(text).toContain("summarization");
    expect(text).toContain("bazaar");
    // Truthful metadata only — no reputation, uptime or traffic claims.
    expect(text).not.toMatch(/uptime|rating|reviews|traffic|users|verified/i);
  });
});

describe("the live 402 is the authority, the catalog is advisory", () => {
  it("serves the seller's current price, so a stale cataloged amount is visibly wrong", async () => {
    const cataloged = "10000";
    const response = await seller({ amount: "25000" }).inject({
      method: "GET",
      url: `${RESOURCE_PATH}?text=hello`,
    });

    expect(terms(response).amount).toBe("25000");
    expect(terms(response).amount).not.toBe(cataloged);
    // A client comparing the two before signing is exactly what
    // bazaar_pay_and_call does when it raises PAYMENT_REQUIREMENTS_CHANGED
    // (E-24). This test is the seller's half of that contract.
  });

  it("serves the seller's current asset too", async () => {
    const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const response = await seller({ asset: XLM_SAC }).inject({
      method: "GET",
      url: `${RESOURCE_PATH}?text=hi`,
    });
    expect(terms(response).asset).toBe(XLM_SAC);
  });
});

describe("what a settlement would catalog", () => {
  it("starts empty, and no unpaid request adds anything", async () => {
    // Cataloging is driven by settlement alone: there is no registration path,
    // so browsing or being quoted a price must leave the catalog untouched.
    const before = facilitator.catalog.list({}).pagination.total;
    await seller().inject({ method: "GET", url: `${RESOURCE_PATH}?text=hello` });
    await facilitator.app.inject({ method: "GET", url: "/discovery/resources" });
    expect(facilitator.catalog.list({}).pagination.total).toBe(before);
  });
});

/**
 * Not covered here, and deliberately so.
 *
 * Steps 3–10 of the acceptance flow — construct the payment, `/verify`,
 * `/settle`, the ledger, the retry that returns 200, automatic cataloging, and
 * the semantic query that then finds the resource — need a funded buyer and a
 * real Stellar testnet round trip. Those credentials are not in CI and should
 * not be, so they run as a documented manual command rather than as a test that
 * would either be skipped or be a lie:
 *
 *   pnpm --filter @stellar-bazaar/e2e-stellar provision      # once
 *   pnpm --filter @stellar-bazaar/e2e-stellar provision:usdc
 *   pnpm --filter @stellar-bazaar/e2e-stellar e2e
 *
 * The harness already drives exactly that loop against a real ledger (E-06,
 * E-09, E-12), which is why this file does not reimplement it.
 */
