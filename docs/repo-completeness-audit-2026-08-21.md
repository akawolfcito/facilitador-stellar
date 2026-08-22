# Repository completeness audit — 2026-08-21

Scope: whether `akawolfcito/facilitador-stellar` accurately and completely
represents work that is already shipped. No evidence was manufactured; nothing
was added to improve a score that is not independently true.

Audited at `1003644` (`feat/hosted-testnet-facilitator`), changes landed at
`b5ac05f`.

---

## 1. Completeness before

| Signal | Status | Evidence |
| --- | --- | --- |
| Description | `MISSING_BUT_TRUE_TO_ADD` | `gh repo view` → `"description": ""` |
| Topics | `MISSING_BUT_TRUE_TO_ADD` | `"repositoryTopics": null` |
| Release | `RELEASE_JUSTIFIED` — not published | `git tag -l` empty, `gh release list` empty |
| Deployed / Homepage | `MISSING_BUT_TRUE_TO_ADD` | `"homepageUrl": ""`, while three public URLs answer 200 |
| License | `MISSING_BUT_TRUE_TO_ADD` | `"licenseInfo": null`, no `LICENSE` file, Apache-2.0 declared in 9 of 10 manifests |
| README | **ABSENT** | no `README.md` anywhere in the tree or in git history |

## 2. What the project actually does

A pnpm/TypeScript monorepo, Node 22, implementing an x402 payment facilitator
for Stellar plus the discovery layer x402 leaves unspecified.

| Component | What it is |
| --- | --- |
| `apps/facilitator` | Fastify service. `/supported`, `/verify`, `/settle` via `@x402/stellar`; `/discovery/resources`, `/discovery/search`; `/health`, `/ready`; `/internal/metrics` routed only when two switches are set |
| `packages/catalog` | SQLite catalog, canonicalisation, wire encoding, `.well-known/x402` ownership verifier and precedence |
| `packages/search` | Local ONNX MiniLM embedder, hybrid ranking, abstention at 0.22 cosine. No hosted model API |
| `packages/retrieval-eval` | 65-document synthetic corpus, 56 queries, dev/held-out split, four retrievers |
| `apps/mcp-discovery` | MCP server exposing `bazaar_search` and `bazaar_pay_and_call` |
| `apps/demo-seller` | One paid resource, `/summarize`, and its `.well-known/x402` declaration |
| `apps/demo-buyer` | Server-side demo payer with a UTC daily budget, reserve-before-sign ledger and a kill switch. No public domain |
| `apps/e2e-stellar` | Provisioning and end-to-end runs against testnet |
| `scripts/audit-licenses.mts` | Transitive licence gate over the resolved graph; fails on forbidden, unknown or review-needed licences |

**Measured retrieval quality** (`artifacts/retrieval-eval/latest.json`):

| Retriever | dev nDCG@10 | held-out nDCG@10 |
| --- | --- | --- |
| `baseline-includes` | 0.2433 | 0.2258 |
| `bm25` | 0.8019 | 0.8297 |
| `dense` | 0.9307 | 0.9534 |
| `hybrid-rrf` | 0.9056 | 0.9349 |

Corpus is synthetic; the README says so.

## 3. Public deployment — verified live 2026-08-21

| URL | Code | TLS | Result |
| --- | --- | --- | --- |
| `https://x402seek.xyz` | 200 | `ssl_verify_result: 0` | serves the x402Seek site |
| `https://facilitator.testnet.x402seek.xyz/health` | 200 | valid | `{"ready":true,"network":"stellar:testnet","catalog":1,"indexed":1}` |
| `https://facilitator.testnet.x402seek.xyz/supported` | 200 | valid | `exact` / `stellar:testnet`, `areFeesSponsored: true` |
| `https://facilitator.testnet.x402seek.xyz/discovery/resources` | 200 | valid | one listing, the demo seller |
| `https://demo-api.testnet.x402seek.xyz/health` | 200 | valid | `x402seek-demo-seller`, `stellar:testnet` |
| `https://facilitator.testnet.x402seek.xyz/` | 404 | valid | API root, by design — **not usable as a homepage** |
| `https://demo-api.testnet.x402seek.xyz/` | 404 | valid | same |

The demo buyer has no public domain and was not probed. Probing was confined to
`/health`, `/supported` and `/discovery/*` — never a route that can spend — per
the repository's own SEC-OPS-01 rule.

Homepage resolution: `x402seek.xyz` is built from a separate repository
(`x402seek-web`) and calls this repository's services. Owner chose it as the
homepage; the README states the split explicitly so the relationship is not
misread.

## 4. Security and hygiene — clean

| Check | Result |
| --- | --- |
| Tracked `.env*` files | none, now or ever in history |
| Stellar signing keys (`S…`, 56 chars) | zero matches across all tracked files |
| Hardcoded credential literals | none |
| Long opaque literals in source | only public `G…`/`C…` addresses and clearly-synthetic fixtures (`GAMETEO4…`, `GALINGUA5…`) |
| `.gitignore` coverage | `.env`, `.env.*`, `private/`, model caches, local catalog DBs |
| Secrets documentation | `docs/security-review/deployment-and-secrets.md` lists them **by name only**, with rotation impact and blast radius |
| Private URLs in new content | none. No `*.railway.app`, no internal hosts, no admin endpoints |

`/internal/metrics` is documented as existing but is not exposed: it requires
`ENABLE_INTERNAL_METRICS` **and** `METRICS_TOKEN`, and the live facilitator
returns 404 for it. Naming it in the README discloses nothing an attacker could
use and is honest about the surface.

**No security issue was found. No publication step was blocked.**

## 5. Changes made

### Repository files

| File | Change | Justification |
| --- | --- | --- |
| `README.md` | created, 276 lines | The repository had none. Content is drawn from source, `artifacts/retrieval-eval/latest.json`, `docs/hosted/` and live probes. Status banner and "Known limitations" mirror `docs/hosted/STATUS.md` so the README cannot outrun the evidence |
| `LICENSE` | created, canonical Apache-2.0, md5 `86d3f3a95c324c9479bd8986968f4327` | Apache-2.0 was already the licence — root `package.json`, 8 workspace manifests, the CI allow-list, and `docs/scf/rfp-compliance-matrix.md`. Only the text was missing, which is why GitHub reported none. Approved by the owner before the file was written |
| `apps/demo-buyer/package.json` | added `"license": "Apache-2.0"` | The one manifest of ten that omitted the field |
| `docs/repo-completeness-audit-2026-08-21.md` | this file | Record of what was checked and why each change is true |

Commits `1c93651` and `b5ac05f` on `feat/hosted-testnet-facilitator`, pushed.

Not touched: `SESSION.md` (already modified before this audit) and
`docs/scf/proposal-reading-pass.md` (deliberately untracked). `artifacts/compliance/`
was regenerated by running the gate and reverted — the only delta was a timestamp.

### GitHub metadata

| Field | Value | Justification |
| --- | --- | --- |
| Description | "x402 payment facilitator for Stellar with a discovery layer: exact USDC settlement on Soroban with sponsored fees, automatic cataloging on settlement, semantic search with abstention, and an MCP server for agents. Live on Stellar testnet." | Every clause maps to shipped code. "Live on Stellar testnet" is scoped deliberately; no production or mainnet claim |
| Homepage | `https://x402seek.xyz` | Verified 200. Owner-approved. The service roots 404 and an internal health endpoint was never a candidate |
| Topics (14) | `x402`, `stellar`, `soroban`, `usdc`, `payments`, `facilitator`, `mcp`, `model-context-protocol`, `ai-agents`, `semantic-search`, `typescript`, `fastify`, `sqlite`, `onnx` | Each names something present |

**Topics deliberately excluded:** `celo` (nothing Celo in the repository),
`wallet` (no wallet is implemented; the demo buyer holds a key, which is not the
same thing), `web3` (too vague to be a description of anything here).

Topics that *were* used from the caution list are used because they are literally
true: `@x402/core` and `@x402/stellar` are direct dependencies (`x402`,
`payments`); the chain is Stellar/Soroban (`stellar`); `apps/mcp-discovery` runs
`@modelcontextprotocol/sdk` (`mcp`, `ai-agents`).

## 6. Completeness after

| Signal | Status |
| --- | --- |
| Description | `PRESENT` |
| Topics | `PRESENT` (14) |
| Release | `RELEASE_JUSTIFIED` — proposed below, **not published** |
| Deployed / Homepage | `PRESENT` — `https://x402seek.xyz`, verified 200 |
| License | `PRESENT in the tree`, still `null` on GitHub until `main` carries it |
| README | `PRESENT in the tree`, not yet on the default branch |

## 7. The one structural finding

**GitHub's landing page shows `main`, and `main` is 34 commits behind.**

```
$ git rev-list --left-right --count origin/main...HEAD
0    34
```

Absent from `main` today: `apps/demo-buyer`, `packages/catalog/src/ownership`,
`docs/hosted/`, `docs/security-review/` — and now `README.md` and `LICENSE`.

The README was **not** committed to `main`, on purpose: it describes the demo
buyer, the `.well-known/x402` ownership binding and the hosted evidence, none of
which exist there. Putting it on `main` would have made the README describe work
the branch does not contain — which is the exact failure this audit exists to
prevent.

Consequence: description, homepage and topics are live now, but the README and
the licence badge will stay invisible to a visitor, and `licenseInfo` will stay
`null`, until `feat/hosted-testnet-facilitator` reaches `main`.

## 8. Release proposal — not published

`RELEASE_JUSTIFIED`. Not because a release is scored, but because there is a
coherent shipped milestone with a boundary someone drew on purpose: two features
formally frozen, a security remediation closed, and an audit baseline written.

| | |
| --- | --- |
| Tag | `v0.1.0-testnet` |
| Title | `v0.1.0-testnet — facilitator, discovery and hosted operation on Stellar testnet` |
| Target | `b5ac05f` — or the merge commit on `main`, which is cleaner |
| Prerelease | **yes**. The scope is testnet and the repository refuses to call itself production anywhere else; the release must not be the one place it does |

Draft notes:

> First tagged milestone. **LIVE TESTNET** — `stellar:testnet` only, `exact`
> only, classic `G…` accounts only, no third-party security review.
>
> **Settlement.** `exact` USDC on Stellar testnet through `@x402/stellar`, with
> the facilitator sponsoring every network fee — in a recorded nine-payment run
> the buyer's XLM balance changed by exactly zero.
>
> **Discovery.** A settled payment catalogs its resource automatically. The
> catalog and its search index are SQLite-backed and rehydrate on boot. Natural
> language queries are answered by a local ONNX MiniLM embedder with hybrid
> ranking, and the engine abstains below 0.22 cosine rather than hand a paying
> agent its nearest neighbour. On a 65-document benchmark with a held-out split,
> dense retrieval reaches 0.953 nDCG@10 against 0.226 for the upstream substring
> matcher.
>
> **Agents.** An MCP server exposing `bazaar_search` and `bazaar_pay_and_call`.
>
> **Resource ownership.** `.well-known/x402` domain binding with a verifier and
> a precedence rule, frozen as x402Seek Resource Ownership Convention v1 and
> demonstrated live including the negative case (`HOSTED-E-08`). The schema is
> ours, not an upstream standard.
>
> **Operated in public.** Facilitator and demo seller run on Stellar testnet
> behind TLS. Evidence `HOSTED-E-01`…`E-08` records the deployment, the canonical
> settlement, balance deltas, cataloging, search, restart survival, the first
> browser-triggered settlement and the ownership binding.
>
> **Security.** A twelve-document review package with a frozen baseline; SR-01
> (shared rate-limit bucket behind the proxy) and SR-02 (non-constant-time token
> compare) closed. No third-party audit has been performed.
>
> **Verification.** 389 tests, typecheck clean, transitive licence gate green on
> Node 22.20.0.
>
> **Not in this release:** pubnet, the `upto` scheme, contract accounts,
> user-controlled wallet payment.

## 9. Validation

| Check | Result |
| --- | --- |
| `pnpm -r typecheck` | exit 0, clean |
| `pnpm -r test` | **389 passed, 0 failed** (15 + 84 + 83 + 26 + 51 + 91 + 39) |
| `pnpm audit:licenses` | PASSED — runtime graph permissively licensed, 244 resolved packages |
| `git diff` review | only the four intended files; timestamp-only compliance churn reverted |
| README internal-link check | all 13 relative targets exist |
| README content scan | no `*.railway.app`, no internal hosts, no addresses, no key material |
| Public URL re-check | all endpoints above re-probed after the metadata change; unchanged |
| GitHub metadata re-check | description, homepage and 14 topics confirmed set |

**Environment note, not a repository defect.** `pnpm -r test` fails on the local
shell's Node v20.19.5: `better-sqlite3` is a native module and its vitest worker
exits before a single test runs, reporting `Tests (83)` with no pass count. On
`.nvmrc`'s Node 22.20.0 everything passes. CI already pins `node-version-file:
.nvmrc`, so CI was never affected. The README now warns about it, because
"0 tests, 4 unhandled errors" is an alarming thing for a new contributor to hit
and the cause is not obvious.
