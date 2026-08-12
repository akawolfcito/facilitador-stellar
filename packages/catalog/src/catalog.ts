/**
 * Automatic cataloging: turn one successful settlement into one listing.
 *
 * Every validation step delegates to `@x402/extensions@2.22.0` — we call
 * `validateDiscoveryExtensionSpec`, `validateDiscoveryExtension`,
 * `isValidRouteTemplate` and `extractDiscoveryInfo`, and none of that logic is
 * reimplemented here. `extractDiscoveryInfo` internally applies
 * `sanitizeResourceServiceMetadata`, which is what runs `isValidServiceName`,
 * `sanitizeTags` and `isValidIconUrl` (including their SSRF defences) over the
 * client-controlled resource block.
 *
 * What this module owns is the part upstream leaves to the facilitator: the
 * canonical key, the ownership binding, persistence, and the outcome that
 * becomes the `EXTENSION-RESPONSES` header.
 *
 * Ordering matters. This runs *after* settlement, on a result that is already
 * final. Nothing here can change a `SettleResponse`, which is how invariant I2
 * holds: a valid payment with unusable discovery metadata still settles.
 */

import {
  BAZAAR,
  extractDiscoveryInfo,
  isValidRouteTemplate,
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
  type DiscoveryExtension,
} from "@x402/extensions/bazaar";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { httpCanonicalKey, mcpCanonicalKey } from "./canonical.js";
import { METADATA_VERSION } from "./store.js";
import type {
  CatalogListing,
  CatalogOutcome,
  CatalogRejectionCode,
  CatalogStore,
} from "./types.js";

export interface CatalogSettlementInput {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  /** Hash of the settlement that triggered this. Provenance and replay key. */
  transaction: string;
  /** Injected for deterministic tests. */
  now?: () => Date;
}

function reject(code: CatalogRejectionCode, message: string): CatalogOutcome {
  return { kind: "rejected", status: "rejected", code, message };
}

/**
 * Catalog a settled payment.
 *
 * @returns the outcome to report via `EXTENSION-RESPONSES`. Never throws: a
 *   catalog failure must not propagate into the settlement response path.
 */
export function catalogSettlement(
  store: CatalogStore,
  input: CatalogSettlementInput,
): CatalogOutcome {
  const { paymentPayload, paymentRequirements, transaction } = input;
  const now = (input.now ?? (() => new Date()))().toISOString();

  try {
    const raw = paymentPayload.extensions?.[BAZAAR.key];
    if (!raw || typeof raw !== "object") {
      return { kind: "skipped", status: null, reason: "no-bazaar-extension" };
    }

    // 1. Structural shape, then JSON Schema validation of `info` against the
    //    client-supplied `schema`. Upstream's ajv guard rejects external
    //    $ref/$id, so a hostile schema cannot turn this into an SSRF.
    const specResult = validateDiscoveryExtensionSpec(raw as Record<string, unknown>);
    if (!specResult.valid) {
      return reject("INVALID_SCHEMA", specResult.errors?.join("; ") ?? "extension failed spec validation");
    }
    const schemaResult = validateDiscoveryExtension(raw as DiscoveryExtension);
    if (!schemaResult.valid) {
      return reject("INVALID_SCHEMA", schemaResult.errors?.join("; ") ?? "info failed schema validation");
    }

    // 2. routeTemplate is client-controlled and becomes part of the canonical
    //    key. Upstream soft-drops an invalid one and falls back to the URL
    //    pathname; we reject the listing instead. Silently re-keying a resource
    //    to a path the seller did not declare is a worse outcome than not
    //    listing it — see docs/security/catalog-ownership-model.md §4.6. This
    //    is a deliberate divergence from upstream's soft-drop, and it is
    //    stricter, never more permissive.
    const declaredTemplate = (raw as Record<string, unknown>).routeTemplate;
    if (declaredTemplate !== undefined && !isValidRouteTemplate(declaredTemplate as string)) {
      return reject(
        "INVALID_ROUTE_TEMPLATE",
        "routeTemplate failed validation (must start with '/', no traversal or scheme injection after percent-decoding)",
      );
    }

    // 3. Upstream extraction. Also applies service-metadata sanitisation.
    const discovered = extractDiscoveryInfo(paymentPayload, paymentRequirements);
    if (!discovered) {
      return reject("INVALID_METADATA", "discovery info could not be extracted from the payload");
    }

    const info = discovered.discoveryInfo as { input?: { type?: string; toolName?: string } };
    const type = info.input?.type === "mcp" ? "mcp" : "http";

    // 4. Canonical key. MCP is keyed on (resource.url, toolName) and is built
    //    from the raw payload URL, because upstream's `resourceUrl` is wrong
    //    for `mcp:` schemes (issue #3121). MCP is not served yet; the key space
    //    is correct so it will be when it is.
    let canonicalKey: string;
    let toolName: string | undefined;
    if (type === "mcp") {
      toolName = info.input?.toolName;
      if (!toolName) return reject("INVALID_METADATA", "mcp discovery info is missing input.toolName");
      const rawUrl = paymentPayload.resource?.url;
      if (!rawUrl) return reject("INVALID_METADATA", "payload is missing resource.url");
      canonicalKey = mcpCanonicalKey(rawUrl, toolName);
    } else {
      canonicalKey = httpCanonicalKey(discovered.resourceUrl);
    }

    // 5. Settled facts come from the requirements the facilitator validated and
    //    the ledger enforced — never from the discovery metadata (invariant I4).
    const listing: CatalogListing = {
      canonicalKey,
      type,
      resource: type === "mcp" ? paymentPayload.resource!.url : discovered.resourceUrl,
      ...(("routeTemplate" in discovered && discovered.routeTemplate)
        ? { routeTemplate: discovered.routeTemplate }
        : {}),
      ...(("method" in discovered && discovered.method) ? { method: discovered.method } : {}),
      ...(toolName ? { toolName } : {}),

      ...(discovered.serviceName ? { serviceName: discovered.serviceName } : {}),
      ...(discovered.description ? { description: discovered.description } : {}),
      ...(discovered.tags ? { tags: discovered.tags } : {}),
      ...(discovered.iconUrl ? { iconUrl: discovered.iconUrl } : {}),
      ...(discovered.mimeType ? { mimeType: discovered.mimeType } : {}),
      discoveryInfo: discovered.discoveryInfo,
      ...(discovered.extensions ? { extensions: discovered.extensions } : {}),

      payTo: paymentRequirements.payTo,
      network: paymentRequirements.network,
      scheme: paymentRequirements.scheme,
      asset: paymentRequirements.asset,
      amount: paymentRequirements.amount,
      x402Version: paymentPayload.x402Version,

      ownerPayTo: paymentRequirements.payTo,
      ownershipBinding: "tofu",

      firstSeenAt: now,
      lastSeenAt: now,
      lastSettlementTx: transaction,
      metadataVersion: METADATA_VERSION,
    };

    return store.upsert(listing);
  } catch (error) {
    // A dead database, a malformed URL that slipped through, anything: the
    // payment has already settled and stays settled.
    return reject(
      "CATALOG_WRITE_FAILED",
      error instanceof Error ? error.message : "unknown catalog error",
    );
  }
}

/**
 * Encode the `EXTENSION-RESPONSES` header value for an outcome.
 *
 * Wire shape per specs/extensions/bazaar.md §"Verify and Settlement Response
 * Header": base64 of a JSON object keyed by extension name, with
 * `bazaar.status` and, when rejected, `bazaar.rejectedReason`.
 *
 * The reason is emitted as `CODE: sentence` so it is greppable by a machine and
 * still the human-readable string the spec asks for. A rejection is never
 * emitted without one (RFP §3.3).
 *
 * @returns the header value, or undefined when there is nothing to report.
 */
export function encodeExtensionResponses(outcome: CatalogOutcome): string | undefined {
  if (outcome.kind === "skipped") return undefined;

  const bazaar =
    outcome.kind === "rejected"
      ? { status: "rejected" as const, rejectedReason: `${outcome.code}: ${outcome.message}` }
      : { status: "success" as const };

  return Buffer.from(JSON.stringify({ bazaar }), "utf8").toString("base64");
}
