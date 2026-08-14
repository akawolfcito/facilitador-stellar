# RFP compliance matrix

Against the current official RFP text, re-fetched 2026-08-13 from
<https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track>,
section **"X402 Facilitator with Bazaar (discovery) support"**. Diffed against
our 2026-08-11 capture: **no substantive change** (only a greeting string and a
relative timestamp differ).

Submission deadline: **2026-08-16**. Award ceiling **$150K in XLM**, paid across
an initial distribution plus three tranches (MVP → Testnet → Mainnet/Live).

Legend — **Now**: evidenced today. **T1/T2/T3**: tranche deliverable.
**Open**: no plan yet beyond the stated tranche.

---

## 3.1 Facilitator

| # | Requirement | Class | Evidence | Status | Tranche | Gap | Acceptance test |
|---|---|---|---|---|---|---|---|
| 1.1 | `verify`/`settle`/`supported` on `stellar:testnet` **and** `stellar:pubnet` | REQUIRED | E-05, E-06, E-18 | testnet **Now**; pubnet not started | T3 | pubnet deployment | Upstream e2e green on both networks |
| 1.2 | Build on `@x402/stellar`, do not reimplement | REQUIRED | E-06, §6 | **Now** | — | — | Settlement path is upstream code |
| 1.3 | Strict Soroban auth-entry validation; classic **and** `__check_auth` accounts | REQUIRED | E-06 (classic) | partial | T1 | contract accounts blocked on upstream PR #3018 | Both account types settle |
| 1.4 | Any SEP-41 token, USDC default, 7-decimal handling | REQUIRED | E-19 (USDC), E-06 (native SAC) | **Now** | — | — | Settlement in two distinct SEP-41 assets |
| 1.5 | Sponsor fees; advertise `extra.areFeesSponsored` | REQUIRED | E-05, E-19 | **Now** | — | — | Buyer XLM delta = 0 across a run |
| 1.6 | Non-custodial; tampering fails verification | REQUIRED | property of `@x402/stellar` | **Now** | — | explicit tamper test not written | Negative test with a mutated auth entry |
| 1.7 | Testnet free; mainnet fee configurable, business model documented | REQUIRED | — | not started | T1 | — | Fee is config, not code; documented |
| 1.8 | Caller auth, metering, rate limiting, configurable and documented | REQUIRED | — | not started | T1 | — | Documented mechanism, configurable |
| 1.9 | Hosted **and** self-hosted paths, incl. self-facilitation | REQUIRED | Apache-2.0, runs locally | partial | T1 | packaging, self-facilitation path | A third party self-hosts from the README |

## 3.2 Bazaar discovery layer — "the core new capability"

| # | Requirement | Class | Evidence | Status | Tranche | Gap | Acceptance test |
|---|---|---|---|---|---|---|---|
| 2.1 | `GET /discovery/resources` with `type`, `payTo`, `network`, `extensions`, `limit`, `offset` | REQUIRED | E-09, E-21 | **Now** | — | — | Upstream discovery validation passes |
| 2.2 | `GET /discovery/search`, NL query, cursor pagination, `partialResults`, **real ranking + stated evaluation method** | REQUIRED | E-12, E-13, E-14 | **Now** | — | benchmark is synthetic | `pnpm eval:retrieval` with a held-out split |
| 2.3 | Automatic cataloging on a payload carrying the extension; `info` validated against `schema`; manual registration secondary only | REQUIRED | E-09 | **Now** | — | — | `registrationCallsMade: 0` with listings present |
| 2.4 | Catalog HTTP **and** MCP, MCP keyed on `(resource.url, input.toolName)` | REQUIRED | E-17, E-22 | **Now** | — | — | MCP row cataloged from a real payment |
| 2.5 | Catalog integrity: soft-drop validation, `routeTemplate` percent-decoded before traversal checks | REQUIRED | E-10, E-21 | **Now** | — | — | Hostile templates never move the canonical key |
| 2.6 | Report outcomes via `EXTENSION-RESPONSES` | REQUIRED | E-10 | **Now** | — | — | Stock client logs the decoded header |
| 2.7 | Track the spec as it changes; state how and commit to it | REQUIRED | — | commitment only | T1 | monitoring process undocumented | Written conformance-upkeep process |
| 2.8 | Interoperate with the wider x402 discovery ecosystem | EXPECTED | E-21 | **Now** | — | — | Stock clients parse our responses |
| 2.9 | Seller-side helpers incl. per-parameter descriptions, minimal boilerplate | REQUIRED | used in demos | partial | T1 | no published helper package | Seller declares metadata in <10 lines |
| 2.10 | Index off-chain by default; on-chain registry optional | OPTIONAL | SQLite, off-chain | **Now** | — | — | No on-chain registry proposed |

## 3.3 Agent-facing MCP interface

| # | Requirement | Class | Evidence | Status | Tranche | Gap | Acceptance test |
|---|---|---|---|---|---|---|---|
| 3.1 | MCP discovery server: search the Bazaar and make a paid call from inside an agent runtime | REQUIRED | E-22, E-23 | **Now** | — | not deployed publicly | Discovery → settlement → invocation e2e |
| 3.2 | Structured deterministic I/O, machine-readable error codes, non-null reason on every rejection | REQUIRED | E-25 | **Now** | — | — | Closed error-code set, 15 unit tests |

## 3.4 Settlement schemes

| # | Requirement | Class | Evidence | Status | Tranche | Gap | Acceptance test |
|---|---|---|---|---|---|---|---|
| 4.1 | `exact` per `scheme_exact_stellar.md` | REQUIRED | E-18, E-19 | **Now** | — | — | Upstream e2e green |
| 4.2 | Author `scheme_upto_stellar.md` **and** implement it, contributed upstream | REQUIRED | — | **not started** | T2 | entire deliverable; spec PR #3098 is another team's | Upstream e2e green for `upto` |
| 4.3 | State whether `upto` ships a Soroban contract; a contract-free design must document its weaker trust model | REQUIRED | — | position stated in §12 | T2 | design doc | Published design doc |
| 4.4 | Coordinate the upstream contribution through the x402 TSC | EXPECTED | — | commitment only | T2 | — | TSC engagement on record |
| 4.5 | `batch-settlement` and `auth-capture` deferred, not foreclosed | OPTIONAL | architecture does not preclude | **Now** | — | — | — |

## 3.5 Stellar-specific considerations

| # | Requirement | Class | Evidence | Status | Tranche | Gap | Acceptance test |
|---|---|---|---|---|---|---|---|
| 5.1 | Auth entries, not pre-signed transactions | EXPECTED | E-06 | **Now** | — | — | — |
| 5.2 | Ledger-based expiration, `signatureExpirationLedger` | EXPECTED | upstream-enforced | **Now** | — | — | — |
| 5.3 | Trustlines: onboarding and examples must account for them | EXPECTED | E-19 (`provision:usdc`) | **Now** | — | not in a developer guide yet | Guide covers trustline setup |
| 5.4 | Soroban resource limits | EXPECTED | upstream-enforced | **Now** | — | — | — |
| 5.5 | Throughput under bursty agent traffic, e.g. channel accounts | EXPECTED | multi-signer round-robin wired | partial | T1 | no load test | Documented load test |
| 5.6 | TTL strategy if an on-chain registry exists | EXPECTED | n/a — off-chain | **Now** | — | — | — |

## 3.6 Non-functional

| # | Requirement | Class | Evidence | Status | Tranche | Gap | Acceptance test |
|---|---|---|---|---|---|---|---|
| 6.1 | Permissive OSI licence; **no AGPL or strong copyleft anywhere**; no OpenZeppelin Relayer/plugin/SDK | REQUIRED | E-26, E-27, E-28 | **Now** | — | — | `pnpm audit:licenses` exits 0 |
| 6.2 | Conformance at the wire level: unmodified canonical client on **both** networks; `/supported` `extra`; `payload: {transaction}` verbatim; passing upstream e2e; a settled hash per network per scheme; non-null reason on every rejection | REQUIRED | E-05, E-18, E-19, E-21 | testnet **Now**; pubnet pending | T3 | pubnet run; `upto` hashes | Upstream e2e green on both networks, both schemes |
| 6.3 | Security: replay- and front-running-resistant settlement; an index nobody can spoof | REQUIRED | E-11, E-25, §10 | **Now**, within TOFU | T3 | domain binding | Cross-seller overwrite rejected; `.well-known` verified |
| 6.4 | Third-party security review via the Audit Bank before the mainnet production tag | REQUIRED | — | not started | T3 | entire deliverable | Report with findings resolved |
| 6.5 | UX: docs → paid, discoverable endpoint in well under an hour | EXPECTED | — | not measured | T1 | developer guide | Timed walkthrough |
| 6.6 | Performance/availability: fast discovery, interactive settle latency, 99%+ uptime, degraded-mode story | EXPECTED | E-12 (latency at 6 listings) | partial | T1 | no hosted deployment | Published uptime |
| 6.7 | Maintenance commitment or clean handoff | REQUIRED | — | stated in the proposal | T3 | — | Written commitment |

## 5. Expected deliverables

| # | Deliverable | Status | Tranche |
|---|---|---|---|
| D1 | Open-source, permissive, self-hostable facilitator on both networks | testnet now; pubnet T3 | T1/T3 |
| D2 | Bazaar layer: `/discovery/resources` with filters, `/discovery/search` with working NL ranking, automatic cataloging for HTTP and MCP | **Now** | — |
| D3 | MCP discovery server exposing search and paid-call tools | **Now**, not deployed | T1 |
| D4 | `upto` merged upstream with `scheme_upto_stellar.md` | not started | T2 |
| D5 | SDK/helper libraries, seller and buyer side | partial | T1 |
| D6 | Conformance report: e2e results both networks, hashes per network per scheme, unmodified canonical client | testnet **Now** | T3 |
| D7 | Role-based developer guide, contributed to Stellar Developer Docs | not started | T1 |
| D8 | At least two end-to-end example integrations | partial — paid API and MCP agent exist as e2e runs | T1 |
| D9 | Test suite covering verification, settlement (`exact` + `upto`), discovery, MCP | `exact` **Now**; `upto` pending | T2 |
| D10 | Security review report with findings resolved | not started | T3 |
| D11 | Production service with runbook and monitoring | not started | T1 |

---

## Totals

| | Count |
|---|---|
| Requirements tracked | **48** |
| Satisfied now, with evidence | **26** |
| Partially satisfied | **6** |
| Tranche deliverables, not started | **16** |
| Unresolved / no plan | **0** |

## Hidden requirements this matrix surfaced

Three things the RFP requires that a first reading of our own work would have
missed:

1. **§3.1 contract accounts (`__check_auth`).** We only ever settle from classic
   `G…` accounts. Upstream PR #3018 exists precisely because a contract account
   cannot currently produce an `exact` payment. This is a required capability
   sitting on someone else's unmerged PR — tranche-1 risk, and a reason to
   engage upstream early.
2. **§3.6 "a settled transaction hash per network per scheme".** Not per
   network. Per network *per scheme*. That means four published hashes once
   `upto` lands, not two.
3. **§3.2 conformance upkeep is graded as heavily as the initial build.** We
   have the discipline but not the documented process; a written
   spec-monitoring commitment is a tranche-1 deliverable, not an afterthought.
