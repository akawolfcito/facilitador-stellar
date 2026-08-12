/**
 * Facilitator HTTP surface for discovery.
 *
 * Exercises the wire contract with `app.inject`, so the assertions cover query
 * parsing, response shape and the `EXTENSION-RESPONSES` header rather than the
 * store logic (which `@stellar-bazaar/catalog` tests directly).
 */

import { SqliteCatalogStore, type CatalogListing } from "@stellar-bazaar/catalog";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFacilitator } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { FastifyInstance } from "fastify";

// A checksum-valid key, generated per run and never funded. `loadConfig`
// validates the strkey shape, but `createEd25519Signer` verifies the checksum,
// so a hand-written `S` + 55 chars is rejected further down.
const SECRET = Keypair.random().secret();
const SELLER = "GSELLERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function listing(overrides: Partial<CatalogListing> = {}): CatalogListing {
  return {
    canonicalKey: "https://a.example/one",
    type: "http",
    resource: "https://a.example/one",
    method: "GET",
    serviceName: "One",
    discoveryInfo: { input: { type: "http", method: "GET" } },
    extensions: { bazaar: { info: {} } },
    payTo: SELLER,
    network: "stellar:testnet",
    scheme: "exact",
    asset: "CASSET",
    amount: "10000",
    x402Version: 2,
    ownerPayTo: SELLER,
    ownershipBinding: "tofu",
    firstSeenAt: "2026-08-12T00:00:00.000Z",
    lastSeenAt: "2026-08-12T00:00:00.000Z",
    lastSettlementTx: "tx-1",
    metadataVersion: 1,
    ...overrides,
  };
}

let app: FastifyInstance;
let store: SqliteCatalogStore;

beforeEach(() => {
  store = new SqliteCatalogStore(":memory:");
  store.upsert(listing());
  store.upsert(
    listing({
      canonicalKey: "mcp://tool/summarize#tool=summarize",
      resource: "mcp://tool/summarize",
      type: "mcp",
      toolName: "summarize",
      method: undefined,
      network: "stellar:pubnet",
      firstSeenAt: "2026-08-12T00:00:01.000Z",
      lastSeenAt: "2026-08-12T00:00:01.000Z",
      discoveryInfo: { input: { type: "mcp", toolName: "summarize" } },
    }),
  );
  app = buildFacilitator(
    loadConfig({ SIGNER_SECRET_KEYS: SECRET, CATALOG_PATH: ":memory:" }),
    store,
  ).app;
});

afterEach(async () => {
  await app.close();
});

async function get(url: string): Promise<{ status: number; body: any }> {
  const res = await app.inject({ method: "GET", url });
  return { status: res.statusCode, body: res.json() };
}

describe("GET /discovery/resources", () => {
  it("returns every listing with pagination metadata", async () => {
    const { status, body } = await get("/discovery/resources");
    expect(status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.pagination).toEqual({ limit: 20, offset: 0, total: 2 });
    expect(body.x402Version).toBe(2);
  });

  it("exposes the ownership binding on every listing", async () => {
    const { body } = await get("/discovery/resources");
    for (const resource of body.items) {
      expect(resource.ownerPayTo).toBe(SELLER);
      // Buyers are told the binding is trust-on-first-use, not proof of URL
      // control. See docs/security/catalog-ownership-model.md §5.
      expect(resource.ownershipBinding).toBe("tofu");
    }
  });

  it("filters by type", async () => {
    expect((await get("/discovery/resources?type=mcp")).body.items).toHaveLength(1);
    expect((await get("/discovery/resources?type=http")).body.items).toHaveLength(1);
  });

  it("rejects an unknown type rather than silently ignoring it", async () => {
    const { status } = await get("/discovery/resources?type=grpc");
    expect(status).toBe(400);
  });

  it("filters by payTo, network and scheme", async () => {
    expect((await get(`/discovery/resources?payTo=${SELLER}`)).body.items).toHaveLength(2);
    expect((await get("/discovery/resources?payTo=GNOBODY")).body.items).toHaveLength(0);
    expect(
      (await get("/discovery/resources?network=stellar:pubnet")).body.items,
    ).toHaveLength(1);
    expect((await get("/discovery/resources?scheme=upto")).body.items).toHaveLength(0);
  });

  it("accepts extensions as a comma list and as repeated params", async () => {
    expect((await get("/discovery/resources?extensions=bazaar")).body.items).toHaveLength(2);
    expect(
      (await get("/discovery/resources?extensions=bazaar,builder-code")).body.items,
    ).toHaveLength(0);
    expect(
      (await get("/discovery/resources?extensions=bazaar&extensions=bazaar")).body.items,
    ).toHaveLength(2);
  });

  it("paginates deterministically", async () => {
    const first = await get("/discovery/resources?limit=1&offset=0");
    const second = await get("/discovery/resources?limit=1&offset=1");
    expect(first.body.items[0].canonicalKey).toBe("https://a.example/one");
    expect(second.body.items[0].canonicalKey).toBe("mcp://tool/summarize#tool=summarize");
    expect(first.body.pagination.total).toBe(2);
  });

  it("ignores a non-numeric limit instead of erroring", async () => {
    const { status, body } = await get("/discovery/resources?limit=abc");
    expect(status).toBe(200);
    expect(body.pagination.limit).toBe(20);
  });
});

describe("POST /settle request validation", () => {
  it("rejects a body with no payload and gives a non-null reason", async () => {
    const res = await app.inject({ method: "POST", url: "/settle", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().errorReason).toBe("invalid_request_body");
  });

  it("does not emit EXTENSION-RESPONSES when nothing was cataloged", async () => {
    const res = await app.inject({ method: "POST", url: "/settle", payload: {} });
    expect(res.headers["extension-responses"]).toBeUndefined();
  });
});

describe("GET /health", () => {
  it("reports catalog size", async () => {
    const { body } = await get("/health");
    expect(body.status).toBe("ok");
    expect(body.catalog).toBe(2);
  });
});
