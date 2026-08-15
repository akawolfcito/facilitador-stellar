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
  toDiscoveryResourcesResponse,
  toDiscoverySearchResponse,
  type DiscoveryQuery,
  type ResourceType,
} from "@stellar-bazaar/catalog";
import { SearchEngine } from "@stellar-bazaar/search";
import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";
import { createEd25519Signer } from "@x402/stellar";
import Fastify, { type FastifyInstance } from "fastify";
import type { FacilitatorConfig } from "./config.js";
import {
  DEFAULT_RATE_POLICY,
  DEFAULT_SETTLE_MAX_INFLIGHT,
  InflightLimiter,
  RateLimiter,
  bucketFingerprint,
  classify,
  clientBucket,
} from "./limits.js";
import { Metrics, classifySettleError, readFeeCharged } from "./metrics.js";
import { timingSafeEqual } from "node:crypto";
import { rpc } from "@stellar/stellar-sdk";

/** Body shared by `/verify` and `/settle`. */
interface FacilitatorRequestBody {
  paymentPayload?: PaymentPayload;
  paymentRequirements?: PaymentRequirements;
}

/**
 * Whether the derived index can answer a query yet.
 *
 * `initializing` and `failed` both mean the same thing to a caller — we have not
 * looked — and that is deliberately not the same as abstaining, which means we
 * looked and found nothing worth paying for.
 */
export type DiscoveryStatus = "initializing" | "ready" | "failed";

export interface BuiltFacilitator {
  app: FastifyInstance;
  facilitator: x402Facilitator;
  /** Addresses of the fee-sponsoring signers, for the health endpoint. */
  signerAddresses: string[];
  catalog: CatalogStore;
  search: SearchEngine;
  /** Resolves when any in-flight background index sync has finished. */
  searchSettled(): Promise<void>;
  /**
   * Rebuild the derived index from the persisted catalog.
   *
   * The catalog survives a restart; the vectors are cached alongside it but
   * nothing loads them into the engine until this runs. Called once during
   * boot — see `startFacilitator`.
   */
  initializeSearch(): Promise<{ ok: true; indexed: number } | { ok: false; error: string }>;
  discoveryStatus(): DiscoveryStatus;
  /** Operational counters. Exposed for tests and the internal endpoint. */
  metrics: Metrics;
}

export interface StartedFacilitator extends BuiltFacilitator {
  /** Address the server actually bound to, useful when the port was 0. */
  address: string;
  stop(): Promise<void>;
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
   * The derived search index.
   *
   * `sync()` is called after every catalog write and once at startup, so the
   * index converges on the catalog rather than drifting from it. Vectors are
   * cached by document hash, so a payment-only update re-embeds nothing.
   */
  const search = new SearchEngine(catalog);

  /**
   * Background index maintenance, coalesced.
   *
   * At most one sync runs at a time; requests arriving during one set a flag so
   * exactly one more runs afterwards. A burst of settlements therefore costs two
   * syncs, not one per payment, and none of them delays a response.
   *
   * `syncSettled` lets tests await quiescence without exposing the scheduler.
   */
  let syncRunning = false;
  let syncQueued = false;
  let syncSettled: Promise<void> = Promise.resolve();

  function scheduleSearchSync(): void {
    if (syncRunning) {
      syncQueued = true;
      return;
    }
    syncRunning = true;
    syncSettled = (async () => {
      try {
        do {
          syncQueued = false;
          await search.sync();
        } while (syncQueued);
      } catch (error) {
        // A broken index degrades ranking. It must not affect settlement, which
        // completed before this was scheduled.
        console.error(JSON.stringify({ event: "search_sync_failed", error: String(error) }));
      } finally {
        syncRunning = false;
      }
    })();
  }

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

      if (outcome.kind === "rejected") {
        metrics.catalogWritesFailed += 1;
        metrics.reject(outcome.code === "OWNERSHIP_CONFLICT" ? "CATALOG_CONFLICT" : "UNKNOWN");
        console.warn(
          JSON.stringify({ event: "catalog_write_failed", reason: outcome.code }),
        );
      } else if (outcome.kind === "cataloged") {
        metrics.catalogWritesSucceeded += 1;
      }

      // Bring the derived index up to date — off the response path.
      //
      // This used to `await search.sync()` here, which put embedding work
      // (including a one-time ~90MB model load on a cold process) between a
      // completed settlement and the seller's `/settle` response. The catalog
      // write has already happened and the index is derived state, so making
      // the seller wait for it buys nothing and costs latency on every payment.
      //
      // Measured: with a cold model cache the isolated hono+fetch scenario
      // failed 8/13; with it warm, 2/10. Settlement latency was a contributing
      // factor, and none of it belonged here.
      if (outcome.kind === "cataloged") {
        scheduleSearchSync();
      }
    });

  /**
   * Readiness of the derived index.
   *
   * Starts `initializing`: the engine exists but holds no vectors, so every
   * listing would score 0 and the abstention policy would refuse everything.
   * Serving that as an abstention would be a lie, so discovery reports itself
   * unavailable until `initializeSearch()` has run.
   */
  let discoveryStatus: DiscoveryStatus = "initializing";
  let indexedCount = 0;
  let discoveryError: string | undefined;

  async function initializeSearch(): Promise<
    { ok: true; indexed: number } | { ok: false; error: string }
  > {
    try {
      const stats = await search.sync();
      indexedCount = stats.total;
      discoveryStatus = "ready";
      discoveryError = undefined;
      metrics.searchSyncSucceeded += 1;
      console.info(
        JSON.stringify({ event: "search_sync_succeeded", indexed: stats.total }),
      );
      return { ok: true, indexed: stats.total };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      discoveryStatus = "failed";
      discoveryError = message;
      metrics.searchSyncFailed += 1;
      console.error(JSON.stringify({ event: "search_sync_failed", error: message }));
      return { ok: false, error: message };
    }
  }

  // ---- observability ------------------------------------------------------
  const metrics = new Metrics();

  /**
   * Sponsored-fee bookkeeping, off the response path.
   *
   * The settlement has already been answered by the time this runs — the same
   * reason index maintenance moved off that path. A seller must not wait on our
   * accounting, and a lookup failure must degrade the number's completeness,
   * never the settlement.
   */
  function recordSponsoredFee(hash: string): void {
    void (async () => {
      const server = new rpc.Server(config.rpcUrl);
      const stroops = await readFeeCharged(server, hash);
      metrics.recordFee(stroops);
      if (stroops === undefined) {
        console.warn(JSON.stringify({ event: "fee_lookup_failed", transaction: hash }));
      }
    })();
  }

  // ---- public request controls -------------------------------------------
  const rateLimiter = new RateLimiter(config.rateLimits ?? DEFAULT_RATE_POLICY);
  const settleInflight = new InflightLimiter(
    config.settleMaxInflight ?? DEFAULT_SETTLE_MAX_INFLIGHT,
  );

  const app = Fastify({
    logger: false,
    genReqId: () => crypto.randomUUID(),
    // Only believe forwarding headers when told to. See `parseTrustProxy`.
    trustProxy: config.trustProxy ?? false,
    // Rejected by Fastify before the body is parsed and long before a handler
    // or a signer is reached.
    bodyLimit: config.bodyLimitBytes ?? 64 * 1024,
    requestTimeout: config.requestTimeoutMs ?? 15_000,
    keepAliveTimeout: config.keepAliveTimeoutMs ?? 30_000,
  });

  /** Rejections carry the class and a fingerprint, never the address or the body. */
  function logRejection(request: { id: string; url: string }, kind: string, bucket: string): void {
    console.warn(
      JSON.stringify({
        event: "request_rejected",
        kind,
        route: request.url.split("?")[0],
        requestId: request.id,
        client: bucketFingerprint(bucket),
      }),
    );
  }

  app.addHook("onRequest", async (request, reply) => {
    const route = classify(request.method, request.url);
    if (route === "exempt") return;

    const bucket = clientBucket(request.ip);
    const decision = rateLimiter.check(bucket, route);

    reply.header("X-RateLimit-Limit", String(decision.limit));
    reply.header("X-RateLimit-Remaining", String(decision.remaining));

    if (!decision.allowed) {
      metrics.count(`${route}.requests`);
      metrics.reject("RATE_LIMIT");
      logRejection(request, `rate:${route}`, bucket);
      return reply
        .code(429)
        .header("Retry-After", String(decision.retryAfter))
        .send({
          error: "too many requests",
          reason: "RATE_LIMITED",
          route,
          retryAfter: decision.retryAfter,
        });
    }
  });

  /**
   * Liveness and readiness in one document, kept distinct.
   *
   * `status` is liveness: the process is up and the payment plane is serving.
   * `ready` is readiness for *discovery* only, and it is false until the index
   * has been built. A failed index must not report the process as unhealthy —
   * settlement does not depend on it, and restarting a working facilitator
   * because a derived index could not load would be the worse outcome.
   */
  app.get("/health", async () => ({
    status: "ok",
    ready: discoveryStatus === "ready",
    discovery: {
      status: discoveryStatus,
      indexed: indexedCount,
      ...(discoveryError ? { error: discoveryError } : {}),
    },
    network: config.network,
    rpcUrl: config.rpcUrl,
    signers: signers.length,
    catalog: catalog.list({ limit: 1 }).pagination.total,
    settlements: { inFlight: settleInflight.inFlight },
  }));

  /**
   * `GET /internal/metrics` — operator view, off by default.
   *
   * Two switches, not one: `ENABLE_INTERNAL_METRICS` routes it at all, and
   * `METRICS_TOKEN` authorises it. Turning on observability by accident should
   * not be the same action as publishing it. Without both, the route does not
   * exist — a 404 rather than a 401, so its presence is not discoverable.
   *
   * The payload is counters and timestamps. No payload material, no signatures,
   * no addresses, no environment, no signer state.
   */
  if (config.enableInternalMetrics && config.metricsToken) {
    const expected = Buffer.from(config.metricsToken);

    app.get("/internal/metrics", async (request, reply) => {
      const header = request.headers.authorization ?? "";
      const presented = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : header);

      // Compare in constant time, and only when lengths already match —
      // timingSafeEqual throws on a length mismatch, which would itself leak.
      const authorized =
        presented.length === expected.length && timingSafeEqual(presented, expected);

      if (!authorized) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      return metrics.snapshot({
        catalogListings: catalog.list({ limit: 1 }).pagination.total,
        searchStatus: discoveryStatus,
        searchIndexed: indexedCount,
        settlementsInFlight: settleInflight.inFlight,
      });
    });
  }

  /**
   * RFP §3.6 makes this endpoint an acceptance criterion: it must emit the
   * Stellar `extra` contract including `areFeesSponsored`. `getSupported()`
   * derives that from the scheme's own `getExtra`, so it cannot drift from what
   * settlement actually does.
   */
  app.get("/supported", async () => facilitator.getSupported());

  app.post<{ Body: FacilitatorRequestBody }>("/verify", async (request, reply) => {
    metrics.count("verify.requests");
    const { paymentPayload, paymentRequirements } = request.body ?? {};
    if (!paymentPayload || !paymentRequirements) {
      // Every rejection carries a non-null reason (RFP §3.3, §3.6).
      metrics.reject("INVALID_BODY");
      console.warn(
        JSON.stringify({ event: "verify_rejected", requestId: request.id, reason: "INVALID_BODY" }),
      );
      return reply
        .code(400)
        .send({ isValid: false, invalidReason: "invalid_request_body", payer: null });
    }

    const result = await facilitator.verify(paymentPayload, paymentRequirements);
    if (result.isValid) {
      metrics.count("verify.valid");
    } else {
      metrics.count("verify.invalid");
      metrics.reject("INVALID_PAYMENT");
      console.warn(
        JSON.stringify({
          event: "verify_rejected",
          requestId: request.id,
          network: config.network,
          reason: "INVALID_PAYMENT",
        }),
      );
    }
    return result;
  });

  app.post<{ Body: FacilitatorRequestBody }>("/settle", async (request, reply) => {
    metrics.count("settle.requests");
    const { paymentPayload, paymentRequirements } = request.body ?? {};
    if (!paymentPayload || !paymentRequirements) {
      metrics.reject("INVALID_BODY");
      console.warn(
        JSON.stringify({ event: "settle_rejected", requestId: request.id, reason: "INVALID_BODY" }),
      );
      return reply
        .code(400)
        .send({ success: false, errorReason: "invalid_request_body", transaction: null });
    }

    // Capacity, not rate: a slot bounds how much sponsored fee spend can be in
    // flight at once and keeps simultaneous submissions off the same signer's
    // sequence number. 503 rather than 429 — the caller is not misbehaving,
    // the server is full — and the slot is released whichever way settle goes.
    if (!settleInflight.tryAcquire()) {
      metrics.reject("SETTLE_CONCURRENCY_LIMIT");
      logRejection(request, "concurrency:settle", clientBucket(request.ip));
      return reply
        .code(503)
        .header("Retry-After", "1")
        .send({ success: false, errorReason: "server_busy", transaction: null });
    }

    console.info(
      JSON.stringify({
        event: "settle_started",
        requestId: request.id,
        network: config.network,
        scheme: paymentRequirements.scheme,
      }),
    );

    const startedAt = Date.now();
    const slot: { outcome?: CatalogOutcome } = {};
    let result;
    try {
      result = await catalogSlot.run(slot, () =>
        facilitator.settle(paymentPayload, paymentRequirements),
      );
    } finally {
      settleInflight.release();
    }

    const latencyMs = Date.now() - startedAt;
    if (result.success && result.transaction) {
      metrics.settlementsSucceeded += 1;
      metrics.lastSettlementSuccessAt = new Date().toISOString();
      console.info(
        JSON.stringify({
          event: "settle_succeeded",
          requestId: request.id,
          network: config.network,
          transactionHash: result.transaction,
          latencyMs,
        }),
      );
      // Fee accounting happens after the answer, never inside it.
      recordSponsoredFee(result.transaction);
    } else {
      metrics.submissionsFailed += 1;
      metrics.lastSettlementFailureAt = new Date().toISOString();
      const reason = classifySettleError(result.errorReason);
      metrics.reject(reason);
      console.warn(
        JSON.stringify({
          event: "settle_failed",
          requestId: request.id,
          network: config.network,
          reason,
          latencyMs,
        }),
      );
    }

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

    return toDiscoveryResourcesResponse(catalog.list(query));
  });

  /**
   * `GET /discovery/search` — natural-language search over the catalog.
   *
   * Pipeline is fixed: parse → hard filters → candidates → rank → abstain →
   * paginate → respond. The filters run in SQL before any score is read, so a
   * resource the buyer cannot pay for is not a low-ranked result, it is not a
   * result (RFP §3.2).
   *
   * Ranking is dense cosine over `buildSearchDocument`, the same function and
   * embedder the benchmark measures. `partialResults` reflects whether matches
   * were actually truncated. `pagination.cursor` is opaque and bound to the
   * query and filters that produced it.
   *
   * An empty `resources` array with `abstained` set means the catalog declined
   * to answer rather than recommend a paid service it does not believe in.
   */
  app.get("/discovery/search", async (request, reply) => {
    // An unbuilt index cannot answer, and must not pretend to. Abstention is a
    // finding — "nothing here is worth paying for" — and returning it here
    // would report a conclusion we never reached. 503 says the difference.
    metrics.count("search.requests");
    if (discoveryStatus !== "ready") {
      metrics.searchNotReady += 1;
      metrics.reject("INDEX_NOT_READY");
      return reply.code(503).send({
        error: "discovery index unavailable",
        reason: "INDEX_NOT_READY",
        status: discoveryStatus,
      });
    }

    const q = request.query as Record<string, unknown>;

    const query = typeof q.query === "string" ? q.query.trim() : "";
    if (!query) {
      return reply.code(400).send({ error: "query is required" });
    }
    if (query.length > 512) {
      return reply.code(400).send({ error: "query must be 512 characters or fewer" });
    }

    const type = q.type === "http" || q.type === "mcp" ? (q.type as ResourceType) : undefined;
    if (q.type !== undefined && type === undefined) {
      return reply.code(400).send({ error: "type must be 'http' or 'mcp'" });
    }

    const response = await search.search({
      query,
      filters: {
        ...(type ? { type } : {}),
        ...(q.payTo ? { payTo: String(q.payTo) } : {}),
        ...(q.network ? { network: String(q.network) } : {}),
        ...(q.scheme ? { scheme: String(q.scheme) } : {}),
        ...(parseExtensions(q.extensions) ? { extensions: parseExtensions(q.extensions) } : {}),
      },
      ...(parseIntOr(q.limit, undefined) !== undefined
        ? { limit: parseIntOr(q.limit, undefined) }
        : {}),
      ...(typeof q.cursor === "string" ? { cursor: q.cursor } : {}),
    });

    if (response.abstained?.reason === "INVALID_CURSOR") {
      return reply.code(400).send({ error: "cursor does not match this query and filter set" });
    }

    // Abstention is an answer, not a failure, and is counted apart from both.
    if (response.abstained) metrics.searchAbstentions += 1;

    return toDiscoverySearchResponse(
      response.resources,
      response.partialResults,
      response.pagination,
      response.abstained,
    );
  });

  app.addHook("onClose", async () => {
    catalog.close();
  });

  return {
    app,
    facilitator,
    signerAddresses: signers.map((s) => s.address),
    catalog,
    search,
    searchSettled: () => syncSettled,
    initializeSearch,
    discoveryStatus: () => discoveryStatus,
    metrics,
  };
}

/**
 * The production boot sequence, in one place.
 *
 * Order matters and is deliberate:
 *
 *   1. build — routes exist, discovery reports `initializing`
 *   2. listen — liveness is available immediately, so a platform health check
 *      does not time out while step 3 loads an ~86 MB model on a cold image
 *   3. rebuild the index — discovery becomes ready, or reports why not
 *
 * Listening before the index is built is what makes readiness a real signal
 * rather than a formality: there is a window where the process is alive and
 * discovery honestly says it cannot answer yet.
 *
 * A failed index does not fail the boot. Verification and settlement do not
 * read it, and taking a working payment plane offline because derived state
 * could not be rebuilt would trade a degraded feature for an outage.
 *
 * @param store - Injectable catalog store, for tests.
 */
export async function startFacilitator(
  config: FacilitatorConfig,
  store?: CatalogStore,
): Promise<StartedFacilitator> {
  const built = buildFacilitator(config, store);

  const address = await built.app.listen({ port: config.port, host: "0.0.0.0" });
  const result = await built.initializeSearch();

  console.log(
    JSON.stringify(
      result.ok
        ? { event: "search_index_ready", indexed: result.indexed }
        : { event: "search_index_failed", error: result.error },
    ),
  );

  return {
    ...built,
    address,
    stop: async () => {
      await built.app.close();
    },
  };
}
