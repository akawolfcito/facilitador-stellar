/**
 * The payment plane.
 *
 * Deliberately thin. Verification and settlement belong to `@x402/stellar`
 * (Apache-2.0) as RFP §3.1 requires — this file wires that scheme into the
 * standard `verify` / `settle` / `supported` surface and nothing more. The
 * value we add lives in the discovery plane, which attaches through the
 * facilitator's own `onAfterSettle` hook rather than by forking anything.
 *
 * Not derived from the OpenZeppelin Relayer x402 plugin, which is
 * AGPL-3.0-or-later and is excluded by RFP §3.6 and its Appendix.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  SqliteCatalogStore,
  catalogSettlement,
  encodeExtensionResponses,
  type CatalogOutcome,
  type CatalogStore,
  type DiscoveryQuery,
  type ResourceType,
} from "@stellar-bazaar/catalog";
import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import { createEd25519Signer } from "@x402/stellar";
import Fastify, { type FastifyInstance } from "fastify";
import type { FacilitatorConfig } from "./config.js";

/** Body shared by `/verify` and `/settle`. */
interface FacilitatorRequestBody {
  paymentPayload?: PaymentPayload;
  paymentRequirements?: PaymentRequirements;
}

export interface BuiltFacilitator {
  app: FastifyInstance;
  facilitator: x402Facilitator;
  /** Addresses of the fee-sponsoring signers, for the health endpoint. */
  signerAddresses: string[];
  catalog: CatalogStore;
}

/**
 * Per-request slot for the cataloging outcome.
 *
 * `onAfterSettle` is the upstream extension point for reacting to a settled
 * payment, but its signature returns void — it cannot hand a value back to the
 * HTTP layer that has to emit the `EXTENSION-RESPONSES` header. An
 * AsyncLocalStorage slot carries it across that gap and stays correct under
 * concurrent requests, which a module-level variable would not.
 */
const catalogSlot = new AsyncLocalStorage<{ outcome?: CatalogOutcome }>();

/** Parse `?extensions=a,b` or repeated `?extensions=a&extensions=b`. */
function parseExtensions(raw: unknown): string[] | undefined {
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const keys = values
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return keys.length > 0 ? keys : undefined;
}

function parseIntOr(raw: unknown, fallback: number | undefined): number | undefined {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) ? n : fallback;
}

/**
 * Wire the Stellar exact scheme into a facilitator and expose it over HTTP.
 *
 * Multiple signers are passed straight through to `ExactStellarScheme`, which
 * round-robins between them. That is the answer to RFP §3.5's throughput
 * question: distinct source accounts mean bursty agent traffic does not
 * serialise behind one account's sequence number.
 */
export function buildFacilitator(
  config: FacilitatorConfig,
  /** Injectable for tests; defaults to SQLite at `config.catalogPath`. */
  store?: CatalogStore,
): BuiltFacilitator {
  const signers = config.signerSecrets.map((secret) =>
    createEd25519Signer(secret, config.network),
  );

  const scheme = new ExactStellarScheme(signers, {
    rpcConfig: { url: config.rpcUrl },
    areFeesSponsored: config.areFeesSponsored,
  });

  const catalog: CatalogStore = store ?? new SqliteCatalogStore(config.catalogPath);

  /**
   * Automatic cataloging (RFP §3.2): a resource is listed because a payment for
   * it settled, with no separate registration step.
   *
   * This runs after settlement, on a result that is already final, so nothing
   * it does can change the `SettleResponse`. `catalogSettlement` never throws.
   */
  const facilitator = new x402Facilitator()
    .register(config.network, scheme)
    .onAfterSettle(async ({ paymentPayload, requirements, result }) => {
      if (!result.success || !result.transaction) return;
      const outcome = catalogSettlement(catalog, {
        paymentPayload,
        paymentRequirements: requirements,
        transaction: result.transaction,
      });
      const slot = catalogSlot.getStore();
      if (slot) slot.outcome = outcome;
    });

  const app = Fastify({ logger: false, genReqId: () => crypto.randomUUID() });

  app.get("/health", async () => ({
    status: "ok",
    network: config.network,
    rpcUrl: config.rpcUrl,
    signers: signers.length,
    catalog: catalog.list({ limit: 1 }).pagination.total,
  }));

  /**
   * RFP §3.6 makes this endpoint an acceptance criterion: it must emit the
   * Stellar `extra` contract including `areFeesSponsored`. `getSupported()`
   * derives that from the scheme's own `getExtra`, so it cannot drift from what
   * settlement actually does.
   */
  app.get("/supported", async () => facilitator.getSupported());

  app.post<{ Body: FacilitatorRequestBody }>("/verify", async (request, reply) => {
    const { paymentPayload, paymentRequirements } = request.body ?? {};
    if (!paymentPayload || !paymentRequirements) {
      // Every rejection carries a non-null reason (RFP §3.3, §3.6).
      return reply
        .code(400)
        .send({ isValid: false, invalidReason: "invalid_request_body", payer: null });
    }
    return facilitator.verify(paymentPayload, paymentRequirements);
  });

  app.post<{ Body: FacilitatorRequestBody }>("/settle", async (request, reply) => {
    const { paymentPayload, paymentRequirements } = request.body ?? {};
    if (!paymentPayload || !paymentRequirements) {
      return reply
        .code(400)
        .send({ success: false, errorReason: "invalid_request_body", transaction: null });
    }

    const slot: { outcome?: CatalogOutcome } = {};
    const result = await catalogSlot.run(slot, () =>
      facilitator.settle(paymentPayload, paymentRequirements),
    );

    // Cataloging outcome rides the header; the settlement body is untouched
    // whether the listing landed, was rejected, or the store was on fire.
    if (slot.outcome) {
      const header = encodeExtensionResponses(slot.outcome);
      if (header) reply.header("EXTENSION-RESPONSES", header);
    }
    return result;
  });

  /**
   * `GET /discovery/resources` — paginated catalog browsing.
   *
   * Filters are the spec's: `type`, `payTo`, `network`, `scheme`, `extensions`,
   * `limit`, `offset` (specs/extensions/bazaar.md §"Optional Discovery
   * Endpoints").
   *
   * Ordering is `firstSeenAt ASC, canonicalKey ASC` — total and deterministic,
   * so paging cannot skip or repeat a listing between requests.
   *
   * `ownerPayTo` and `ownershipBinding` are exposed on every listing rather
   * than hidden: the binding is trust-on-first-use and a consuming agent is
   * entitled to know that. See docs/security/catalog-ownership-model.md §5.
   */
  app.get("/discovery/resources", async (request, reply) => {
    const q = request.query as Record<string, unknown>;
    const type = q.type === "http" || q.type === "mcp" ? (q.type as ResourceType) : undefined;

    if (q.type !== undefined && type === undefined) {
      return reply.code(400).send({ error: "type must be 'http' or 'mcp'" });
    }

    const query: DiscoveryQuery = {
      ...(type ? { type } : {}),
      ...(q.payTo ? { payTo: String(q.payTo) } : {}),
      ...(q.network ? { network: String(q.network) } : {}),
      ...(q.scheme ? { scheme: String(q.scheme) } : {}),
      ...(parseExtensions(q.extensions) ? { extensions: parseExtensions(q.extensions) } : {}),
      ...(parseIntOr(q.limit, undefined) !== undefined
        ? { limit: parseIntOr(q.limit, undefined) }
        : {}),
      ...(parseIntOr(q.offset, undefined) !== undefined
        ? { offset: parseIntOr(q.offset, undefined) }
        : {}),
    };

    return catalog.list(query);
  });

  app.addHook("onClose", async () => {
    catalog.close();
  });

  return { app, facilitator, signerAddresses: signers.map((s) => s.address), catalog };
}
