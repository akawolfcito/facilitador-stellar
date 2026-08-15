/**
 * The derived search index must be rebuilt by the production boot path.
 *
 * ## The bug this pins
 *
 * `buildFacilitator` constructed a `SearchEngine` and never synced it.
 * `scheduleSearchSync()` ran only after a successful catalog write, so a
 * restarted process served a catalog whose every listing had no vector. The
 * engine scores a vectorless listing 0, and 0 is below the abstention
 * threshold, so `/discovery/search` refused every query until the next payment
 * happened to settle.
 *
 * The restart evidence in E-16 is real, but it is the E2E harness that
 * rehydrates: `apps/e2e-stellar/src/search.ts` calls `restarted.search.sync()`
 * explicitly. Nothing in `apps/facilitator` did.
 *
 * These tests therefore drive `startFacilitator` — the same function the
 * process entry point calls — and never call `search.sync()` themselves. A test
 * that synced by hand would reproduce the harness's mistake and prove nothing.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import {
  SqliteCatalogStore,
  catalogSettlement,
  type CatalogStore,
} from "@stellar-bazaar/catalog";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  declareDiscoveryExtension,
  type DeclareQueryDiscoveryExtensionConfig,
} from "@x402/extensions/bazaar";
import { STELLAR_TESTNET_CAIP2 } from "@x402/stellar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFacilitator, type StartedFacilitator } from "../src/app.js";
import type { FacilitatorConfig } from "../src/config.js";

/**
 * Point the embedder at the cache the rest of the workspace already populated,
 * so a unit test does not pull 86 MB from a CDN.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
process.env.MODELS_CACHE_DIR ??= resolve(HERE, "..", "..", "..", "packages", "search", ".models-cache");

const NETWORK = STELLAR_TESTNET_CAIP2;
const SELLER = "GDOEUTRI3CA534VATJBFTEFDOOAQR47UQBBLNRQ2IWAPLHV2OF433ULR";

let tmp: string;
const started: StartedFacilitator[] = [];

function config(catalogPath: string): FacilitatorConfig {
  return {
    // Port 0 lets the OS choose, so tests never collide with a dev server.
    port: 0,
    network: NETWORK,
    // A random, unfunded testnet key. Valid in shape so the signer constructs;
    // nothing in this file ever signs or submits.
    signerSecrets: [Keypair.random().secret()],
    rpcUrl: "https://soroban-testnet.stellar.org",
    areFeesSponsored: true,
    catalogPath,
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

function requirements(): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount: "10000",
    payTo: SELLER,
    maxTimeoutSeconds: 60,
    extra: {},
  };
}

function payload(): PaymentPayload {
  return {
    x402Version: 2,
    resource: {
      url: "https://seller.test/weather/forecast",
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

/** Persist a listing the only way the system allows: as a settled payment. */
function seedCatalog(path: string): void {
  const store = new SqliteCatalogStore(path);
  const outcome = catalogSettlement(store, {
    paymentPayload: payload(),
    paymentRequirements: requirements(),
    transaction: "f2d314684a2ff1470876f4f7ae8287b7a7e0897b0172ae885de779a606488e59",
  });
  expect(outcome.kind).toBe("cataloged");
  store.close();
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "facilitator-boot-"));
});

afterAll(async () => {
  await Promise.all(started.map((s) => s.stop()));
  rmSync(tmp, { recursive: true, force: true });
});

async function boot(catalogPath: string, store?: CatalogStore): Promise<StartedFacilitator> {
  const s = await startFacilitator(config(catalogPath), store);
  started.push(s);
  return s;
}

describe("a persisted catalog is searchable after a restart, with no new settlement", () => {
  it("rehydrates the index during boot and ranks the listing", async () => {
    const path = join(tmp, "restart.db");
    seedCatalog(path);

    // A second process over the same file — exactly what a redeploy looks like.
    const app = await boot(path);

    expect(app.discoveryStatus()).toBe("ready");

    const response = await app.app.inject({
      method: "GET",
      url: `/discovery/search?query=${encodeURIComponent("will it rain tomorrow?")}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.abstained, "a rehydrated index must not abstain on an answerable query").toBeUndefined();
    expect(body.resources[0].serviceName).toBe("Weather Forecast");
  }, 240_000);

  it("reports the rebuilt index on /health", async () => {
    const path = join(tmp, "restart.db");
    const app = await boot(path);
    const health = (await app.app.inject({ method: "GET", url: "/health" })).json();

    expect(health.ready).toBe(true);
    expect(health.discovery.status).toBe("ready");
    expect(health.discovery.indexed).toBe(1);
    // Liveness fields stay as they were.
    expect(health.status).toBe("ok");
    expect(health.catalog).toBe(1);
  }, 240_000);
});

describe("an empty catalog", () => {
  it("boots ready, and abstains rather than erroring", async () => {
    const app = await boot(join(tmp, "empty.db"));

    expect(app.discoveryStatus()).toBe("ready");
    const health = (await app.app.inject({ method: "GET", url: "/health" })).json();
    expect(health.ready).toBe(true);
    expect(health.discovery.indexed).toBe(0);

    const body = (
      await app.app.inject({ method: "GET", url: "/discovery/search?query=anything" })
    ).json();
    // Nothing to rank is a real answer; an unbuilt index is not.
    expect(body.abstained.reason).toBe("NO_ELIGIBLE_RESOURCES");
  }, 240_000);
});

describe("when the initial sync fails", () => {
  /** A store that persists fine but cannot be indexed. */
  function brokenStore(): CatalogStore {
    const real = new SqliteCatalogStore(":memory:");
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "all") {
          return () => {
            throw new Error("index source unavailable");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as CatalogStore;
  }

  it("keeps the payment plane serving and refuses to fake discovery", async () => {
    const app = await boot(join(tmp, "unused.db"), brokenStore());

    expect(app.discoveryStatus()).toBe("failed");

    // Payments are unaffected: the index is derived state, and settlement must
    // not depend on it.
    expect((await app.app.inject({ method: "GET", url: "/supported" })).statusCode).toBe(200);

    const health = (await app.app.inject({ method: "GET", url: "/health" })).json();
    expect(health.status).toBe("ok");
    expect(health.ready).toBe(false);
    expect(health.discovery.status).toBe("failed");

    const search = await app.app.inject({ method: "GET", url: "/discovery/search?query=weather" });
    expect(search.statusCode).toBe(503);
    const body = search.json();
    // The distinction that matters: "I have not looked" is not "I looked and
    // found nothing worth paying for".
    expect(body.reason).toBe("INDEX_NOT_READY");
    expect(body.abstained).toBeUndefined();
  }, 240_000);
});
