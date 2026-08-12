import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogSettlement } from "../src/catalog.js";
import { SqliteCatalogStore } from "../src/store.js";
import type { Network } from "@x402/core/types";
import { SELLER_A, SELLER_B, payload, requirements } from "./helpers.js";

let store: SqliteCatalogStore;

/** Seed n listings with distinct URLs, sellers and networks. */
function seed(): void {
  const rows: Array<{ url: string; payTo: string; network: Network }> = [
    { url: "https://a.example/one", payTo: SELLER_A, network: "stellar:testnet" },
    { url: "https://a.example/two", payTo: SELLER_A, network: "stellar:testnet" },
    { url: "https://b.example/three", payTo: SELLER_B, network: "stellar:testnet" },
    { url: "https://b.example/four", payTo: SELLER_B, network: "stellar:pubnet" },
    { url: "https://c.example/five", payTo: SELLER_A, network: "stellar:pubnet" },
  ];
  rows.forEach((row, i) => {
    const reqs = requirements({ payTo: row.payTo, network: row.network });
    catalogSettlement(store, {
      paymentPayload: payload({ url: row.url }, reqs),
      paymentRequirements: reqs,
      transaction: `tx-${i}`,
      // Distinct, increasing timestamps so the ordering contract is observable.
      now: () => new Date(Date.UTC(2026, 7, 12, 0, 0, i)),
    });
  });
}

beforeEach(() => {
  store = new SqliteCatalogStore(":memory:");
  seed();
});
afterEach(() => {
  store.close();
});

// ---------------------------------------------------------------- 9
describe("filters", () => {
  it("returns everything with no filter", () => {
    const page = store.list({});
    expect(page.resources).toHaveLength(5);
    expect(page.pagination.total).toBe(5);
  });

  it("filters by type", () => {
    expect(store.list({ type: "http" }).resources).toHaveLength(5);
    expect(store.list({ type: "mcp" }).resources).toHaveLength(0);
  });

  it("filters by payTo", () => {
    expect(store.list({ payTo: SELLER_A }).resources).toHaveLength(3);
    expect(store.list({ payTo: SELLER_B }).resources).toHaveLength(2);
  });

  it("filters by network", () => {
    expect(store.list({ network: "stellar:testnet" }).resources).toHaveLength(3);
    expect(store.list({ network: "stellar:pubnet" }).resources).toHaveLength(2);
  });

  it("filters by scheme", () => {
    expect(store.list({ scheme: "exact" }).resources).toHaveLength(5);
    expect(store.list({ scheme: "upto" }).resources).toHaveLength(0);
  });

  it("filters by extension key presence", () => {
    expect(store.list({ extensions: ["bazaar"] }).resources).toHaveLength(5);
    expect(store.list({ extensions: ["builder-code"] }).resources).toHaveLength(0);
    expect(store.list({ extensions: ["bazaar", "builder-code"] }).resources).toHaveLength(0);
  });

  it("combines filters conjunctively", () => {
    const page = store.list({ payTo: SELLER_A, network: "stellar:testnet" });
    expect(page.resources).toHaveLength(2);
    expect(page.pagination.total).toBe(2);
  });

  it("reports total independently of the page size", () => {
    const page = store.list({ limit: 1 });
    expect(page.resources).toHaveLength(1);
    expect(page.pagination.total).toBe(5);
  });
});

// ---------------------------------------------------------------- 10
describe("pagination", () => {
  it("is deterministic: paging through yields every listing exactly once", () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 5; offset += 2) {
      seen.push(...store.list({ limit: 2, offset }).resources.map((r) => r.canonicalKey));
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("orders by firstSeenAt then canonicalKey, stably across repeated calls", () => {
    const once = store.list({}).resources.map((r) => r.canonicalKey);
    const twice = store.list({}).resources.map((r) => r.canonicalKey);
    expect(once).toEqual(twice);
    expect(once).toEqual([
      "https://a.example/one",
      "https://a.example/two",
      "https://b.example/three",
      "https://b.example/four",
      "https://c.example/five",
    ]);
  });

  it("breaks firstSeenAt ties on canonicalKey", () => {
    const tied = new SqliteCatalogStore(":memory:");
    const stamp = () => new Date("2026-08-12T00:00:00.000Z");
    for (const url of ["https://z.example/z", "https://a.example/a", "https://m.example/m"]) {
      const reqs = requirements();
      catalogSettlement(tied, {
        paymentPayload: payload({ url }, reqs),
        paymentRequirements: reqs,
        transaction: `tx-${url}`,
        now: stamp,
      });
    }
    expect(tied.list({}).resources.map((r) => r.canonicalKey)).toEqual([
      "https://a.example/a",
      "https://m.example/m",
      "https://z.example/z",
    ]);
    tied.close();
  });

  it("clamps limit into range and floors a negative offset", () => {
    expect(store.list({ limit: 0 }).pagination.limit).toBe(1);
    expect(store.list({ limit: 9999 }).pagination.limit).toBe(100);
    expect(store.list({ offset: -5 }).pagination.offset).toBe(0);
  });

  it("returns an empty page past the end without error", () => {
    const page = store.list({ offset: 500 });
    expect(page.resources).toHaveLength(0);
    expect(page.pagination.total).toBe(5);
  });
});
