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
import type {
  CatalogListing,
  CatalogOutcome,
  CatalogStore,
  DiscoveryPage,
  DiscoveryQuery,
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
        ownershipBinding: (existing?.ownership_binding ??
          next.ownershipBinding) as CatalogListing["ownershipBinding"],
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

  close(): void {
    this.db.close();
  }
}
