# x402Seek — an x402 facilitator for Stellar, with a discovery layer

[![CI](https://github.com/akawolfcito/facilitador-stellar/actions/workflows/ci.yml/badge.svg)](https://github.com/akawolfcito/facilitador-stellar/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-22.20.0-brightgreen.svg)](./.nvmrc)

An [x402](https://x402.org) payment facilitator for Stellar that settles `exact`
USDC on Soroban **and** answers the question settlement leaves open: *what should
an agent pay for?*

A settled payment automatically catalogs the resource. The catalog is indexed
semantically, survives restart, and is queried in natural language — and the
engine refuses to answer when nothing is relevant enough, because handing a
paying agent an irrelevant service is worse than handing it nothing.

> **Status: LIVE TESTNET.** `stellar:testnet` only, testnet USDC, `exact` scheme
> only. Not production. Not mainnet. No third-party security review has been
> performed. See [Known limitations](#known-limitations).

## The problem

Stellar already has working `exact` settlement — `@x402/stellar` implements it
and a public facilitator runs it. What it does not have is discovery.

- SDF's own `stellar/x402-stellar` reference facilitator contains no discovery
  code.
- The public `x402.org` facilitator serves `stellar:testnet` in `/supported` and
  returns **HTTP 404** on `/discovery/resources`.
- The only server-side Bazaar search in the upstream x402 monorepo lowercases the
  query and calls `haystack.includes(needle)`. `"weather"` works; *"what service
  can tell me whether it will rain tomorrow?"* matches nothing.

When the consumer is software with a wallet, a bad result is not a wasted click —
it is a wasted payment. That is why ranking quality and abstention live in this
repository next to verify and settle.

## What is built

| Capability | Where |
| --- | --- |
| `exact` USDC settlement on Stellar testnet, facilitator-sponsored fees | `apps/facilitator` |
| Automatic cataloging driven by settlement | `packages/catalog` |
| Persistent SQLite catalog + search index, rehydrated on boot | `packages/catalog`, `apps/facilitator` |
| Semantic search with abstention (local ONNX embeddings, no hosted model API) | `packages/search` |
| `.well-known/x402` resource-ownership binding and precedence | `packages/catalog/src/ownership` |
| MCP server: `bazaar_search`, `bazaar_pay_and_call` | `apps/mcp-discovery` |
| Retrieval benchmark with a held-out split | `packages/retrieval-eval` |
| Demo paid resource and demo buyer | `apps/demo-seller`, `apps/demo-buyer` |
| Transitive licence gate (fails CI on copyleft) | `scripts/audit-licenses.mts` |

### Retrieval measurement

Benchmark of 65 synthetic listings and 56 queries with labels written before any
retriever existed (`artifacts/retrieval-eval/latest.json`, regenerate with
`pnpm eval:retrieval`):

| Retriever | dev nDCG@10 | held-out nDCG@10 |
| --- | --- | --- |
| `baseline-includes` (upstream substring match) | 0.2433 | 0.2258 |
| `bm25` | 0.8019 | 0.8297 |
| `dense` | 0.9307 | 0.9534 |
| `hybrid-rrf` | 0.9056 | 0.9349 |

This corpus is **synthetic**. It measures ranking behaviour, not real-world
demand. The hosted catalog holds one listing and cannot measure ranking at all —
see `docs/hosted/HOSTED-E-05-search.md`, which says so explicitly.

## Architecture

```
                    ┌──────────────────────────────┐
   agent / browser  │  apps/mcp-discovery  (MCP)   │
        │           │  bazaar_search               │
        │           │  bazaar_pay_and_call         │
        │           └───────────────┬──────────────┘
        │                           │
        ▼                           ▼
┌───────────────────────────────────────────────────┐
│ apps/facilitator            (Fastify, Node 22)    │
│   /supported                                      │
│   /verify  /settle          → @x402/stellar       │
│   /discovery/resources                            │
│   /discovery/search                               │
│   /health  /ready                                 │
│   /internal/metrics  (off unless two switches set)│
└───────┬───────────────────────────┬───────────────┘
        │                           │
        ▼                           ▼
┌────────────────────┐    ┌────────────────────────┐
│ packages/catalog   │    │ packages/search        │
│  SQLite store      │───▶│  MiniLM ONNX embedder  │
│  canonicalisation  │    │  hybrid ranking        │
│  ownership verify  │    │  abstention @ 0.22 cos │
└────────────────────┘    └────────────────────────┘
        │
        ▼  Soroban RPC
┌───────────────────────────────────────────────────┐
│  Stellar testnet — USDC, classic G… accounts      │
└───────────────────────────────────────────────────┘
```

Settlement flows through `@x402/stellar` as a dependency; verify and settle are
not reimplemented. Soroban's authorization model lets the buyer sign an auth
entry while the facilitator submits and pays the fee — in a recorded nine-payment
run the buyer's XLM balance changed by exactly zero.

## Supported networks and protocols

| | |
| --- | --- |
| Networks | `stellar:testnet` **only**. The deployment carries `DEPLOYMENT_NETWORK_LOCK=testnet` and refuses to start elsewhere. |
| Schemes | `exact` only. `upto` is **not** implemented (blocked upstream — no merged `scheme_upto_stellar.md`). |
| Accounts | Classic `G…` accounts only. Contract accounts (`__check_auth`) are untested and upstream-gated. |
| x402 version | 2 (`@x402/core`, `@x402/stellar`, `@x402/extensions`, `@x402/mcp` @ 2.22.0) |
| MCP | `@modelcontextprotocol/sdk` 1.15.1 |

## Public deployment

The site at **[x402seek.xyz](https://x402seek.xyz)** is the project's public face.
It is built from a separate repository (`x402seek-web`); **this** repository
provides the services it calls.

| Service | URL | Built from |
| --- | --- | --- |
| Facilitator | `https://facilitator.testnet.x402seek.xyz` | `apps/facilitator` |
| Demo seller | `https://demo-api.testnet.x402seek.xyz` | `apps/demo-seller` |
| Paid resource | `https://demo-api.testnet.x402seek.xyz/summarize` | `apps/demo-seller` |
| Demo buyer | *private network only, no public domain* | `apps/demo-buyer` |

Both public services are Railway custom domains with valid certificates. The
service roots return 404 by design — they are APIs, not web pages. Try:

```bash
curl https://facilitator.testnet.x402seek.xyz/supported
curl https://facilitator.testnet.x402seek.xyz/discovery/resources
curl --get https://facilitator.testnet.x402seek.xyz/discovery/search \
     --data-urlencode 'query=I need something that can condense a long passage of text'
```

Deployment evidence, including the settlement transaction hashes and the
balance deltas, is in [`docs/hosted/`](./docs/hosted/).

## Installation

Requires **Node 22.20.0** (see `.nvmrc`) and **pnpm 10.5.2**.

```bash
nvm use            # or: fnm use — the version in .nvmrc is not optional
corepack enable
pnpm install --frozen-lockfile
```

> `packages/catalog` depends on `better-sqlite3`, a native module. On Node 20 the
> vitest worker segfaults and the run reports zero tests. Use Node 22.

## Running locally

```bash
pnpm --filter @stellar-bazaar/facilitator dev      # watch mode
pnpm --filter @stellar-bazaar/facilitator start
pnpm --filter @stellar-bazaar/demo-seller start
pnpm --filter @stellar-bazaar/mcp-discovery start
```

End-to-end against Stellar testnet (spends testnet funds, needs provisioned
accounts):

```bash
pnpm --filter @stellar-bazaar/e2e-stellar provision
pnpm --filter @stellar-bazaar/e2e-stellar provision:usdc
pnpm --filter @stellar-bazaar/e2e-stellar e2e
pnpm --filter @stellar-bazaar/e2e-stellar mcp
pnpm --filter @stellar-bazaar/e2e-stellar balances
```

## Configuration

Values live in the process environment. Nothing holding a value is committed, and
`.env*` is git-ignored. Names only:

### Facilitator (`apps/facilitator`)

| Variable | Required | Notes |
| --- | --- | --- |
| `SIGNER_SECRET_KEYS` | yes | Comma-separated Stellar signing keys that sign and sponsor. Never logged; `redact()` covers it. |
| `STELLAR_NETWORK` | no | `stellar:testnet` (default) or `stellar:pubnet`. |
| `DEPLOYMENT_NETWORK_LOCK` | recommended | Refuses to boot if it disagrees with `STELLAR_NETWORK`. |
| `STELLAR_RPC_URL` | no | Defaults per network to the public Soroban RPC. |
| `CATALOG_PATH` | no | SQLite file. `:memory:` is non-durable and for tests only. |
| `ARE_FEES_SPONSORED` | no | Advertised in `/supported.extra`. |
| `PORT`, `TRUST_PROXY` | no | `TRUST_PROXY` is `false` by default; behind a proxy it must be the measured hop count. |
| `ENABLE_INTERNAL_METRICS` + `METRICS_TOKEN` | no | **Both** required, or `/internal/metrics` is not routed at all. |

### Demo seller / demo buyer

`ASSET`, `PRICE_AMOUNT`, `DATA_DIR`, `DEMO_ENABLED`, `BALANCE_FLOOR_UNITS`,
`HORIZON_URL`, plus the buyer's own signing key and metrics token. The buyer's
payment parameters — network, scheme, asset, payee, amount, resource — are
server-side constants; the request shape carries no payment field, so a caller
cannot influence what is paid.

## Testing

```bash
pnpm -r typecheck     # tsc --noEmit across the workspace
pnpm -r test          # vitest — 389 tests as of this commit
pnpm audit:licenses   # transitive licence gate
pnpm eval:retrieval   # regenerate the retrieval benchmark
```

All three run in CI on every push to `main` and every pull request
(`.github/workflows/ci.yml`), which also uploads `artifacts/compliance/`.

The licence gate walks the **resolved** dependency graph and reads each licence
from the package as installed on disk. It fails on forbidden licences, on
`unknown`, and on anything needing manual review — an unfamiliar licence string
cannot pass by being unfamiliar.

## Known limitations

- **Testnet only.** Never run this on pubnet. `docs/security-review/pubnet-readiness.md`
  explains why that would be premature.
- **`exact` only.** `upto` is blocked on upstream: two competing PRs
  (x402-foundation/x402 #3098, #3134) write the same spec file and disagree on
  statefulness, facilitator binding and wire field names.
- **Classic accounts only.** Contract accounts are blocked client-side on #3018.
- **No third-party security review.** Deliberately deferred; see
  `docs/security-review/auditor-handoff.md`.
- **No user-controlled wallet payment.** The browser demo pays from the project's
  own testnet buyer, not the visitor's wallet.
- **One paid demo resource.** This proves the loop, not a marketplace.
- **`.well-known/x402` schema is ours, not an upstream standard.** Path
  compatibility is provisional — upstream #2979 claims the same path for a
  different purpose.
- **The retrieval benchmark corpus is synthetic.**
- **Builds are not bit-for-bit reproducible.** Provenance means "this image was
  built from this commit by this platform", not a byte-identical rebuild.

## Security

- Credentials exist only in the deployment platform's variable store, one service
  each. They are never logged, committed, or returned; redaction is tested.
- `/internal/metrics` requires two independent switches and a bearer token
  compared in constant time.
- Rate limits are per-IP; `trustProxy` is a **measured** hop count, not a
  convention. Getting it wrong makes every visitor share one bucket.
- The demo buyer has no public domain. That is a property of the network
  topology, not a rule someone remembers to enforce.
- **Operational rule (SEC-OPS-01):** when probing a service that can spend, use a
  request that cannot pay — `/health`, `/ready`, or a body that fails validation.
  This rule exists because the mistake was made twice, and both unintended
  settlements are disclosed in the evidence.

Full package: [`docs/security-review/`](./docs/security-review/) — threat model,
trust boundaries, security invariants, findings, incident response, reviewer
runbook, and a frozen baseline.

## Documentation

| | |
| --- | --- |
| [`docs/hosted/STATUS.md`](./docs/hosted/STATUS.md) | Current posture: what is proven, what is not |
| [`docs/hosted/`](./docs/hosted/) | `HOSTED-E-01`…`E-08`, evidence from operating in public |
| [`docs/security-review/`](./docs/security-review/) | Twelve-document audit package |
| [`docs/research/`](./docs/research/) | Retrieval evaluation, upstream landscape audit |
| [`docs/scf/`](./docs/scf/) | SCF #45 RFP submission, frozen at `762c6e6` |
| [`docs/security/catalog-ownership-model.md`](./docs/security/catalog-ownership-model.md) | Listing-hijack defence |

Every technical claim in `docs/scf/proposal.md` traces to
`docs/scf/evidence-log.md` by E-number, cross-checked in
`docs/scf/proposal-claim-matrix.md`.

## Licence

[Apache-2.0](./LICENSE). Every runtime dependency is permissively licensed and
the CI gate keeps it that way.
