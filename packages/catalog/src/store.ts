/**
 * SQLite-backed catalog store.
 *
 * better-sqlite3 (MIT), synchronous and file-backed. Boring on purpose: the
 * RFP's index is off-chain by default (§3.2) and correctness matters far more
 * than write throughput at this stage. A file path gives real restart
 * durability to test against; `:memory:` gives fast unit tests.
 *
 * The ownership check and the write happen inside one transaction. Splitting
 * them would let two concurrent settlements for the same new key both read
 * "no owner" and both insert — the unique constraint would catch the second,
 * but as a crash rather than an `OWNERSHIP_CONFLICT`.
 */

import Database, { type Database as Db } from "better-sqlite3";
import type { OwnershipBinding,
  CatalogListing,
  CatalogOutcome,
  CatalogStore,
  DiscoveryPage,
  DiscoveryQuery,
  EmbeddingRecord,
} from "./types.js";

export const METADATA_VERSION = 1;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS listings (
     canonical_key      TEXT PRIMARY KEY NOT NULL,
     type               TEXT NOT NULL CHECK (type IN ('http','mcp')),
     resource           TEXT NOT NULL,
     route_template     TEXT,
     method             TEXT,
     tool_name          TEXT,

     service_name       TEXT,
     description        TEXT,
     tags               TEXT,
     icon_url           TEXT,
     mime_type          TEXT,
     discovery_info     TEXT NOT NULL,
     extensions         TEXT,

     pay_to             TEXT NOT NULL,
     network            TEXT NOT NULL,
     scheme             TEXT NOT NULL,
     asset              TEXT NOT NULL,
     amount TEXT NOT NULL,
     x402_version       INTEGER NOT NULL,

     owner_pay_to       TEXT NOT NULL,
     ownership_binding  TEXT NOT NULL,

     first_seen_at      TEXT NOT NULL,
     last_seen_at       TEXT NOT NULL,
     last_settlement_tx TEXT NOT NULL,
     metadata_version   INTEGER NOT NULL
   )`,
  /**
   * Derived state, never source of truth.
   *
   * A row is valid only while `document_hash`, `model` and `doc_version` all
   * match what the current listing and code would produce; any mismatch makes
   * it stale and it is rebuilt from `listings`. Deleting this whole table must
   * cost nothing but CPU — that property is what makes the catalog the single
   * source of truth, and it is tested.
   *
   * `ON DELETE CASCADE` keeps vectors from outliving their listing.
   */
  /**
   * Domain-binding results, one row per listing.
   *
   * Derived state, like `embeddings`: deleting this table costs a re-fetch and
   * nothing else, and every listing stays valid without it. Third-party response
   * bodies are deliberately absent — the document is re-fetchable, and keeping
   * copies of someone else's content on our disk is a liability with no reader.
   */
  `CREATE TABLE IF NOT EXISTS domain_verification (
     canonical_key TEXT PRIMARY KEY NOT NULL
                   REFERENCES listings(canonical_key) ON DELETE CASCADE,
     origin        TEXT NOT NULL,
     pay_to        TEXT NOT NULL,
     network       TEXT NOT NULL,
     status        TEXT NOT NULL,
     reason        TEXT NOT NULL,
     verified_at   TEXT,
     checked_at    TEXT NOT NULL,
     expires_at    TEXT,
     failures      INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS embeddings (
     canonical_key  TEXT PRIMARY KEY NOT NULL
                    REFERENCES listings(canonical_key) ON DELETE CASCADE,
     document_hash  TEXT NOT NULL,
     model          TEXT NOT NULL,
     doc_version    INTEGER NOT NULL,
     dims           INTEGER NOT NULL,
     vector         BLOB NOT NULL,
     built_at       TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_listings_type    ON listings(type)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_pay_to  ON listings(pay_to)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_network ON listings(network)`,
  `CREATE INDEX IF NOT EXISTS idx_listings_order   ON listings(first_seen_at, canonical_key)`,
];

interface Row {
  canonical_key: string;
  type: "http" | "mcp";
  resource: string;
  route_template: string | null;
  method: string | null;
  tool_name: string | null;
  service_name: string | null;
  description: string | null;
  tags: string | null;
  icon_url: string | null;
  mime_type: string | null;
  discovery_info: string;
  extensions: string | null;
  pay_to: string;
  network: string;
  scheme: string;
  asset: string;
  amount: string;
  x402_version: number;
  owner_pay_to: string;
  ownership_binding: string;
  first_seen_at: string;
  last_seen_at: string;
  last_settlement_tx: string;
  metadata_version: number;
}

function toListing(row: Row): CatalogListing {
  return {
    canonicalKey: row.canonical_key,
    type: row.type,
    resource: row.resource,
    ...(row.route_template ? { routeTemplate: row.route_template } : {}),
    ...(row.method ? { method: row.method } : {}),
    ...(row.tool_name ? { toolName: row.tool_name } : {}),
    ...(row.service_name ? { serviceName: row.service_name } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.tags ? { tags: JSON.parse(row.tags) as string[] } : {}),
    ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
    discoveryInfo: JSON.parse(row.discovery_info) as unknown,
    ...(row.extensions
      ? { extensions: JSON.parse(row.extensions) as Record<string, unknown> }
      : {}),
    payTo: row.pay_to,
    network: row.network,
    scheme: row.scheme,
    asset: row.asset,
    amount: row.amount,
    x402Version: row.x402_version,
    ownerPayTo: row.owner_pay_to,
    ownershipBinding: row.ownership_binding as CatalogListing["ownershipBinding"],
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastSettlementTx: row.last_settlement_tx,
    metadataVersion: row.metadata_version,
  };
}

/**
 * Ownership precedence, stated rather than implied.
 *
 * `domain-verified` outranks `tofu`, and `domain-mismatch` outranks both because
 * an origin that named a different payee has said something, and a reassuring
 * label over a live contradiction is the worst output this table can produce.
 *
 * Every settlement write arrives as `tofu`, so this is the line that stops a
 * later payment from quietly demoting a verified listing. The previous code got
 * that right by accident, via `existing ?? next`. Getting it right on purpose
 * means the next person to touch this line can see what it is for.
 */
const BINDING_RANK: Record<OwnershipBinding, number> = {
  tofu: 0,
  "domain-verified": 1,
  "domain-mismatch": 2,
};

export function strongerBinding(
  existing: OwnershipBinding | undefined,
  next: OwnershipBinding,
): OwnershipBinding {
  if (!existing) return next;
  return BINDING_RANK[existing] >= BINDING_RANK[next] ? existing : next;
}

/** How long a verification result is trusted before it is asked again. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a previously verified binding survives continuous failure.
 *
 * Deliberately long. The alternative is a weekend outage silently downgrading an
 * honest seller, and a binding that flips on the first timeout describes our
 * network weather rather than their declaration.
 */
export const VERIFICATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface VerificationRecord {
  canonicalKey: string;
  origin: string;
  payTo: string;
  network: string;
  status: string;
  reason: string;
  verifiedAt: string | null;
  checkedAt: string;
  expiresAt: string | null;
  failures: number;
}

export class SqliteCatalogStore implements CatalogStore {
  private readonly db: Db;

  /** @param path - File path for durability, or `:memory:` for tests. */
  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    for (const statement of MIGRATIONS) this.db.exec(statement);
  }

  upsert(listing: CatalogListing): CatalogOutcome {
    const run = this.db.transaction((next: CatalogListing): CatalogOutcome => {
      const existing = this.db
        .prepare("SELECT * FROM listings WHERE canonical_key = ?")
        .get(next.canonicalKey) as Row | undefined;

      if (existing && existing.owner_pay_to !== next.ownerPayTo) {
        return {
          kind: "rejected",
          status: "rejected",
          code: "OWNERSHIP_CONFLICT",
          message: `canonical resource is bound to a different payment recipient`,
        };
      }

      // A repeated callback for a settlement we already recorded changes
      // nothing — not even lastSeenAt, so provenance stays truthful.
      if (existing && existing.last_settlement_tx === next.lastSettlementTx) {
        return { kind: "noop", status: "success", listing: toListing(existing) };
      }

      const merged: CatalogListing = {
        ...next,
        // First sighting is immutable; an update must not rewrite history.
        firstSeenAt: existing?.first_seen_at ?? next.firstSeenAt,
        ownershipBinding: strongerBinding(
          existing?.ownership_binding as OwnershipBinding | undefined,
          next.ownershipBinding,
        ),
      };

      this.db
        .prepare(
          `INSERT INTO listings (
             canonical_key, type, resource, route_template, method, tool_name,
             service_name, description, tags, icon_url, mime_type, discovery_info, extensions,
             pay_to, network, scheme, asset, amount, x402_version,
             owner_pay_to, ownership_binding,
             first_seen_at, last_seen_at, last_settlement_tx, metadata_version
           ) VALUES (
             @canonical_key, @type, @resource, @route_template, @method, @tool_name,
             @service_name, @description, @tags, @icon_url, @mime_type, @discovery_info, @extensions,
             @pay_to, @network, @scheme, @asset, @amount, @x402_version,
             @owner_pay_to, @ownership_binding,
             @first_seen_at, @last_seen_at, @last_settlement_tx, @metadata_version
           )
           ON CONFLICT(canonical_key) DO UPDATE SET
             type = excluded.type,
             resource = excluded.resource,
             route_template = excluded.route_template,
             method = excluded.method,
             tool_name = excluded.tool_name,
             service_name = excluded.service_name,
             description = excluded.description,
             tags = excluded.tags,
             icon_url = excluded.icon_url,
             mime_type = excluded.mime_type,
             discovery_info = excluded.discovery_info,
             extensions = excluded.extensions,
             pay_to = excluded.pay_to,
             network = excluded.network,
             scheme = excluded.scheme,
             asset = excluded.asset,
             amount = excluded.amount,
             x402_version = excluded.x402_version,
             last_seen_at = excluded.last_seen_at,
             last_settlement_tx = excluded.last_settlement_tx,
             metadata_version = excluded.metadata_version`,
        )
        .run({
          canonical_key: merged.canonicalKey,
          type: merged.type,
          resource: merged.resource,
          route_template: merged.routeTemplate ?? null,
          method: merged.method ?? null,
          tool_name: merged.toolName ?? null,
          service_name: merged.serviceName ?? null,
          description: merged.description ?? null,
          tags: merged.tags ? JSON.stringify(merged.tags) : null,
          icon_url: merged.iconUrl ?? null,
          mime_type: merged.mimeType ?? null,
          discovery_info: JSON.stringify(merged.discoveryInfo),
          extensions: merged.extensions ? JSON.stringify(merged.extensions) : null,
          pay_to: merged.payTo,
          network: merged.network,
          scheme: merged.scheme,
          asset: merged.asset,
          amount: merged.amount,
          x402_version: merged.x402Version,
          owner_pay_to: merged.ownerPayTo,
          ownership_binding: merged.ownershipBinding,
          first_seen_at: merged.firstSeenAt,
          last_seen_at: merged.lastSeenAt,
          last_settlement_tx: merged.lastSettlementTx,
          metadata_version: merged.metadataVersion,
        });

      return {
        kind: "cataloged",
        status: "success",
        listing: merged,
        created: existing === undefined,
      };
    });

    return run(listing);
  }

  get(canonicalKey: string): CatalogListing | undefined {
    const row = this.db
      .prepare("SELECT * FROM listings WHERE canonical_key = ?")
      .get(canonicalKey) as Row | undefined;
    return row ? toListing(row) : undefined;
  }

  /**
   * Filtered, offset-paginated listing.
   *
   * Ordering is `first_seen_at ASC, canonical_key ASC`. Deterministic and
   * total: `canonical_key` is the primary key, so no two rows can tie, and a
   * page boundary cannot shuffle between requests the way an unstable sort
   * would. Documented in the discovery endpoint's response contract.
   *
   * The `extensions` filter is applied in SQL against the stored JSON keys.
   */
  list(query: DiscoveryQuery): DiscoveryPage {
    const where: string[] = [];
    const params: Record<string, string> = {};

    if (query.type) {
      where.push("type = @type");
      params.type = query.type;
    }
    if (query.payTo) {
      where.push("pay_to = @payTo");
      params.payTo = query.payTo;
    }
    if (query.network) {
      where.push("network = @network");
      params.network = query.network;
    }
    if (query.scheme) {
      where.push("scheme = @scheme");
      params.scheme = query.scheme;
    }
    for (const [i, key] of (query.extensions ?? []).entries()) {
      // json_type(...) is non-null exactly when the key is present.
      where.push(`json_type(COALESCE(extensions,'{}'), '$.' || @ext${i}) IS NOT NULL`);
      params[`ext${i}`] = key;
    }

    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM listings ${clause}`).get(params) as {
        n: number;
      }
    ).n;

    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);

    const rows = this.db
      .prepare(
        `SELECT * FROM listings ${clause}
         ORDER BY first_seen_at ASC, canonical_key ASC
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as Row[];

    return { resources: rows.map(toListing), pagination: { limit, offset, total } };
  }

  /** Every listing, for a full index rebuild. */
  all(): CatalogListing[] {
    const rows = this.db
      .prepare("SELECT * FROM listings ORDER BY first_seen_at ASC, canonical_key ASC")
      .all() as Row[];
    return rows.map(toListing);
  }

  /**
   * Store a vector for a listing.
   *
   * Float32Array is written as a raw little-endian blob rather than JSON: 384
   * floats are 1.5KB binary against ~9KB of text, and the round trip is a
   * memcpy instead of a parse.
   */
  putEmbedding(record: EmbeddingRecord): void {
    this.db
      .prepare(
        `INSERT INTO embeddings (canonical_key, document_hash, model, doc_version, dims, vector, built_at)
         VALUES (@canonical_key, @document_hash, @model, @doc_version, @dims, @vector, @built_at)
         ON CONFLICT(canonical_key) DO UPDATE SET
           document_hash = excluded.document_hash,
           model = excluded.model,
           doc_version = excluded.doc_version,
           dims = excluded.dims,
           vector = excluded.vector,
           built_at = excluded.built_at`,
      )
      .run({
        canonical_key: record.canonicalKey,
        document_hash: record.documentHash,
        model: record.model,
        doc_version: record.docVersion,
        dims: record.vector.length,
        vector: Buffer.from(
          record.vector.buffer,
          record.vector.byteOffset,
          record.vector.byteLength,
        ),
        built_at: record.builtAt,
      });
  }

  /** Every stored vector, regardless of freshness. */
  allEmbeddings(): EmbeddingRecord[] {
    const rows = this.db.prepare("SELECT * FROM embeddings").all() as Array<{
      canonical_key: string;
      document_hash: string;
      model: string;
      doc_version: number;
      dims: number;
      vector: Buffer;
      built_at: string;
    }>;
    return rows.map((row) => ({
      canonicalKey: row.canonical_key,
      documentHash: row.document_hash,
      model: row.model,
      docVersion: row.doc_version,
      builtAt: row.built_at,
      // Copy: the Buffer view may not be 4-byte aligned for Float32Array.
      vector: new Float32Array(
        row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength),
      ),
    }));
  }

  /** Drop vectors whose listing no longer exists. */
  pruneEmbeddings(): number {
    return this.db
      .prepare(
        "DELETE FROM embeddings WHERE canonical_key NOT IN (SELECT canonical_key FROM listings)",
      )
      .run().changes;
  }

  /** Discard the whole derived index. Used to prove it is rebuildable. */
  clearEmbeddings(): void {
    this.db.exec("DELETE FROM embeddings");
  }

  close(): void {
    this.db.close();
  }
  /** The last verification result for a listing, if one was ever recorded. */
  verification(canonicalKey: string): VerificationRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM domain_verification WHERE canonical_key = ?")
      .get(canonicalKey) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      canonicalKey: row.canonical_key as string,
      origin: row.origin as string,
      payTo: row.pay_to as string,
      network: row.network as string,
      status: row.status as string,
      reason: row.reason as string,
      verifiedAt: (row.verified_at as string | null) ?? null,
      checkedAt: row.checked_at as string,
      expiresAt: (row.expires_at as string | null) ?? null,
      failures: row.failures as number,
    };
  }

  /**
   * Record a verification result and move the listing's binding accordingly.
   *
   * One transaction, because a result written without the binding it implies is
   * a row that says one thing while the catalog says another.
   *
   * `failures` counts consecutive non-answers, not contradictions. A
   * contradiction is an answer.
   */
  recordVerification(
    canonicalKey: string,
    outcome: { reason: string; origin: string },
    binding: OwnershipBinding | undefined,
    at: number = Date.now(),
  ): void {
    const previous = this.verification(canonicalKey);
    const listing = this.db
      .prepare("SELECT owner_pay_to, network, ownership_binding FROM listings WHERE canonical_key = ?")
      .get(canonicalKey) as
      | { owner_pay_to: string; network: string; ownership_binding: string }
      | undefined;
    if (!listing) return;

    const verified = outcome.reason === "VERIFIED";
    const answered = verified || binding === "domain-mismatch";
    const failures = answered ? 0 : (previous?.failures ?? 0) + 1;
    const now = new Date(at).toISOString();

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO domain_verification (
             canonical_key, origin, pay_to, network, status, reason,
             verified_at, checked_at, expires_at, failures
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(canonical_key) DO UPDATE SET
             origin = excluded.origin, status = excluded.status, reason = excluded.reason,
             verified_at = excluded.verified_at, checked_at = excluded.checked_at,
             expires_at = excluded.expires_at, failures = excluded.failures`,
        )
        .run(
          canonicalKey,
          outcome.origin,
          listing.owner_pay_to,
          listing.network,
          verified ? "VERIFIED" : binding === "domain-mismatch" ? "MISMATCH" : "UNVERIFIED",
          outcome.reason,
          verified ? now : (previous?.verifiedAt ?? null),
          now,
          new Date(at + VERIFICATION_TTL_MS).toISOString(),
          failures,
        );

      if (binding) {
        this.db
          .prepare("UPDATE listings SET ownership_binding = ? WHERE canonical_key = ?")
          .run(binding, canonicalKey);
      }
    })();
  }

  /**
   * Demote a binding that has gone unanswered past the grace window.
   *
   * Returns true when a demotion happened, so the caller can log a state
   * transition rather than a silent change.
   */
  degradeStaleVerification(canonicalKey: string, at: number = Date.now()): boolean {
    const record = this.verification(canonicalKey);
    if (!record || record.status !== "UNVERIFIED" || !record.verifiedAt) return false;
    if (at - Date.parse(record.verifiedAt) < VERIFICATION_GRACE_MS) return false;

    const row = this.db
      .prepare("SELECT ownership_binding FROM listings WHERE canonical_key = ?")
      .get(canonicalKey) as { ownership_binding: string } | undefined;
    if (row?.ownership_binding !== "domain-verified") return false;

    this.db.transaction(() => {
      this.db
        .prepare("UPDATE listings SET ownership_binding = 'tofu' WHERE canonical_key = ?")
        .run(canonicalKey);
      this.db
        .prepare("UPDATE domain_verification SET verified_at = NULL WHERE canonical_key = ?")
        .run(canonicalKey);
    })();
    return true;
  }

}
