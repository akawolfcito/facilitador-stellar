/**
 * Regression: the exact wire shape the upstream Next e2e server emits.
 *
 * Captured from a real settle against our facilitator during an upstream
 * conformance run (`TRACE_SETTLE=1`), then pasted here verbatim. The Next
 * server routes through `app/api/[...segments]/route.ts`, a catch-all, and the
 * middleware derives `routeTemplate: ":var1"` from the dynamic segment — no
 * leading slash, so upstream's `isValidRouteTemplate` rejects it.
 *
 * We used to reject the whole listing on that, which silently cost us one
 * resource in the suite's Bazaar discovery validation (4/5) while every payment
 * passed. Upstream soft-drops the template and keys on the URL pathname; so do
 * we now.
 */

import { describe, expect, it } from "vitest";
import { catalogSettlement, encodeExtensionResponses } from "../src/catalog.js";
import { SqliteCatalogStore } from "../src/store.js";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { SELLER_A, requirements } from "./helpers.js";

/** Verbatim from the traced settle body. */
const NEXT_BAZAAR_EXTENSION = {
  info: {
    input: { type: "http", queryParams: {}, method: "GET", pathParams: {} },
    output: {
      type: "json",
      example: {
        message: "Protected endpoint accessed successfully",
        timestamp: "2024-01-01T00:00:00Z",
      },
    },
  },
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      input: {
        type: "object",
        properties: {
          type: { type: "string", const: "http" },
          method: { type: "string", enum: ["GET"] },
          queryParams: { type: "object", properties: {} },
          pathParams: { type: "object" },
        },
        required: ["type", "method"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          type: { type: "string" },
          example: {
            type: "object",
            properties: { message: { type: "string" }, timestamp: { type: "string" } },
            required: ["message", "timestamp"],
          },
        },
        required: ["type"],
      },
    },
    required: ["input"],
  },
  // The offending field: a bare `:var1`, no leading slash.
  routeTemplate: ":var1",
};

const NEXT_URL = "http://localhost:4025/api/exact/stellar/withx402";

function nextPayload(reqs: PaymentRequirements): PaymentPayload {
  return {
    x402Version: 2,
    resource: { url: NEXT_URL, description: "", mimeType: "" },
    accepted: reqs,
    payload: { transaction: "AAAA" },
    extensions: { bazaar: NEXT_BAZAAR_EXTENSION },
  };
}

describe("upstream Next server wire shape", () => {
  it("catalogs the resource despite an invalid routeTemplate", () => {
    const store = new SqliteCatalogStore(":memory:");
    const reqs = requirements();

    const outcome = catalogSettlement(store, {
      paymentPayload: nextPayload(reqs),
      paymentRequirements: reqs,
      transaction: "tx-next",
    });

    expect(outcome.kind).toBe("cataloged");
    if (outcome.kind !== "cataloged") return;

    // Keyed on the pathname the buyer actually paid against, which is what the
    // suite's discovery validator looks for.
    expect(outcome.listing.canonicalKey).toBe(NEXT_URL);
    expect(outcome.listing.resource).toBe(NEXT_URL);
    // The bad template is dropped, never stored.
    expect(outcome.listing.routeTemplate).toBeUndefined();
    expect(outcome.droppedRouteTemplate).toBe(true);
    expect(outcome.listing.ownerPayTo).toBe(SELLER_A);

    expect(store.get(NEXT_URL)).toBeDefined();
    store.close();
  });

  it("still reports success on the wire, because the resource was cataloged", () => {
    const store = new SqliteCatalogStore(":memory:");
    const reqs = requirements();
    const outcome = catalogSettlement(store, {
      paymentPayload: nextPayload(reqs),
      paymentRequirements: reqs,
      transaction: "tx-next",
    });

    const decoded = JSON.parse(
      Buffer.from(encodeExtensionResponses(outcome)!, "base64").toString("utf8"),
    );
    expect(decoded.bazaar.status).toBe("success");
    store.close();
  });

  it("a valid routeTemplate is still honoured", () => {
    const store = new SqliteCatalogStore(":memory:");
    const reqs = requirements();
    const payload = nextPayload(reqs);
    payload.extensions = {
      bazaar: { ...NEXT_BAZAAR_EXTENSION, routeTemplate: "/api/:country/:city" },
    };

    const outcome = catalogSettlement(store, {
      paymentPayload: payload,
      paymentRequirements: reqs,
      transaction: "tx-valid",
    });

    expect(outcome.kind).toBe("cataloged");
    if (outcome.kind !== "cataloged") return;
    expect(outcome.listing.canonicalKey).toBe("http://localhost:4025/api/:country/:city");
    expect(outcome.listing.routeTemplate).toBe("/api/:country/:city");
    expect(outcome.droppedRouteTemplate).toBeUndefined();
    store.close();
  });

  it("a hostile template is dropped, never honoured, and never re-keys the listing", () => {
    // Dropping is not laxity: the fallback is the URL the payment was made
    // against, so traversal and scheme-injection attempts cannot move a listing
    // onto a key the seller never served.
    for (const template of ["/../../etc/passwd", "/%2e%2e/x", "/a/https://evil.example/b"]) {
      const store = new SqliteCatalogStore(":memory:");
      const reqs = requirements();
      const payload = nextPayload(reqs);
      payload.extensions = { bazaar: { ...NEXT_BAZAAR_EXTENSION, routeTemplate: template } };

      const outcome = catalogSettlement(store, {
        paymentPayload: payload,
        paymentRequirements: reqs,
        transaction: "tx-hostile",
      });

      expect(outcome.kind, template).toBe("cataloged");
      if (outcome.kind !== "cataloged") continue;
      expect(outcome.listing.canonicalKey, template).toBe(NEXT_URL);
      expect(outcome.listing.routeTemplate, template).toBeUndefined();
      expect(outcome.droppedRouteTemplate, template).toBe(true);
      store.close();
    }
  });
});
