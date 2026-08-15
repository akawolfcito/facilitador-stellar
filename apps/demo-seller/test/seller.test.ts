/**
 * The public paid resource.
 *
 * Two things are worth asserting beyond "it returns 402". First, that the
 * seller needs no secret — a seller receives payment, it does not authorise
 * one, and if that ever stops being true it should break a test rather than
 * quietly appear in an env file. Second, that the 402 the seller emits *now* is
 * the authority: the catalog is advisory, and a client that pays a previously
 * cataloged amount is paying a stale number.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STELLAR_TESTNET_CAIP2 } from "@x402/stellar";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_TEXT_LENGTH, RESOURCE_PATH, buildSeller, summarize } from "../src/app.js";
import { SellerConfigError, USDC_TESTNET, loadSellerConfig, type SellerConfig } from "../src/config.js";
import type { FastifyInstance } from "fastify";

/**
 * A literal public address rather than a generated one.
 *
 * Generating it would mean depending on `@stellar/stellar-sdk`, and this
 * service deliberately does not — see the dependency test below. This is the
 * seller address already published throughout the committed evidence.
 */
const PAY_TO = "GDOEUTRI3CA534VATJBFTEFDOOAQR47UQBBLNRQ2IWAPLHV2OF433ULR";
const FACILITATOR = "http://127.0.0.1:4402";
const BASE = "https://demo-api.testnet.x402seek.xyz";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function config(overrides: Partial<SellerConfig> = {}): SellerConfig {
  return {
    port: 0,
    network: STELLAR_TESTNET_CAIP2,
    facilitatorUrl: FACILITATOR,
    payTo: PAY_TO,
    asset: USDC_TESTNET,
    amount: "10000",
    publicBaseUrl: BASE,
    ...overrides,
  };
}

function seller(overrides: Partial<SellerConfig> = {}): FastifyInstance {
  const app = buildSeller(config(overrides));
  apps.push(app);
  return app;
}

const env = (overrides: Record<string, string | undefined> = {}) => ({
  FACILITATOR_URL: FACILITATOR,
  SELLER_ADDRESS: PAY_TO,
  PUBLIC_BASE_URL: BASE,
  ...overrides,
});

describe("configuration", () => {
  it("needs no secret key of any kind", () => {
    const loaded = loadSellerConfig(env() as NodeJS.ProcessEnv);
    const text = JSON.stringify(loaded);
    // A seller receives payment; it never signs one.
    expect(text).not.toMatch(/S[A-Z2-7]{55}/);
    expect(Object.keys(loaded)).not.toContain("signerSecrets");
    expect(loaded.payTo).toBe(PAY_TO);
  });

  it("defaults to canonical testnet USDC at 0.0010000", () => {
    const loaded = loadSellerConfig(env() as NodeJS.ProcessEnv);
    expect(loaded.asset).toBe(USDC_TESTNET);
    expect(loaded.amount).toBe("10000");
    expect(Number(loaded.amount) / 1e7).toBe(0.001);
  });

  it("refuses to boot without a facilitator URL, and refuses the public one", () => {
    expect(() => loadSellerConfig(env({ FACILITATOR_URL: undefined }) as NodeJS.ProcessEnv)).toThrow();
    // Settling through x402.org would prove nothing about our facilitator —
    // this project has already shipped that bug once (E-06a).
    expect(() =>
      loadSellerConfig(env({ FACILITATOR_URL: "https://x402.org/facilitator" }) as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it("refuses a public base URL rather than guessing one", () => {
    // The catalog keys on this string and binds ownership to it, so a wrong
    // value poisons a canonical key. Failing to boot is the cheaper outcome.
    expect(() => loadSellerConfig(env({ PUBLIC_BASE_URL: undefined }) as NodeJS.ProcessEnv)).toThrow(
      SellerConfigError,
    );
    expect(() =>
      loadSellerConfig(env({ PUBLIC_BASE_URL: "not-a-url" }) as NodeJS.ProcessEnv),
    ).toThrow(SellerConfigError);
    expect(() =>
      loadSellerConfig(env({ PUBLIC_BASE_URL: "ftp://demo.example" }) as NodeJS.ProcessEnv),
    ).toThrow(SellerConfigError);
  });

  it("rejects a malformed address, a bad price and a non-testnet network", () => {
    expect(() => loadSellerConfig(env({ SELLER_ADDRESS: "GNOPE" }) as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadSellerConfig(env({ PRICE_AMOUNT: "0" }) as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadSellerConfig(env({ PRICE_AMOUNT: "-5" }) as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadSellerConfig(env({ PRICE_AMOUNT: "1.5" }) as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadSellerConfig(env({ STELLAR_NETWORK: "pubnet" }) as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("health", () => {
  it("answers without payment", async () => {
    const response = await seller().inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "x402seek-demo-seller",
      network: STELLAR_TESTNET_CAIP2,
      resource: `${BASE}${RESOURCE_PATH}`,
    });
  });
});

// The 402 itself needs a live facilitator — `x402ResourceServer` refuses to
// quote terms it has not confirmed anyone can settle — so those cases live in
// `integration.test.ts` rather than being faked here.

describe("the resource itself", () => {
  it("is deterministic", () => {
    expect(summarize("the quick brown fox jumped over the lazy dog")).toBe(
      "the quick brown fox jumped over the lazy… (9 words)",
    );
    expect(summarize("one two")).toBe("one two (2 words)");
    // Same input, same output — no clock, no randomness, no network.
    expect(summarize("repeatable")).toBe(summarize("repeatable"));
  });

  it("bounds its input", async () => {
    const app = seller();
    // Validation lives behind payment, so these are asserted on the handler.
    expect(summarize("a".repeat(10))).toBeTruthy();
    expect(MAX_TEXT_LENGTH).toBeLessThanOrEqual(10_000);
    expect(app.initialConfig.bodyLimit).toBe(16 * 1024);
    expect(app.server.requestTimeout).toBe(15_000);
  });
});

describe("dependency boundary", () => {
  it("does not depend on the Stellar SDK at all", () => {
    // A seller receives payment. It builds no transaction, signs nothing and
    // talks to no RPC, so it has no business carrying a chain SDK — and the
    // absence is worth pinning, because adding one would be easy and wrong.
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies)).not.toContain("@stellar/stellar-sdk");
  });
});

describe("the route surface", () => {
  it("exposes only health and the one paid resource", () => {
    const routes = seller().printRoutes({ commonPrefix: false });
    expect(routes).toContain("summarize");
    expect(routes).toContain("health");
    // No admin, registration, debug or catalog-write surface.
    expect(routes).not.toMatch(/admin|register|debug|internal|settle|verify/);
  });

  it("has no route that writes anything", () => {
    const routes = seller().printRoutes({ commonPrefix: false });
    expect(routes).not.toMatch(/POST|PUT|PATCH|DELETE/);
  });
});
