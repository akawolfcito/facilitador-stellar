# `.well-known/x402` domain binding: design and implementation plan

**Status: plan only. Nothing implemented.**
2026-08-16. SCF freeze remains `762c6e6`; nothing in `docs/scf/` is touched.

## 1. The frozen requirement

RFP row 6.3, quoted whole:

> Security: replay- and front-running-resistant settlement; an index nobody can
> spoof — **REQUIRED** — evidence E-11, E-25, §10 — **Now**, within TOFU — T3 —
> gap: domain binding — acceptance: **Cross-seller overwrite rejected;
> `.well-known` verified**

Cross-seller overwrite rejection already ships: `OWNERSHIP_CONFLICT` is enforced
in `packages/catalog/src/store.ts` and evidenced at E-11. The outstanding half is
`.well-known` verified.

The proposal already commits to the shape, at §10:

> The real fix — an origin-hosted `.well-known/x402` authorising `payTo`
> addresses, fetched off the hot path with SSRF defences — is specified and
> **not implemented**; it is tranche-3 work before mainnet.

**MUST:** an origin-hosted `.well-known/x402`; fetched off the hot path; SSRF
defences; listings upgraded from `tofu` to `domain-verified`; cross-seller
overwrite still rejected.
**SHOULD:** revalidation, since a binding that never expires stops describing the
present; a visible distinction in the UI.
**OPTIONAL / our interpretation:** the document schema, the authoritative-origin
rule, the TTL, and the state names beyond the two the type already reserves.

Everything the frozen material requires is in the MUST row. The rest is labelled
below as our choice, because it is.

## 2. What this proves, and what it does not

`.well-known/x402` answers exactly one question:

> Does whoever controls this HTTPS origin declare that this resource may be
> catalogued against this `payTo` on this network?

Four things are commonly conflated here. They are not the same and this document
will not let them blur:

| Property | Proven by `.well-known/x402`? |
| --- | --- |
| **Domain control** — someone who can write to the origin's document root, or terminate TLS for it, made this declaration | **Yes**, to the strength of HTTPS and the CA system |
| **Wallet control** — the declared `payTo` is controlled by the same party | **No.** Nothing here is signed by that key. An origin can declare an address it does not hold |
| **Resource ownership** — the declaring party legitimately operates the service | **No.** It proves control of the origin, which is the best available proxy and not the same claim |
| **Payment validity** — a payment to this address will be honoured | **No, and never.** The live 402 is the authority for payment. Discovery metadata stays advisory |

The asymmetry is worth stating plainly because it is what makes the feature
cheap: an origin can name a `payTo` it does not control, but the only party that
can *lose* anything from that is the origin itself, since the catalog binds the
listing to that address and a real settlement to a different address is rejected
as `OWNERSHIP_CONFLICT`.

Wallet control would need a signature from the `payTo` key. That is the "signed
seller assertion" already sketched as option 2 in
`docs/security/catalog-ownership-model.md`, and it is explicitly out of scope
here.

## 3. Authoritative origin

**No upstream rule exists.** Searched the pinned spec tree: x402 defines
`.well-known/did.json` for `did:web` in the offer-and-receipt extension and
`.well-known/http-message-signatures-directory` in the signatures extension, and
nothing at `.well-known/x402`. The path and the rule below are **our
implementation choice** and must be labelled as such wherever they are published.

**The rule: the resource's own origin, exactly. No walking up to a parent
domain.**

```
resource   https://api.example.com/foo
lookup     https://api.example.com/.well-known/x402
```

`api.example.com` and `example.com` are different origins and may be operated by
different people. Walking up would let whoever controls the apex authorise
resources on every subdomain, including ones they do not run, which is a
privilege escalation invented for convenience. A subdomain operator who cannot
write to their own document root has not demonstrated the control we are
measuring.

This matches the catalog's existing identity rule, which already keys on
`normalize(origin + path)`.

**MCP resources** carry `mcp://host:port/tool/name`, which has no HTTPS origin
and therefore no reachable document. They stay `tofu`, and that is a stated
limitation rather than a bug to work around.

## 4. Document schema, minimum

Ours, versioned so it can change without ambiguity.

```json
{
  "version": 1,
  "resources": [
    {
      "resource": "https://api.example.com/foo",
      "payTo": "GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK",
      "network": "stellar:testnet"
    }
  ]
}
```

Three fields per entry, and each earns its place:

- **`resource`** — an absolute URL, matched exactly against the listing's
  canonical resource after the same normalisation the catalog already applies.
  Exact match only.
- **`payTo`** — the address authorised to hold this listing. This is the whole
  point of the document.
- **`network`** — a `payTo` authorised on testnet is not thereby authorised on
  pubnet, and pubnet is on the roadmap. Omitting this would silently grant it.

**Deliberately absent:**

- **No wildcards.** `https://api.example.com/*` would let one declaration cover
  routes added later without a fresh decision by the operator. Enumerating is a
  little more work for the seller and a much smaller blast radius.
- **No `scheme` or `asset`.** Ownership is about who may hold the listing, not
  about payment terms. The live 402 governs terms, and duplicating them here
  creates two sources of truth that can disagree.
- **No expiry inside the document.** Freshness is the verifier's business, via
  TTL and revalidation. A document-declared expiry would be a second clock to
  reconcile, and a stale document with a long self-declared life is exactly the
  case TTL already handles.

**Multiplicity:** many resources per document; many entries per resource when an
origin authorises several addresses or several networks. A match is any entry
whose three fields all agree.

## 5. Verification algorithm

Closed result states. No booleans, because "false" here has at least four
meanings that need different handling.

```
verify(resource, payTo, network) →
  1. parse resource URL                      → malformed?        UNSAFE_ORIGIN
  2. require https:                          → otherwise         UNSAFE_ORIGIN
  3. resolve host, check every address       → private/local?    UNSAFE_ORIGIN
  4. GET https://<origin>/.well-known/x402   → timeout?          FETCH_TIMEOUT
                                             → 404?             WELL_KNOWN_NOT_FOUND
                                             → other non-2xx?   WELL_KNOWN_INVALID
  5. enforce content-type and size limits    → violated?         WELL_KNOWN_INVALID
  6. parse JSON, validate schema             → invalid?          WELL_KNOWN_INVALID
  7. find entry with resource == canonical   → none?             RESOURCE_NOT_DECLARED
  8. compare network                         → differs?          NETWORK_MISMATCH
  9. compare payTo                           → differs?          PAYTO_MISMATCH
 10.                                                             VERIFIED
```

`VERIFIED` is the only success. Everything else is a named reason, and the
reasons split into two groups that behave differently in §7: **absent** proof
(`WELL_KNOWN_NOT_FOUND`, `FETCH_TIMEOUT`) versus **contradicted** proof
(`PAYTO_MISMATCH`, `NETWORK_MISMATCH`, `RESOURCE_NOT_DECLARED`). Silence is not
denial.

## 6. SSRF and network safety

This is a server-side fetch of a URL a stranger chose, on a host that holds a
signing key. It gets the same treatment the demo buyer got.

| Control | Value |
| --- | --- |
| Scheme | `https:` only. No `http:`, no `file:`, no anything else |
| DNS | Resolve first; reject if **any** returned address is private, loopback, link-local, unique-local, CGNAT, or unspecified |
| Denied ranges | `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (incl. `169.254.169.254`), `100.64/10`, `0.0.0.0/8`, `::1`, `fc00::/7`, `fe80::/10`, `::` |
| DNS rebinding | Pin the checked address and connect to it, so the name cannot resolve differently between check and connect |
| Redirects | **Zero followed.** A `.well-known` document that redirects is not at the well-known path. This removes redirect loops, redirect-to-private and cross-origin redirect entirely, at the cost of a rule sellers must follow |
| Timeout | 5 s total, connect and read |
| Body limit | 64 KB, enforced while streaming, not after |
| Decompression | Refuse `content-encoding` other than identity, so a compression bomb has nowhere to expand |
| Content type | `application/json` required |
| Ports | 443 only |
| Concurrency | One verification in flight per origin |

Not a generic fetcher: one fixed path, one method, no caller-supplied URL beyond
the origin of a resource already in the catalog.

## 7. Ownership states and precedence

`packages/catalog/src/types.ts` already declares the union, with
`domain-verified` marked *Reserved*. The plan fills that in and adds one state:

```ts
export type OwnershipBinding =
  | "tofu"             // bound to the payTo seen at first settlement
  | "domain-verified"  // the origin declares this payTo for this resource
  | "domain-mismatch"; // the origin declares something else, explicitly
```

**Precedence: `domain-verified` > `tofu`, and `domain-mismatch` overrides both.**

The existing merge already refuses to let a later write change ownership
(`existing?.ownership_binding ?? next.ownershipBinding`), so a TOFU claim cannot
overwrite a verified one today by accident. The plan makes that intent explicit
rather than incidental.

| Event | Result |
| --- | --- |
| No document (404) | stays `tofu`. Absence is not denial; most third-party sellers will never publish one |
| Timeout or unreachable | stays as it was, `last_error` recorded, retried on the next cycle. A slow origin must not demote a good binding |
| Malformed document | stays as it was, `last_error` recorded. A broken deploy is not a repudiation |
| Resource not declared | stays `tofu`. The origin published a document and did not mention this resource, which is weaker than a contradiction |
| `payTo` mismatch | → **`domain-mismatch`**, surfaced. The origin actively named a different address, and quietly keeping a green label would be the worst outcome available |
| `network` mismatch | → **`domain-mismatch`** |
| Origin later changes its declaration | next revalidation moves the state. Verification describes the present or it describes nothing |
| Resource disappears (404 on the resource itself) | ownership untouched. This is a liveness question, not an ownership one |
| Resource redirects | ownership untouched, for the same reason |

A `domain-verified` listing that later mismatches **must not** silently stay
verified, and must not be deleted either: `domain-mismatch` is a state a reviewer
can see and act on.

## 8. Revalidation

Small, and no cron.

- **Verify at cataloging**, off the settlement path, fire-and-forget.
- **TTL 24 hours**, stored as `expires_at`.
- **Stale-while-revalidate**: an expired binding keeps its state and is
  re-checked opportunistically; it does not flip to `tofu` because a timer fired.
- **Trigger**: lazily, when a listing is read by discovery and its `expires_at`
  has passed, at most one in-flight check per origin. Traffic drives freshness,
  which means an unread listing is not re-checked, which is the correct priority.
- **After expiry with repeated failure**: after 7 days of continuous failure a
  `domain-verified` binding degrades to `tofu` and says so. That is a
  deliberately long fuse; the alternative is a weekend outage silently
  downgrading an honest seller.

## 9. Catalog integration

Current pipeline: **settlement → automatic Bazaar cataloging → ownership binding
→ search index.**

Verification belongs **after insertion, as enrichment**. Never before, and never
in the settlement path.

```
settle → catalog write (ownership := tofu)  ← unchanged, synchronous, on-path
                     ↓
              enqueue verification          ← new, off-path, best-effort
                     ↓
       update ownership_binding + verification row
                     ↓
              search index unaffected
```

**Payment plane impact: NONE, by construction.** A payment must never fail
because a third party's web server is down. The facilitator already moved index
sync off the settlement response path in `ce1c46c`; this follows the same
precedent for the same reason.

## 10. Search and UI

Presentation only. The frozen browser demo payment is not touched.

- Primary label: **`Domain verified`** for `domain-verified`. TOFU keeps its
  current wording, **`Ownership verified`** becomes **`Ownership: first use`**
  so the two are not confusable — the current label is too generous now that a
  stronger state exists.
- `domain-mismatch` is shown in the abstention/refusal colour, not hidden.
- Details may show the verified origin, `last checked`, and the result reason.
- **No green badge for TOFU**, and no wording that implies a domain-verified
  listing is safer to *pay*. Payment validity comes from the live 402 and this
  changes nothing about it.

## 11. Persistence

One new table, keyed by the identity the catalog already uses. The listings table
gains nothing except the widened `ownership_binding` value set, so no column
migration is required for existing rows.

```sql
CREATE TABLE IF NOT EXISTS domain_verification (
  canonical_key TEXT PRIMARY KEY NOT NULL
                REFERENCES listings(canonical_key) ON DELETE CASCADE,
  origin        TEXT NOT NULL,
  pay_to        TEXT NOT NULL,
  network       TEXT NOT NULL,
  status        TEXT NOT NULL,   -- VERIFIED | NOT_FOUND | MISMATCH | ERROR
  reason        TEXT,            -- closed set, never an upstream string
  verified_at   TEXT,
  checked_at    TEXT NOT NULL,
  expires_at    TEXT,
  failures      INTEGER NOT NULL DEFAULT 0
);
```

Response bodies are not stored. The document is re-fetchable and keeping copies
of third-party content on our disk is a liability with no reader.

`ON DELETE CASCADE` mirrors the `embeddings` table: derived state must not
outlive its listing.

## 12. Failure semantics

Closed set, ours, never an upstream error string:

`WELL_KNOWN_NOT_FOUND`, `WELL_KNOWN_INVALID`, `RESOURCE_NOT_DECLARED`,
`PAYTO_MISMATCH`, `NETWORK_MISMATCH`, `UNSAFE_ORIGIN`, `FETCH_TIMEOUT`,
`FETCH_TOO_LARGE`, `REDIRECT_REFUSED`.

## 13. Test matrix

Thirty-one cases in five groups.

**Happy (4):** exact resource and `payTo` match; a document listing several
resources; several entries for one resource across networks; verification writes
`verified_at` and `expires_at`.

**Fallback (4):** no document leaves `tofu`; timeout leaves the prior state and
records `last_error`; malformed JSON leaves the prior state; a document that
omits this resource leaves `tofu`.

**Mismatch (4):** wrong `payTo` → `domain-mismatch`; wrong network →
`domain-mismatch`; resource declared under a different origin is not matched;
a mismatch after a previous success does not stay verified.

**Security (12):** `localhost`; `127.0.0.1`; `10.0.0.1`; `192.168.1.1`;
`169.254.169.254`; `::1`; `fc00::1`; a hostname resolving to a private address;
DNS rebinding between check and connect; an `http:` resource; a 70 KB body; a
redirect to any host, including a public one.

**State and regression (7):** `domain-verified` cannot be overwritten by a later
TOFU write; revalidation refreshes the TTL; seven days of failure degrades to
`tofu` and says so; settlement succeeds while verification fails; `exact`
payments unchanged; discovery and abstention unchanged; the frozen browser demo
payment unchanged.

## 14. Implementation surface

- `packages/catalog/src/ownership/verifier.ts` — fetch, SSRF guards, parse,
  compare. The only new network code
- `packages/catalog/src/ownership/wellknown.ts` — schema and matching
- `packages/catalog/src/store.ts` — the new table, precedence made explicit
- `packages/catalog/src/types.ts` — widen the union with `domain-mismatch`
- `apps/facilitator/src/app.ts` — enqueue verification after catalog write,
  off-path
- `apps/demo-seller/` — serve our own `.well-known/x402`, for acceptance
- `x402seek-web` — one label change and a details row
- `docs/hosted/HOSTED-E-08-domain-binding.md`

**Settlement logic is not in that list, and must not join it.**

## 15. Hosted acceptance

Our own seller first, because it is the one origin we control.

1. Serve `https://demo-api.testnet.x402seek.xyz/.well-known/x402` declaring the
   `/summarize` resource, the seller `payTo`, and `stellar:testnet`.
2. Trigger revalidation on the existing catalog row. **No new payment**: the
   listing is already catalogued, and verification reads the origin, not the
   chain.
3. Record the HTTP response, the verification result, the catalog row before and
   after, and the public UI label.
4. Then the negative case, which is the one that actually demonstrates the
   control: temporarily serve a document declaring a different `payTo`, confirm
   the state becomes `domain-mismatch` rather than staying verified, restore it,
   and confirm it returns to `domain-verified`.

A feature like this is only proven by its failure path. Publishing only the happy
case would be evidence of the easy half.

## 16. Evidence

`docs/hosted/HOSTED-E-08-domain-binding.md`. Records what was verified, in the
language of §2: **domain control, not wallet proof.** The words "wallet",
"owner" and "authentic" do not appear as claims about the `payTo` key.
`docs/scf/` is not modified.

## 17. TOFU stays

TOFU is not deprecated and not removed. Third-party sellers will not publish a
document we invented, and a discovery service that only lists origins which
adopted our convention is a directory of ourselves. The hierarchy is
`domain-verified` > `tofu`, with `domain-mismatch` as an explicit conflict, and
every listing keeps disclosing which one it is.

## 18. Estimate

**MEDIUM.** One verifier module with real SSRF surface, one table, one
precedence rule, a label change, and thirty-one tests. No new dependency: Node's
`dns/promises` and `fetch` cover it, and the catalog already owns SQLite.

**Biggest risk: publishing a `.well-known/x402` convention that upstream later
defines differently.** There is no upstream `.well-known/x402` today, and x402
already uses `.well-known` for `did:web` and for HTTP message signatures, so the
namespace is one they are clearly willing to occupy. Mitigations: the `version`
field, labelling the schema as our implementation choice everywhere it is
published, and raising it with the TSC while building rather than after. The
downside is bounded — a schema change is a migration and a re-fetch, not a
protocol break — but it should be entered with eyes open rather than discovered
in review.
