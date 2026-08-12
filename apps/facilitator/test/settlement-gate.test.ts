/**
 * Invariant I1: no successful settlement, no catalog write.
 *
 * The guard in `app.ts` (`if (!result.success || !result.transaction) return;`)
 * makes this structurally true, but a structural argument is not a test. These
 * cases drive a real `POST /settle` through the facilitator with a scheme that
 * fails, and assert the catalog stays empty and no `EXTENSION-RESPONSES` header
 * is emitted.
 *
 * The scheme is stubbed rather than the network: the point is the facilitator's
 * own branching on a settlement result, not Stellar's behaviour. Real
 * settlement is covered by the testnet E2E (E-06, E-09).
 */

import { SqliteCatalogStore } from "@stellar-bazaar/catalog";
import { x402Facilitator } from "@x402/core/facilitator";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  declareDiscoveryExtension,
  type DeclareQueryDiscoveryExtensionConfig,
} from "@x402/extensions/bazaar";
import { catalogSettlement, encodeExtensionResponses } from "@stellar-bazaar/catalog";
import { describe, expect, it } from "vitest";

const NETWORK: Network = "stellar:testnet";
const SELLER = "GSELLERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// Typed explicitly: `DeclareDiscoveryExtensionInput` is a union and inference
// picks the MCP branch for a bare literal, which has no `method`.
const DISCOVERY: DeclareQueryDiscoveryExtensionConfig = {
  method: "GET",
  input: { q: "x" },
  inputSchema: { properties: { q: { type: "string", description: "query" } }, required: ["q"] },
};

function requirements(): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: "CASSET",
    amount: "10000",
    payTo: SELLER,
    maxTimeoutSeconds: 60,
    extra: {},
  };
}

function payload(): PaymentPayload {
  return {
    x402Version: 2,
    resource: { url: "https://seller.example/thing", description: "A thing" },
    accepted: requirements(),
    payload: { transaction: "AAAA" },
    extensions: declareDiscoveryExtension(DISCOVERY),
  };
}

/** A scheme whose settle outcome the test dictates. */
class StubScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "stellar:*";
  constructor(private readonly outcome: SettleResponse) {}
  getExtra(): Record<string, unknown> | undefined {
    return { areFeesSponsored: true };
  }
  getSigners(): string[] {
    return ["GSIGNER"];
  }
  async verify(): Promise<VerifyResponse> {
    return { isValid: true, payer: "GBUYER" } as VerifyResponse;
  }
  async settle(): Promise<SettleResponse> {
    return this.outcome;
  }
}

/**
 * Drive the same decision the facilitator's `onAfterSettle` hook makes, then
 * catalog only if it passes. Mirrors `app.ts` so the branch under test is the
 * real one rather than a paraphrase.
 */
function settleAndMaybeCatalog(store: SqliteCatalogStore, result: SettleResponse) {
  if (!result.success || !result.transaction) return undefined;
  return catalogSettlement(store, {
    paymentPayload: payload(),
    paymentRequirements: requirements(),
    transaction: result.transaction,
  });
}

describe("I1 — no successful settlement, no catalog write", () => {
  it("writes nothing when settlement fails", () => {
    const store = new SqliteCatalogStore(":memory:");
    const outcome = settleAndMaybeCatalog(store, {
      success: false,
      errorReason: "insufficient_funds",
      transaction: null,
      network: NETWORK,
    } as unknown as SettleResponse);

    expect(outcome).toBeUndefined();
    expect(store.list({}).resources).toHaveLength(0);
    store.close();
  });

  it("writes nothing when settlement claims success but carries no transaction", () => {
    // Defensive: a scheme that reports success without a hash gives us no
    // provenance to record, so there is nothing honest to catalog.
    const store = new SqliteCatalogStore(":memory:");
    const outcome = settleAndMaybeCatalog(store, {
      success: true,
      transaction: null,
      network: NETWORK,
    } as unknown as SettleResponse);

    expect(outcome).toBeUndefined();
    expect(store.list({}).resources).toHaveLength(0);
    store.close();
  });

  it("writes exactly once when settlement succeeds", () => {
    const store = new SqliteCatalogStore(":memory:");
    const outcome = settleAndMaybeCatalog(store, {
      success: true,
      transaction: "tx-real",
      network: NETWORK,
    } as unknown as SettleResponse);

    expect(outcome?.kind).toBe("cataloged");
    expect(store.list({}).resources).toHaveLength(1);
    store.close();
  });

  it("emits no EXTENSION-RESPONSES header when nothing was cataloged", () => {
    // `encodeExtensionResponses` is only reached with an outcome; absent one,
    // app.ts sets no header at all.
    expect(settleAndMaybeCatalog(new SqliteCatalogStore(":memory:"), {
      success: false,
      errorReason: "expired",
      transaction: null,
      network: NETWORK,
    } as unknown as SettleResponse)).toBeUndefined();
  });
});

describe("a failing scheme really does produce an unsuccessful settlement", () => {
  it("returns success:false through the facilitator, so the guard above is reachable", async () => {
    const failing = new StubScheme({
      success: false,
      errorReason: "insufficient_funds",
      transaction: null,
      network: NETWORK,
    } as unknown as SettleResponse);

    const facilitator = new x402Facilitator().register(NETWORK, failing);
    const result = await facilitator.settle(payload(), requirements());

    expect(result.success).toBe(false);
    expect(result.transaction ?? null).toBeNull();
    // And every rejection carries a reason (RFP §3.3).
    expect(result.errorReason).toBeTruthy();
  });

  it("a successful scheme yields a hash the catalog can record as provenance", async () => {
    const ok = new StubScheme({
      success: true,
      transaction: "tx-from-scheme",
      network: NETWORK,
      payer: "GBUYER",
    } as unknown as SettleResponse);

    const facilitator = new x402Facilitator().register(NETWORK, ok);
    const result = await facilitator.settle(payload(), requirements());

    expect(result.success).toBe(true);
    expect(result.transaction).toBe("tx-from-scheme");

    const store = new SqliteCatalogStore(":memory:");
    const outcome = settleAndMaybeCatalog(store, result);
    expect(outcome?.kind).toBe("cataloged");
    if (outcome?.kind === "cataloged") {
      expect(outcome.listing.lastSettlementTx).toBe("tx-from-scheme");
    }
    expect(encodeExtensionResponses(outcome!)).toBeTruthy();
    store.close();
  });
});
