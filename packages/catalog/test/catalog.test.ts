import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogSettlement, encodeExtensionResponses } from "../src/catalog.js";
import { SqliteCatalogStore } from "../src/store.js";
import type { CatalogOutcome, CatalogStore } from "../src/types.js";
import { ASSET, NETWORK, SELLER_A, SELLER_B, payload, requirements } from "./helpers.js";

let store: SqliteCatalogStore;
const at = (iso: string) => () => new Date(iso);

beforeEach(() => {
  store = new SqliteCatalogStore(":memory:");
});
afterEach(() => {
  store.close();
});

function settle(
  overrides: Parameters<typeof payload>[0] = {},
  opts: { reqs?: ReturnType<typeof requirements>; tx?: string; now?: () => Date } = {},
): CatalogOutcome {
  const reqs = opts.reqs ?? requirements();
  return catalogSettlement(store, {
    paymentPayload: payload(overrides, reqs),
    paymentRequirements: reqs,
    transaction: opts.tx ?? "tx-1",
    now: opts.now ?? at("2026-08-12T00:00:00.000Z"),
  });
}

// ---------------------------------------------------------------- 1
describe("valid payment + valid Bazaar metadata", () => {
  it("writes a listing", () => {
    const outcome = settle();
    expect(outcome.kind).toBe("cataloged");
    if (outcome.kind !== "cataloged") return;

    expect(outcome.created).toBe(true);
    expect(outcome.status).toBe("success");
    expect(outcome.listing.canonicalKey).toBe("https://seller-a.example/weather");
    expect(outcome.listing.type).toBe("http");
    expect(outcome.listing.method).toBe("GET");
    expect(store.get("https://seller-a.example/weather")).toBeDefined();
  });

  it("derives payment terms from the validated requirements, not the metadata", () => {
    const outcome = settle({}, { reqs: requirements({ payTo: SELLER_B, amount: "77" }) });
    expect(outcome.kind).toBe("cataloged");
    if (outcome.kind !== "cataloged") return;

    // I4: these are settled facts, copied from requirements.
    expect(outcome.listing.payTo).toBe(SELLER_B);
    expect(outcome.listing.amount).toBe("77");
    expect(outcome.listing.asset).toBe(ASSET);
    expect(outcome.listing.network).toBe(NETWORK);
    expect(outcome.listing.scheme).toBe("exact");
    expect(outcome.listing.ownerPayTo).toBe(SELLER_B);
    expect(outcome.listing.ownershipBinding).toBe("tofu");
  });

  it("records provenance", () => {
    const outcome = settle({}, { tx: "abc123" });
    if (outcome.kind !== "cataloged") throw new Error("expected cataloged");
    expect(outcome.listing.lastSettlementTx).toBe("abc123");
    expect(outcome.listing.firstSeenAt).toBe("2026-08-12T00:00:00.000Z");
    expect(outcome.listing.metadataVersion).toBe(1);
  });
});

// ---------------------------------------------------------------- 2
describe("no settlement", () => {
  it("writes nothing, because cataloging is only ever reached from a settled payment", () => {
    // The hook is not invoked on failure; the catalog stays empty.
    expect(store.list({}).resources).toHaveLength(0);
  });

  it("skips a payload with no bazaar extension and reports nothing on the wire", () => {
    const outcome = settle({ noBazaar: true });
    expect(outcome.kind).toBe("skipped");
    expect(encodeExtensionResponses(outcome)).toBeUndefined();
    expect(store.list({}).resources).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- 3, 14
describe("malformed Bazaar metadata", () => {
  it("soft-rejects without writing, so the payment is unaffected", () => {
    const outcome = settle({ extension: { info: { nope: true } } });
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") return;
    expect(outcome.code).toBe("INVALID_SCHEMA");
    expect(store.list({}).resources).toHaveLength(0);
  });

  it("rejects info that does not validate against its own supplied schema", () => {
    const outcome = settle({
      extension: {
        info: { input: { type: "http", method: "GET", query: { city: 42 } } },
        schema: {
          type: "object",
          properties: { input: { type: "object", properties: { query: { type: "string" } } } },
        },
      },
    });
    expect(outcome.kind).toBe("rejected");
    expect(store.list({}).resources).toHaveLength(0);
  });

  it("always carries a non-null reason", () => {
    for (const ext of [{ info: { nope: true } }, { info: { input: { type: "carrier-pigeon" } } }]) {
      const outcome = settle({ extension: ext });
      if (outcome.kind !== "rejected") throw new Error("expected rejection");
      expect(outcome.message).toBeTruthy();
      const header = encodeExtensionResponses(outcome);
      const decoded = JSON.parse(Buffer.from(header!, "base64").toString("utf8"));
      expect(decoded.bazaar.status).toBe("rejected");
      expect(decoded.bazaar.rejectedReason).toBeTruthy();
      expect(decoded.bazaar.rejectedReason).toContain(outcome.code);
    }
  });
});

// ---------------------------------------------------------------- 4, 12
describe("routeTemplate", () => {
  it("accepts a valid template and uses it as the canonical path", () => {
    const outcome = settle({
      url: "https://seller-a.example/weather/co/medellin",
      routeTemplate: "/weather/:country/:city",
    });
    if (outcome.kind !== "cataloged") throw new Error("expected cataloged");
    expect(outcome.listing.canonicalKey).toBe("https://seller-a.example/weather/:country/:city");
    expect(outcome.listing.routeTemplate).toBe("/weather/:country/:city");
  });

  it("soft-rejects a traversal template rather than silently re-keying the listing", () => {
    const outcome = settle({ routeTemplate: "/../../etc/passwd" });
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") return;
    expect(outcome.code).toBe("INVALID_ROUTE_TEMPLATE");
    expect(store.list({}).resources).toHaveLength(0);
  });

  it("rejects percent-encoded traversal, which upstream decodes before checking", () => {
    for (const template of ["/%2e%2e/%2e%2e/etc", "/a/%2E%2E/b", "/x/..%2Fy"]) {
      const outcome = settle({ routeTemplate: template });
      expect(outcome.kind, template).toBe("rejected");
    }
    expect(store.list({}).resources).toHaveLength(0);
  });

  it("rejects scheme injection", () => {
    expect(settle({ routeTemplate: "/a/https://evil.example/b" }).kind).toBe("rejected");
    expect(settle({ routeTemplate: "not-absolute" }).kind).toBe("rejected");
  });
});

// ---------------------------------------------------------------- 5
describe("idempotency", () => {
  it("a repeated callback for the same settlement is a no-op", () => {
    const first = settle({}, { tx: "same-tx" });
    expect(first.kind).toBe("cataloged");

    const second = settle({}, { tx: "same-tx", now: at("2026-08-12T09:00:00.000Z") });
    expect(second.kind).toBe("noop");
    expect(second.status).toBe("success");

    const page = store.list({});
    expect(page.resources).toHaveLength(1);
    // Provenance untouched: a replay is not a new sighting.
    expect(page.resources[0]!.lastSeenAt).toBe("2026-08-12T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------- 6
describe("same seller updates the same canonical listing", () => {
  it("updates in place, preserving firstSeenAt and advancing lastSeenAt", () => {
    settle({ serviceName: "Weather v1" }, { tx: "tx-1" });
    const outcome = settle(
      { serviceName: "Weather v2" },
      { tx: "tx-2", now: at("2026-08-13T00:00:00.000Z") },
    );

    if (outcome.kind !== "cataloged") throw new Error("expected cataloged");
    expect(outcome.created).toBe(false);

    const page = store.list({});
    expect(page.resources).toHaveLength(1);
    expect(page.resources[0]!.serviceName).toBe("Weather v2");
    expect(page.resources[0]!.firstSeenAt).toBe("2026-08-12T00:00:00.000Z");
    expect(page.resources[0]!.lastSeenAt).toBe("2026-08-13T00:00:00.000Z");
    expect(page.resources[0]!.lastSettlementTx).toBe("tx-2");
  });
});

// ---------------------------------------------------------------- 7
describe("cross-seller overwrite", () => {
  it("rejects a different payment recipient claiming an existing canonical key", () => {
    settle({ serviceName: "B real" }, { reqs: requirements({ payTo: SELLER_B }), tx: "tx-b" });

    const attack = settle(
      { serviceName: "A fake" },
      { reqs: requirements({ payTo: SELLER_A }), tx: "tx-a" },
    );

    expect(attack.kind).toBe("rejected");
    if (attack.kind !== "rejected") return;
    expect(attack.code).toBe("OWNERSHIP_CONFLICT");

    const listing = store.get("https://seller-a.example/weather")!;
    expect(listing.ownerPayTo).toBe(SELLER_B);
    expect(listing.serviceName).toBe("B real");
    expect(listing.lastSettlementTx).toBe("tx-b");
  });

  it("is not bypassable by spelling the URL differently", () => {
    settle({ url: "https://seller-a.example/weather" }, { reqs: requirements({ payTo: SELLER_B }) });

    for (const url of [
      "https://SELLER-A.example/weather",
      "https://seller-a.example:443/weather",
      "https://seller-a.example/weather/",
    ]) {
      const attack = settle({ url }, { reqs: requirements({ payTo: SELLER_A }), tx: "tx-x" });
      expect(attack.kind, url).toBe("rejected");
    }
    expect(store.list({}).resources).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- 11
describe("metadata sanitization follows upstream", () => {
  it("drops an over-long serviceName while keeping the listing", () => {
    const outcome = settle({ serviceName: "x".repeat(33) });
    if (outcome.kind !== "cataloged") throw new Error("expected cataloged");
    expect(outcome.listing.serviceName).toBeUndefined();
  });

  it("keeps a valid serviceName and tags", () => {
    const outcome = settle({ serviceName: "Weather API", tags: ["weather", "forecast"] });
    if (outcome.kind !== "cataloged") throw new Error("expected cataloged");
    expect(outcome.listing.serviceName).toBe("Weather API");
    expect(outcome.listing.tags).toEqual(["weather", "forecast"]);
  });

  it("drops a loopback iconUrl (upstream SSRF defence) without failing the listing", () => {
    const outcome = settle({ iconUrl: "http://localhost/icon.png" });
    if (outcome.kind !== "cataloged") throw new Error("expected cataloged");
    expect(outcome.listing.iconUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------- 13
describe("catalog failure cannot falsify a settlement", () => {
  it("returns CATALOG_WRITE_FAILED instead of throwing when the store is broken", () => {
    const broken: CatalogStore = {
      upsert() {
        throw new Error("disk on fire");
      },
      get: () => undefined,
      list: () => ({ resources: [], pagination: { limit: 20, offset: 0, total: 0 } }),
      close: () => {},
    };

    const reqs = requirements();
    const outcome = catalogSettlement(broken, {
      paymentPayload: payload({}, reqs),
      paymentRequirements: reqs,
      transaction: "tx-1",
    });

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "rejected") return;
    expect(outcome.code).toBe("CATALOG_WRITE_FAILED");
    expect(outcome.message).toContain("disk on fire");
  });

  it("never throws for any malformed input", () => {
    const reqs = requirements();
    for (const bad of [null, 42, "string", [], { info: null }]) {
      expect(() =>
        catalogSettlement(store, {
          paymentPayload: payload({ extension: bad }, reqs),
          paymentRequirements: reqs,
          transaction: "tx",
        }),
      ).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------- 8
describe("persistence across restart", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "catalog-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the listing from a freshly opened store on the same file", () => {
    const path = join(dir, "catalog.db");
    const reqs = requirements();

    const before = new SqliteCatalogStore(path);
    catalogSettlement(before, {
      paymentPayload: payload({ serviceName: "Durable" }, reqs),
      paymentRequirements: reqs,
      transaction: "tx-1",
      now: at("2026-08-12T00:00:00.000Z"),
    });
    before.close();

    const after = new SqliteCatalogStore(path);
    const page = after.list({});
    expect(page.resources).toHaveLength(1);
    expect(page.resources[0]!.serviceName).toBe("Durable");
    expect(page.resources[0]!.ownerPayTo).toBe(SELLER_A);
    after.close();
  });
});
