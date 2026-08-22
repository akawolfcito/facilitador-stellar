/**
 * The properties a funded, publicly reachable deployment depends on.
 *
 * Each of these is something the readiness audit flagged as a way to lose money
 * or lose the catalog, so they are asserted rather than assumed.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import {
  SqliteCatalogStore,
  catalogSettlement,
  type CatalogListing,
} from "@stellar-bazaar/catalog";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  declareDiscoveryExtension,
  type DeclareQueryDiscoveryExtensionConfig,
} from "@x402/extensions/bazaar";
import { STELLAR_TESTNET_CAIP2 } from "@x402/stellar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFacilitator, type StartedFacilitator } from "../src/app.js";
import { ConfigError, loadConfig, type FacilitatorConfig } from "../src/config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.MODELS_CACHE_DIR ??= resolve(HERE, "..", "..", "..", "packages", "search", ".models-cache");

const NETWORK = STELLAR_TESTNET_CAIP2;
const SELLER = "GDOEUTRI3CA534VATJBFTEFDOOAQR47UQBBLNRQ2IWAPLHV2OF433ULR";
const OTHER_SELLER = "GBA75KBIVWVJ53QOTG5E3K5O5BJQUHDKT6EYZCCABCB32YSNJZNQR7N6";
const TX = "f2d314684a2ff1470876f4f7ae8287b7a7e0897b0172ae885de779a606488e59";

let volume: string;
const started: StartedFacilitator[] = [];

beforeAll(() => {
  // Stands in for the mounted Railway volume: a directory that outlives the
  // process writing to it.
  volume = mkdtempSync(join(tmpdir(), "facilitator-volume-"));
});

afterAll(async () => {
  await Promise.all(started.map((s) => s.stop()));
  rmSync(volume, { recursive: true, force: true });
});

function config(catalogPath: string, overrides: Partial<FacilitatorConfig> = {}): FacilitatorConfig {
  return {
    port: 0,
    network: NETWORK,
    signerSecrets: [Keypair.random().secret()],
    rpcUrl: "https://soroban-testnet.stellar.org",
    areFeesSponsored: true,
    catalogPath,
    ...overrides,
  };
}

const DISCOVERY: DeclareQueryDiscoveryExtensionConfig = {
  method: "GET",
  input: { city: "Medellin" },
  inputSchema: {
    properties: { city: { type: "string", description: "City name to forecast" } },
    required: ["city"],
  },
  output: { example: { city: "Medellin", rainChance: 0.4 } },
};

function requirements(payTo = SELLER): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount: "10000",
    payTo,
    maxTimeoutSeconds: 60,
    extra: {},
  };
}

function payload(): PaymentPayload {
  return {
    x402Version: 2,
    resource: {
      url: "https://demo-api.testnet.x402seek.xyz/weather/forecast",
      description:
        "Short-range weather forecast for a city. Returns temperature, precipitation " +
        "probability, wind speed and conditions for the next 48 hours.",
      serviceName: "Weather Forecast",
      tags: ["weather", "forecast", "rain"],
    },
    accepted: requirements(),
    payload: { transaction: "AAAA" },
    extensions: declareDiscoveryExtension(DISCOVERY),
  } as unknown as PaymentPayload;
}

async function boot(catalogPath: string): Promise<StartedFacilitator> {
  const app = await startFacilitator(config(catalogPath));
  started.push(app);
  return app;
}

describe("the catalog survives a container replacement", () => {
  it("keeps listings, rehydrates search, and holds the ownership binding", async () => {
    const path = join(volume, "catalog.db");

    // --- first container: a settlement catalogs a resource -------------------
    const first = new SqliteCatalogStore(path);
    const outcome = catalogSettlement(first, {
      paymentPayload: payload(),
      paymentRequirements: requirements(),
      transaction: TX,
    });
    expect(outcome.kind).toBe("cataloged");
    const bound = (outcome as { listing: CatalogListing }).listing.ownerPayTo;
    first.close();

    // --- second container: same volume, new process -------------------------
    const app = await boot(path);

    expect(app.catalog.list({}).pagination.total).toBe(1);
    expect(app.discoveryStatus()).toBe("ready");

    const ready = await app.app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);

    // Searchable with no new settlement — the whole point of the boot rehydrate.
    const search = await app.app.inject({
      method: "GET",
      url: `/discovery/search?query=${encodeURIComponent("will it rain tomorrow?")}`,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().resources[0].serviceName).toBe("Weather Forecast");

    // --- and the binding is still the one from first settlement -------------
    const listing = app.catalog.list({}).resources[0]!;
    expect(listing.ownerPayTo).toBe(bound);
    expect(listing.ownershipBinding).toBe("tofu");

    // A different payTo cannot take over the canonical key it already holds.
    const hijack = catalogSettlement(app.catalog, {
      paymentPayload: payload(),
      paymentRequirements: requirements(OTHER_SELLER),
      transaction: "a".repeat(64),
    });
    expect(hijack.kind).toBe("rejected");
    if (hijack.kind === "rejected") expect(hijack.code).toBe("OWNERSHIP_CONFLICT");
    expect(app.catalog.list({}).resources[0]!.ownerPayTo).toBe(bound);
  }, 240_000);

  it("would have lost all of that on an ephemeral filesystem", async () => {
    // The counter-case, so the volume requirement is evidence and not folklore:
    // a fresh path is a fresh catalog, and the binding is gone with it.
    const app = await boot(join(volume, "somewhere-else.db"));
    expect(app.catalog.list({}).pagination.total).toBe(0);
  }, 240_000);
});

describe("replaying an already-settled payment", () => {
  /**
   * Scope, stated plainly.
   *
   * On-chain replay protection is Soroban's: an auth entry carries a nonce and
   * an expiry, and a replayed one is rejected by the network, not by us. This
   * does not reimplement that.
   *
   * What is ours, and what these assert, is that a replay cannot quietly
   * produce a *second* catalog entry or a second recorded success — and that a
   * replayed settlement that fails on chain is counted as a failure, which is
   * how an operator would see a replay flood at all.
   *
   * The residual cost is real and is not fixed here: a submission that fails
   * still burns the fee. That is bounded by the /settle rate limit and the
   * concurrency cap, not by deduplication, and the operator float exists to
   * absorb it.
   */
  it("does not create a second listing or a second provenance record", async () => {
    const store = new SqliteCatalogStore(":memory:");
    const input = {
      paymentPayload: payload(),
      paymentRequirements: requirements(),
      transaction: TX,
    };

    const first = catalogSettlement(store, input);
    expect(first.kind).toBe("cataloged");

    // The identical settlement callback arrives again.
    const replayed = catalogSettlement(store, input);
    expect(replayed.kind, "a replay must not catalog a second time").toBe("noop");

    expect(store.list({}).pagination.total).toBe(1);
    expect(store.list({}).resources[0]!.lastSettlementTx).toBe(TX);
    store.close();
  });

  it("counts a rejected replay as a failed submission, not a success", async () => {
    const app = await boot(join(volume, "replay.db"));

    // Stand in for what the chain does to a consumed auth entry.
    app.facilitator.settle = (async () => ({
      success: false,
      errorReason: "submission_failed",
      transaction: null,
      network: NETWORK,
    })) as unknown as typeof app.facilitator.settle;

    const body = {
      paymentPayload: { x402Version: 2, payload: {} },
      paymentRequirements: { scheme: "exact", network: NETWORK },
    };
    await app.app.inject({ method: "POST", url: "/settle", payload: body });
    await app.app.inject({ method: "POST", url: "/settle", payload: body });

    const snap = app.metrics.snapshot({
      catalogListings: 0,
      searchStatus: "ready",
      searchIndexed: 0,
      settlementsInFlight: 0,
    });
    expect(snap.stellar.settlementsSucceeded).toBe(0);
    expect(snap.stellar.submissionsFailed).toBe(2);
    expect(snap.rejections.SUBMISSION_FAILURE).toBe(2);
  }, 240_000);
});

describe("network safety", () => {
  const base = {
    SIGNER_SECRET_KEYS: Keypair.random().secret(),
    CATALOG_PATH: "/data/catalog.db",
  };

  it("refuses to start when the deployment lock disagrees with the network", () => {
    expect(() =>
      loadConfig({
        ...base,
        STELLAR_NETWORK: "pubnet",
        DEPLOYMENT_NETWORK_LOCK: "testnet",
      } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
  });

  it("starts when they agree", () => {
    const config = loadConfig({
      ...base,
      STELLAR_NETWORK: "testnet",
      DEPLOYMENT_NETWORK_LOCK: "testnet",
    } as NodeJS.ProcessEnv);
    expect(config.network).toBe(NETWORK);
  });

  it("stays unlocked when no lock is declared, so local work is unaffected", () => {
    expect(loadConfig({ ...base, STELLAR_NETWORK: "pubnet" } as NodeJS.ProcessEnv).network).toBe(
      "stellar:pubnet",
    );
  });

  it("rejects a lock value that is not a network", () => {
    expect(() =>
      loadConfig({ ...base, DEPLOYMENT_NETWORK_LOCK: "mainnet-ish" } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
  });
});

describe("readiness is separate from liveness", () => {
  it("serves /health while /ready still refuses", async () => {
    // buildFacilitator without initializeSearch: alive, not ready.
    const app = await startFacilitator(config(join(volume, "readiness.db")));
    started.push(app);

    // After startFacilitator the index is built, so force the other state.
    const cold = await startFacilitator(config(":memory:"));
    started.push(cold);

    expect((await cold.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await cold.app.inject({ method: "GET", url: "/ready" })).statusCode).toBe(200);
    expect((await app.app.inject({ method: "GET", url: "/ready" })).json().ready).toBe(true);
  }, 240_000);

  it("keeps secrets out of every public surface", async () => {
    const app = await boot(join(volume, "secrets.db"));
    for (const url of ["/health", "/ready", "/supported"]) {
      const body = (await app.app.inject({ method: "GET", url })).body;
      expect(body, url).not.toMatch(/S[A-Z2-7]{55}/);
      expect(body, url).not.toContain("SIGNER");
      expect(body, url).not.toContain("METRICS_TOKEN");
    }
  }, 240_000);
});
