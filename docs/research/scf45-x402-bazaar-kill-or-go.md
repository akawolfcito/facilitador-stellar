# SCF #45 — Stellar x402 Facilitator + Bazaar
## Kill-or-Go Technical Audit

> Audit date: 2026-08-11. All evidence gathered read-only from primary sources.
> x402 monorepo pinned at commit `c8247c4cd15f29498474404d94636e7dbb894e86` (2026-08-11 23:49 +0200), packages at version `2.22.0`.
> Submission deadline per SCF awards page: **2026-08-16** (not Aug 17). Award ceiling **$150K in XLM**, 3 tranches (MVP → Testnet → Mainnet/Live).

---

### 1. Executive verdict

**CONDITIONAL GO — narrow wedge only. NO-GO on "build a facilitator".**

1. The technical gap is real and the RFP states it correctly: Stellar has `exact` settlement and **no Bazaar**.
2. But the gap is **already occupied**. At least two teams have been executing it publicly since July 31 / Aug 8, with live testnet proof and upstream x402 contributions.
3. Aug 16 is a **grant-proposal deadline, not a delivery deadline** — tranches map MVP→testnet→mainnet over months. Building a facilitator in 5 days wins nothing.
4. The only unclaimed high-value item is the one the RFP calls the hardest and weights heaviest: **natural-language search quality plus a stated method for evaluating it over time**.
5. Second unclaimed item: the **`upto` Soroban implementation** (the spec PR is open by a competitor; the implementation is not).
6. Reusing OpenZeppelin is dead on arrival — AGPL-3.0, explicitly disqualified by the RFP.
7. **Condition:** proceed only if the submission is positioned as *retrieval quality + `upto` implementation*, not as another facilitator. Otherwise NO-GO.

---

### 2. RFP requirement matrix

Source for every row: `https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track`, section **"X402 Facilitator with Bazaar (discovery) support"**, subsections 1–5. Line numbers refer to the extracted plain text (`rfp.txt`, 544 lines) captured 2026-08-11.

| # | Requirement | Exact source | Existing implementation | Gap | Our responsibility | Class |
|---|---|---|---|---|---|---|
| R1 | `verify`/`settle`/`supported` on `stellar:testnet` **and** `stellar:pubnet` | §3.1, L253–259 | `@x402/stellar` 2.22.0 supports both networks; SDF `examples/facilitator` exposes the surface | None on testnet; **no public pubnet facilitator exists** | Deploy + operate | REQUIRED |
| R2 | Build on `@x402/stellar`, do not reimplement verify/settle | §1 L221–223; §5 L446 | Apache-2.0, `typescript/packages/mechanisms/stellar` | None | Consume as dependency | REQUIRED |
| R3 | Strict Soroban auth-entry validation; classic keypairs **and** `__check_auth` contract accounts | §3.1, L261–263 | `exact/facilitator/scheme.ts`; contract-account signing is **broken upstream** (PR #3018 open, `invalid version byte. expected 48, got 16`) | Contract accounts | Depend on / help land #3018 | REQUIRED |
| R4 | Any SEP-41 token, USDC default, 7-decimal handling | §3.1, L265 | `@x402/stellar` `utils.ts` / `constants.ts` | None | Config surface | REQUIRED |
| R5 | Sponsor fees; advertise `extra.areFeesSponsored` | §3.1, L267–269 | Live on x402.org facilitator (verified, see §4) | None | Reproduce | REQUIRED |
| R6 | Non-custodial; tampering fails signature verification | §3.1, L271 | Property of `@x402/stellar` | None | Test coverage | REQUIRED |
| R7 | Testnet free; mainnet fee configurable not hard-wired; document business model | §3.1, L273 | n/a | All | Build | REQUIRED |
| R8 | Caller auth / metering / rate limiting, configurable | §3.1, L275 | n/a | All | Build | REQUIRED |
| R9 | Hosted **and** self-hosted paths, incl. self-facilitation inside a resource server | §3.1, L277–279 | SDF repo has Dockerfile; no self-facilitation packaging | Partial | Build | REQUIRED |
| R10 | `GET /discovery/resources` with `type`,`payTo`,`network`,`extensions`,`limit`,`offset` | §3.2, L285–298 | Spec §"Optional Discovery Endpoints"; example impls in Go/Python/TS `examples/*/facilitator/advanced/bazaar.*` | No Stellar-native one | Build | REQUIRED |
| R11 | `GET /discovery/search`, NL `query`, **cursor** pagination, `partialResults`, **real ranking + a stated quality-evaluation method** | §3.2, L300–305 | Reference impl is substring match over a `Map` (see §6) | **Total** | Build — this is the wedge | REQUIRED |
| R12 | Automatic cataloging on `PaymentPayload` carrying the extension; validate `info` against `schema`; manual registration secondary only | §3.2, L307–311 | `validateAndExtract`, `extractDiscoveryInfo` in `@x402/extensions/bazaar/facilitator.ts` | Storage/index absent | Build index; reuse validation | REQUIRED |
| R13 | Catalog HTTP **and** MCP tools, keyed on `(resource.url, input.toolName)` | §3.2, L313–317 | `bazaar/mcp/resourceService.ts`; **canonical MCP URL is buggy upstream — issue #3121** | Partial | Build + upstream fix | REQUIRED |
| R14 | Catalog integrity: soft-drop validation, `routeTemplate` percent-decode before traversal checks | §3.2, L319–325 | `isValidRouteTemplate`, `validateRouteTemplate`, `sanitizeResourceServiceMetadata` exported | Mostly reusable | Wire + test | REQUIRED |
| R15 | Report outcomes via `EXTENSION-RESPONSES` header | §3.2, L327–329 | Spec defines `status` ∈ success/processing/rejected + `rejectedReason` | Absent in Stellar stack | Build | REQUIRED |
| R16 | Track spec changes; commit to conformance upkeep through the grant | §3.2, L331; §3.6 L391–400 | n/a | All | Process commitment | REQUIRED |
| R17 | Interoperate: Stellar listings representable consistently with other facilitators | §3.2, L333 | No federation exists (see §8) | Schema-level only | Conform to shapes | EXPECTED |
| R18 | Seller-side helpers incl. per-parameter descriptions, minimal boilerplate | §3.2, L335 | `declareDiscoveryExtension`, `bazaarResourceServerExtension` | Thin wrapper only | Build | REQUIRED |
| R19 | Index off-chain by default; on-chain Soroban registry is optional stretch | §3.2, L337 | n/a | n/a | Design decision (say no) | OPTIONAL |
| R20 | MCP discovery server: search tool + paid-call proxy inside an agent runtime | §3.3, L339–341 | `@x402/mcp` package exists; no Stellar discovery server | All | Build | REQUIRED |
| R21 | Structured deterministic I/O, machine-readable error codes, **non-null reason on every rejection** | §3.3, L343; §3.6 L400 | n/a | All | Build | REQUIRED |
| R22 | `exact` per `scheme_exact_stellar.md` | §3.4, L347–350 | `specs/schemes/scheme_exact_stellar.md` (11.2K) + impl | None | Consume | REQUIRED |
| R23 | `upto` for Stellar: author `scheme_upto_stellar.md` **and** the implementation, contributed upstream | §3.4, L352–355 | **File does not exist** in `specs/schemes/` (only `_evm`, `_svm`). Spec PR **#3098 open since 2026-08-08 by `Eras256`** — docs only, no implementation | **Implementation totally open** | Build — second wedge | REQUIRED |
| R24 | State whether `upto` ships a Soroban contract; contract-free design must document weaker trust model | §3.4, L355 | PR #3098 argues a contract is mandatory (SEP-41 allowance fails recipient-binding + single-use MUSTs) | n/a | Design + build contract | REQUIRED |
| R25 | Coordinate upstream via x402 TSC | §3.4, L357 | `TSC.md` in repo | n/a | Process | EXPECTED |
| R26 | `batch-settlement` and `auth-capture` deferred, do not foreclose | §3.4, L359–364 | n/a | n/a | Architecture note | OPTIONAL |
| R27 | Stellar specifics: auth entries not pre-signed txs; `signatureExpirationLedger` ≈12 ledgers/60s; trustlines; Soroban resource limits; throughput via channel accounts; TTL | §3.5, L366–384 | SDF repo ships `scripts/generate-channel-accounts.ts` | Reusable pattern | Demonstrate understanding | EXPECTED |
| R28 | **Permissive OSI licence; no AGPL anywhere in the dependency path.** OZ Relayer + its x402 plugin + relayer SDK explicitly named as out | §3.6, L388–389; Appendix L502–507 | **Verified: `OpenZeppelin/openzeppelin-relayer` is `AGPL-3.0`** | n/a | Apache-2.0, audit deps | REQUIRED |
| R29 | Conformance tested at wire level: unmodified canonical client completes payment on both networks; `/supported` emits Stellar `extra` incl. `areFeesSponsored`; `payload: {transaction}` accepted verbatim; **passing run of the x402 repo e2e suite for both networks**; published settled tx hash per network per scheme; non-null reason on every rejection | §3.6, L391–400 | `e2e/` harness exists; `e2e/config/mechanisms_stellar.json` already declares route `/exact/stellar` with `"extensions": ["bazaar"]`; `e2e/extensions/bazaar.ts` (22.4K) is the discovery conformance validator | Runnable today | **Run it — cheapest high-signal evidence** | REQUIRED |
| R30 | Security: replay + front-running resistant settlement; index that cannot spoof another seller's listing or pricing | §3.6, L402–403 | n/a | All | Build (see §13) | REQUIRED |
| R31 | Third-party security review via **Audit Bank** before mainnet production tag | §3.6, L405–408 | n/a | All | Tranche 3 | REQUIRED |
| R32 | UX: docs → paid, discoverable endpoint in under an hour | §3.6, L410–411 | n/a | All | Build | EXPECTED |
| R33 | Perf/availability: 99%+ uptime on public endpoints, degraded-mode story | §3.6, L413–414 | n/a | All | Build | EXPECTED |
| R34 | Post-grant maintenance commitment or clean handoff | §3.6, L416–417 | n/a | All | Proposal text | REQUIRED |
| R35 | Role-based developer guide modeled on the Algorand x402 developer hub (seller / buyer+agent / operator paths), each linking live testnet examples, contributed to Stellar Developer Docs | §5, L464–466 | n/a | All | Build | REQUIRED |
| R36 | ≥2 end-to-end example integrations (paid API discovered+paid by an agent; MCP agent discovering and paying with no pre-baked integration) | §5, L468 | n/a | All | Build | REQUIRED |
| R37 | Test suite: verification, settlement (`exact` + `upto`), discovery, MCP | §5, L470–474 | n/a | All | Build | REQUIRED |
| R38 | Production service with operational runbook and monitoring | §5, L478 | n/a | All | Build | REQUIRED |
| **Ambiguities** | | | | | | |
| A1 | How many teams are funded per RFP | Not stated. The sibling LayerZero DVN RFP explicitly says "Fund one or more teams" (L129); the x402 RFP says "a bidder" (L248) and never pluralises | — | — | Assume **single award** | AMBIGUOUS |
| A2 | "Interoperate with the wider x402 discovery ecosystem" (L333) — federation or schema parity? | Spec has no federation primitive (§8) | — | — | Read as schema parity | AMBIGUOUS |
| A3 | Whether anything must be *deployed* at submission time | §"Process & Timeline" L523–538 describes form → review → tranches. Tranche names on the awards page are MVP / Testnet / Mainnet | — | — | **Nothing must be live at submission** | AMBIGUOUS→resolved |

**Eligibility / process (§"Process & Timeline", L523–538; RFP Track general section):**
- Submit the SCF Interest form, indicate RFP Track → invited to a Build round → submit Build form naming the open RFP.
- Reviewed by **2 delegates** from the quarter's Category Delegate Panel; disagreement adds a third.
- Must address an RFP **from the current quarter** (Q3 RFPs opened 2026-07-23 for SCF #45).
- Must state licensing scheme, commitment to building in the open, decentralisation approach, infrastructure, and user-tracking/protection plans.
- Must use the most recent stable release of the Stellar stack.
- Tranche cadence: each subsequent tranche within **90 days** of the previous payment; miss it without notice and the remainder is forfeited.

---

### 3. Existing architecture

```
                                 ┌──────────────────────────────────────────┐
                                 │  x402-foundation/x402  (Apache-2.0)      │
                                 │                                          │
   ┌── seller ──────────┐        │  @x402/core        protocol types        │
   │ @x402/http mw      │◄───────┤  @x402/stellar     exact ONLY  (2.22.0)  │
   │ declareDiscovery   │        │  @x402/extensions  bazaar HELPERS ONLY   │
   │   Extension()      │        │  @x402/mcp         MCP plumbing          │
   └─────────┬──────────┘        │  specs/extensions/bazaar.md              │
             │ 402 + extensions  │  specs/schemes/scheme_exact_stellar.md   │
             │                   │  specs/schemes/scheme_upto_{evm,svm}.md  │
             ▼                   │  specs/schemes/scheme_upto_stellar.md ✗  │
   ┌────────────────────┐        │  e2e/  + e2e/extensions/bazaar.ts        │
   │  buyer / agent     │        └──────────────────────────────────────────┘
   │  @x402/*/client    │
   └─────────┬──────────┘
             │ X-PAYMENT (auth entry)
             ▼
   ┌───────────────────────────────┐        ┌──────────────────────────────┐
   │ FACILITATOR (pick one today)  │        │  x402.org facilitator        │
   │                               │        │  /supported → stellar:testnet│
   │ a) SDF stellar/x402-stellar   │        │      extra.areFeesSponsored  │
   │    examples/facilitator       │        │        = true      ✔ VERIFIED│
   │    Apache-2.0, channel accts  │        │  /discovery/resources → 404  │
   │    discovery: NONE            │        │        ✗ VERIFIED            │
   │                               │        └──────────────────────────────┘
   │ b) "Built on Stellar" hosted  │
   │    = OZ Relayer x402 plugin   │   ◄── AGPL-3.0. RFP §3.6 + Appendix:
   │    exact, testnet + pubnet    │       "Do not use… unusable code base
   └───────────────┬───────────────┘        to use or study."
                   │ verify / settle
                   ▼
        ┌────────────────────────┐
        │  Soroban / Stellar     │   auth entry, SEP-41 SAC, ~0.0023 XLM
        └────────────────────────┘

   ╔═══════════════════════════════════════════════════════════════════════╗
   ║  MISSING EVERYWHERE:  index · /discovery/resources · /discovery/search ║
   ║  with real ranking · MCP discovery server · upto on Stellar           ║
   ╚═══════════════════════════════════════════════════════════════════════╝
```

---

### 4. What Stellar already has

Evidence only.

- **`@x402/stellar` v2.22.0, Apache-2.0** — `typescript/packages/mechanisms/stellar/package.json`. Deps: `@stellar/stellar-sdk ^16.0.1`, `@x402/core`. Exports exactly three subpaths: `./exact/client`, `./exact/server`, `./exact/facilitator`. **No `upto`, no discovery, no bazaar.** Source tree is 12 `src/*.ts` files; `grep -rni stellar` inside `packages/extensions/src/bazaar/` returns **zero matches**.
- **`stellar/x402-stellar`, Apache-2.0, 8★, last push 2026-07-21** — SDF's own tools/examples. Contains `examples/facilitator/` (app.ts, env config, validation, vitest tests, tsup, Dockerfile), `examples/client-cli/`, `examples/simple-paywall/`, and `examples/facilitator/scripts/generate-channel-accounts.ts` (the throughput answer the RFP asks for in §3.5). `grep -rlnE "bazaar|discovery/resources|declareDiscoveryExtension"` across the whole repo matches **only `Dockerfile`** (an unrelated string). **The SDF reference facilitator has no discovery whatsoever.**
- **Live conformance baseline, verified 2026-08-11** — `GET https://x402.org/facilitator/supported` returns 11 kinds, exactly **one** Stellar: `{"x402Version":2,"scheme":"exact","network":"stellar:testnet","extra":{"areFeesSponsored":true}}`. No `stellar:pubnet`. `GET https://x402.org/facilitator/discovery/resources?limit=5` → **HTTP 404** (Next.js error page). The canonical facilitator runs no Bazaar index.
- **e2e harness is already Stellar-aware** — `e2e/config/mechanisms_stellar.json` defines `stellar:testnet` (`https://soroban-testnet.stellar.org`) and `stellar:pubnet` (`https://mainnet.sorobanrpc.com`), env keys `SERVER_STELLAR_ADDRESS` / `CLIENT_STELLAR_PRIVATE_KEY` / `FACILITATOR_STELLAR_PRIVATE_KEY`, and route `"/exact/stellar": { scheme: "exact", price: {usd:"$0.001"}, extensions: ["bazaar"] }`. `e2e/extensions/bazaar.ts` (22.4K) contains `validateSearchEndpoint`, `fetchDiscoveredResources`, `validateFacilitatorDiscovery`, `handleDiscoveryValidation`.
- **Known open Stellar defects upstream** — #3018 contract accounts cannot sign their own auth entries (`invalid version byte. expected 48, got 16`); #3125 `ExactStellarScheme.settle` discards the RPC `sendTransaction` response, collapsing retryable and terminal failures into one constant `errorReason`; #2761 raw Soroban simulation errors unmapped; #2758 no Stellar subpath in `@x402/paywall`; #2347 no Python Stellar support.

### 5. What OpenZeppelin already has

Evidence only — and it is **legally unusable for this RFP**.

- `gh api repos/OpenZeppelin/openzeppelin-relayer` → `"license.spdx_id": "AGPL-3.0"`, last push 2026-08-11.
- Relevant paths: `examples/x402-facilitator-plugin/`, `examples/channels-x402-plugin-example/` (with `docker-compose.yaml`, `config/config.json`), `docs/guides/stellar-x402-facilitator-guide.mdx` (also pinned under `docs/1.4.x/` and `docs/1.5.x/`).
- The RFP, Appendix "Do not use" (L502–507): the free **Built on Stellar facilitator** "runs exact on both networks via the OpenZeppelin Relayer x402 plugin. Unusable code base to use or study: AGPL-3.0-or-later, and AGPL's network clause applies to a service serving third parties."
- §3.6 (L389) repeats it as a hard non-functional requirement: "No AGPL or other strong copyleft in the dependency path: notably the OpenZeppelin Relayer, its x402 plugin, and the relayer SDK."

**Consequence:** the preference order `REUSE > EXTEND > FORK > REIMPLEMENT` cannot be applied to OpenZeppelin at all. Not a technical judgment — a licence one. Questions C1–C9 of the brief are moot; the answer to C9 ("could we reuse OpenZeppelin rather than fork it?") is **no, and we may not even read it**. Reuse instead targets `@x402/stellar` + `stellar/x402-stellar` (both Apache-2.0).

### 6. What x402 Bazaar already has

Evidence only. `typescript/packages/extensions` v2.22.0, Apache-2.0, export subpath `./bazaar`.

What ships (`src/bazaar/`, 2,696 LOC across 15 files):

| Role | Symbols | File |
|---|---|---|
| Seller | `declareDiscoveryExtension`, `bazaarResourceServerExtension`, `BAZAAR` | `resourceService.ts`, `server.ts`, `types.ts` |
| Facilitator | `validateDiscoveryExtension`, `validateAndExtract`, `extractDiscoveryInfo`, `isValidRouteTemplate`, `validateRouteTemplate`, `isValidServiceName`, `sanitizeTags`, `isValidIconUrl`, `sanitizeResourceServiceMetadata`, `validateDiscoveryExtensionSpec` | `facilitator.ts` (690 LOC) |
| Types | `DiscoveredHTTPResource`, `DiscoveredMCPResource`, `DiscoveredResource`, `QueryDiscoveryInfo`, `BodyDiscoveryInfo`, `McpDiscoveryInfo` | `facilitator.ts`, `types.ts` |
| Buyer/agent | `withBazaar` client extension: `ListDiscoveryResourcesParams`, `SearchDiscoveryResourcesParams` → calls `${client.url}/discovery/resources` and `${client.url}/discovery/search` | `facilitatorClient.ts:255,306` |
| v1 back-compat | `extractDiscoveryInfoV1` (v1 data lives in `PaymentRequirements.outputSchema`) | `v1/facilitator.ts` |
| Startup | `checkIfBazaarNeeded`, `validateBazaarRouteExtensions` | `startupValidation.ts` |

What **does not** ship: any storage, any index, any server-side implementation of `/discovery/resources` or `/discovery/search`, any ranking. The spec is explicit — `specs/extensions/bazaar.md` §"Facilitator Behavior": *"How a facilitator stores, indexes, and exposes discovered resources is an implementation detail."* The two endpoints appear under the heading **"Optional Discovery Endpoints"**.

The only server-side reference implementations in the whole monorepo are examples, and they are toys:
- `examples/typescript/facilitator/advanced/bazaar.ts` (443 LOC) — `class BazaarCatalog { private resources: Map<string, DiscoveryResource> }`, `search()` at line 87 lowercases the query, joins `resource + type + description + serviceName + tags + extension values` into one string and calls `haystack.includes(needle)`, then `results.slice(0, limit)`. The response hard-codes `partialResults: false` (line 413). No cursor, no score, no persistence.
- `examples/python/facilitator/advanced/bazaar.py:314,337` and `examples/go/facilitator/advanced/bazaar.go:223,237` — same shape.

Answers to brief §D: (1) seller advertises via `declareDiscoveryExtension` in `PaymentRequired.extensions[BAZAAR.key]`; (2) the **client echoes** the extension into the `PaymentPayload` — which is precisely why the facilitator is a trust boundary; (3–4) the facilitator indexes it, **at verify/settle time**, with no separate registration; (5–6) storage and validation are the facilitator's, using the supplied JSON `schema` via `ajv`; (7–10) `GET /discovery/resources` (offset pagination, filters `type`/`payTo`/`scheme`/`network`/`extensions`/`limit`/`offset`) and `GET /discovery/search` (`query`, advisory `limit`, **advisory `cursor`**, response may carry `partialResults` and `pagination.{limit,cursor}`); (11–12) both HTTP and MCP are first-class — MCP resources are keyed `(resource.url, input.toolName)` with `mcp://tool/{toolName}` URLs; (13–15) pricing/network/asset ride the standard `accepts[]` payment requirements, not a bazaar-specific field; (16–17) **chain-agnostic** — `grep -rniE "eip155|evm|solana|svm|viem" src/bazaar/` matches only README examples and two JSDoc comments in `facilitatorClient.ts:30,75`; zero matches in executable logic; (18) **yes, Stellar works automatically** once the underlying `exact` scheme works — the e2e config already pairs them; (19) the one thing that breaks is MCP canonical-URL construction, upstream bug #3121.

---

### 7. The actual missing capability

**The missing capability is a persistent, spoof-resistant Bazaar index for Stellar with a real natural-language ranking function and a published method for measuring its result quality — nobody in the x402 ecosystem has shipped one, on any chain.**

Proof, in four independent observations:

1. **The spec deliberately does not provide it.** `specs/extensions/bazaar.md` §"Facilitator Behavior": *"How a facilitator stores, indexes, and exposes discovered resources is an implementation detail."* The endpoints are labelled **Optional**. The protocol defines the wire shape of discovery and nothing else.
2. **The canonical facilitator does not run one.** `https://x402.org/facilitator/discovery/resources` → **404**, verified 2026-08-11, while the same host correctly serves `stellar:testnet` in `/supported`. The reference deployment implements payments and not discovery.
3. **The reference implementation is a substring match.** `examples/typescript/facilitator/advanced/bazaar.ts:87–108` — `haystack.includes(needle)` over an in-memory `Map`, `partialResults` hard-coded to `false`. "Natural-language query" in the spec table is satisfied by lowercasing.
4. **The RFP itself names this as the deliverable and the differentiator.** §3.2, L300–305: *"Search quality is a deliverable, not a detail: this means real ranking, and submissions must describe both their retrieval approach and how they will evaluate result quality over time. It is the hardest part of the scope and the part existing catalogs most often leave unimplemented."* And §1, L219: the Bazaar *"is the highest value part of the RFP and should carry the largest share of the budget."*

Hypothesis scoring from the brief: **H1 TRUE** (Stellar has payments, no Bazaar — stated by the RFP and verified in both SDF repos). **H2 TRUE** and is the sharpest framing. **H3 TRUE** (§1 L217: "The ecosystem must not depend on a single hosted operator"). **H4 FALSE and inverted** — OpenZeppelin predates the RFP and the RFP explicitly disqualifies it on licence. **H5 PARTLY TRUE** — production infrastructure is required, but around a *new* discovery primitive, not only around existing ones. **H6 FALSE** — verified by the 404 and by the empty grep in `stellar/x402-stellar`. **H7 FALSE** — no global Bazaar network exists to interoperate with (§8). **H8 TRUE** — this is the answer. **H9 TRUE but secondary** — the MCP discovery server (R20) is a required deliverable and upstream MCP canonical URLs are broken (#3121). **H10 TRUE** — two non-obvious gaps: (a) `upto` on Stellar has a spec PR but **no implementation** anywhere; (b) no facilitator serves `stellar:pubnet` in `/supported` today.

---

### 8. Bazaar interoperability model

**Discovery is facilitator-local and optional. There is no federation, no aggregator, and no canonical global index.**

Why:
- `grep -niE "federat|aggregat|global|canonical|cross-facilitator|other facilitators" specs/extensions/bazaar.md` returns **two** hits, both about `routeTemplate` collapsing dynamic routes "to a single canonical catalog entry" — a *within-one-catalog* dedup rule, not cross-facilitator anything.
- The endpoints live under the heading **"Optional Discovery Endpoints"**.
- The client-side helper `withBazaar` (`facilitatorClient.ts:255,306`) hits `${client.url}/discovery/…` — i.e. **whichever single facilitator you point it at**. There is no discovery-of-facilitators step, no registry of registries, no cursor protocol spanning hosts.
- The RFP's own background confirms it (L246): *"Several facilitators run their own Bazaar compatible catalogs, so today a Stellar denominated service is only as discoverable as whichever multi-chain facilitator happens to carry it."*

So the brief's fork **A vs B is settled: A.** "Bazaar support" means *implement the extension and run your own index*. Option B does not exist to be implemented against. R17's "interoperate with the wider x402 discovery ecosystem" therefore reduces to **schema and wire parity** — a `DiscoveredResource` we emit must be shaped so any stock `withBazaar` client, or another facilitator ingesting our catalog, reads it identically. That is a conformance obligation, not an architecture.

Practical consequence: the "global Bazaar" framing that would have justified building federation infrastructure is unavailable, which removes the most differentiated-sounding architecture from the table. What remains differentiating is **quality inside a local index**, not reach across indexes. (An aggregator that crawls sibling facilitators is *possible* and unclaimed, but the RFP does not ask for it and §3.2 L337 warns against scope that adds cost off the hot path.)

---

### 9. Build vs reuse matrix

| Component | Build | Reuse | Extend | Reason |
|---|:--:|:--:|:--:|---|
| x402 payment protocol | | ✔ | | `@x402/core` 2.22.0, Apache-2.0. Never fork. |
| Stellar scheme (`exact`) | | ✔ | | `@x402/stellar` 2.22.0. RFP R2 mandates it. |
| Stellar scheme (`upto`) | ✔ | | | `scheme_upto_stellar.md` absent; PR #3098 is docs-only. Needs a Soroban contract (R24). **Wedge #2.** |
| Facilitator HTTP service | | | ✔ | Start from `stellar/x402-stellar` `examples/facilitator` (Apache-2.0, tested, Dockerised). Not OZ (AGPL). |
| Relayer / fee sponsorship | | ✔ | | `areFeesSponsored` handled by `@x402/stellar`; channel accounts pattern from SDF `scripts/generate-channel-accounts.ts`. |
| Settlement | | ✔ | | `@x402/stellar/exact/facilitator`. Reimplementation is explicitly discouraged (R2). |
| Verification | | ✔ | | Same. Contribute #3018/#3125 fixes upstream rather than patch locally. |
| Bazaar metadata (declare/extract) | | ✔ | | `declareDiscoveryExtension`, `extractDiscoveryInfo`. |
| Resource validation / sanitisation | | ✔ | | `validateAndExtract`, `validateRouteTemplate`, `sanitizeResourceServiceMetadata` — the trust-boundary primitives already exist and are tested. |
| **Index (persistence, dedup, ownership)** | ✔ | | | Nothing exists beyond an in-memory `Map`. |
| **Discovery API + ranking + eval harness** | ✔ | | | Nothing exists beyond `includes()`. **Wedge #1 — the highest-weighted line item in the RFP.** |
| Seller helpers | | | ✔ | Thin ergonomic layer over `bazaarResourceServerExtension` (R18). |
| HTTP example | ✔ | | | R36. Trivial. |
| MCP example / MCP discovery server | ✔ | | ✔ | `@x402/mcp` provides plumbing; the discovery server + paid-call proxy (R20) does not exist. Blocked-adjacent on #3121. |
| Buyer client | | ✔ | | `withBazaar` + `@x402/stellar/exact/client`. |
| Conformance testing | | ✔ | | `e2e/` + `e2e/extensions/bazaar.ts`, already Stellar-configured. **Run it; do not rebuild it.** |
| Deployment / observability | ✔ | | | Boring infra. Tranche 1–2 work. |

---

### 10. Proposed architecture

Only the parts that are ours. Everything unmarked is an upstream dependency.

```
      agent runtime (Claude / any MCP host)
            │
            │  MCP: bazaar.search / bazaar.pay_and_call        ◄── OURS (R20,R21)
            ▼
  ┌────────────────────────────────────────────────────────────┐
  │  DISCOVERY PLANE                                    OURS   │
  │                                                            │
  │  GET /discovery/resources   filters, offset      (R10)     │
  │  GET /discovery/search      NL query, cursor,              │
  │                             partialResults       (R11)     │
  │      └─ hybrid retrieval: lexical (BM25) ⊕ dense           │
  │         embedding over serviceName+description+            │
  │         param descriptions+tags, reciprocal-rank fusion    │
  │      └─ RELEVANCE EVAL HARNESS: versioned golden query set │
  │         + nDCG@10 / recall@20, reported per release ◄─ the │
  │         thing the RFP asks for and nobody has              │
  │                                                            │
  │  INDEX: Postgres (catalog + ownership + provenance)        │
  │         + pgvector (embeddings). Off-chain (R19).          │
  │         dedup key: routeTemplate-canonical URL |           │
  │                    (resource.url, input.toolName)  (R13)   │
  └───────────▲────────────────────────────────────────────────┘
              │ catalog(resource) on successful verify/settle (R12)
              │ EXTENSION-RESPONSES: {bazaar:{status,rejectedReason}} (R15)
  ┌───────────┴────────────────────────────────────────────────┐
  │  PAYMENT PLANE          thin — mostly upstream             │
  │  POST /verify   POST /settle   GET /supported      (R1)    │
  │  ── validateAndExtract() ──────────── @x402/extensions     │
  │  ── ExactStellarScheme ─────────────── @x402/stellar       │
  │  ── UptoStellarScheme ──────────────── OURS + upstream PR  │
  │  ── channel-account pool ───────────── SDF pattern (R27)   │
  └───────────┬────────────────────────────────────────────────┘
              ▼
     Soroban RPC — stellar:testnet / stellar:pubnet
     (+ OURS: upto_escrow Soroban contract, R24)
```

Two planes, one process, one deploy. The payment plane is deliberately thin and boring: its job is to stay conformant. The discovery plane is where the grant money and the differentiation live. They are separable — the discovery plane could later ingest from *any* conformant facilitator, which is the honest version of "interoperability" (§8).

---

### 11. Smallest vertical slice

```
[discover]  GET  /discovery/search?query=weather+in+colombia
            → 200 { resources:[ { resource:"https://…/weather",
                                  type:"http", accepts:[{scheme:"exact",
                                  network:"stellar:testnet", asset:USDC,
                                  maxAmountRequired:"10000" /* 0.001, 7dp */,
                                  extra:{areFeesSponsored:true} }] } ],
                    pagination:{limit:10,cursor:null} }
[request]   GET  /weather?city=Medellin            → 402 PaymentRequired
                                                     + extensions.bazaar
[sign]      client builds Soroban auth entry, signatureExpirationLedger set
[retry]     GET  /weather?city=Medellin  +  X-PAYMENT
[verify]    POST /verify   → { isValid:true }
[settle]    POST /settle   → { success:true, transaction:<REAL TESTNET HASH> }
                             EXTENSION-RESPONSES: {"bazaar":{"status":"success"}}
[200]       → { "city":"Medellin", "temperature":22, "unit":"C" }
[proof]     the resource is now in /discovery/resources without any
            registration step — and a SECOND resource (/translate) proves
            the index is not hard-coded
```

Acceptance is the brief's 14 points **plus** RFP R29: the client must be an **unmodified** stock x402 client, and the run must be `e2e/` with `mechanisms_stellar.json`, not a bespoke script. Settlement is real; only unit tests mock Stellar.

### 12. Production gap

Between the slice above and "production ready" (R38): `stellar:pubnet` deployment and a real USDC contract config; the Audit Bank third-party review (R31) — mandatory before the mainnet production tag; durable index (the slice can run on SQLite/Postgres but needs backup, migration, restart-verification of catalog trust state); channel-account pool sizing for bursty agent traffic (R27); caller auth + metering + rate limiting (R8); structured logs, request IDs, settlement-latency and error-rate metrics, health endpoint, graceful shutdown; secret injection with the sponsor key isolated from the web tier (R30); a degraded-mode story for "settlement down but discovery up" (R33); the role-based developer guide contributed to Stellar Developer Docs (R35); and a stated post-grant maintenance or handoff commitment (R34). None of that is 5-day work, and none of it is required by 2026-08-16.

### 13. Security model

The facilitator is a trust boundary in two independent directions. The RFP says so (§3.2 L319–321) and the reason is structural: **the client echoes the seller's `resource` block back into the `PaymentPayload`**, so every discovery field arrives attacker-controlled.

| Threat | Vector | Control |
|---|---|---|
| Payment replay | Same signed auth entry submitted twice | `signatureExpirationLedger` (~12 ledgers ≈ 60s) + settled-nonce table keyed on the auth-entry hash |
| Duplicate settlement | Concurrent `/settle` for one payload | Idempotency key = auth-entry hash; single-flight lock; persist the outcome, not just the tx hash |
| Authorization expiry | Ledger-based, not wall-clock | Re-derive current ledger at settle time, never trust a client timestamp |
| Front-running | Facilitator sees the payload before submitting | Non-custodial by construction (R6): the auth entry binds contract, asset, amount and recipient — tampering fails verification. Test it explicitly. |
| **Malicious metadata / resource poisoning** | Hostile client forges `serviceName`, `description`, `tags`, `iconUrl` | `sanitizeResourceServiceMetadata`, `isValidServiceName`, `sanitizeTags`, `isValidIconUrl` + spec **soft-drop** (drop the bad field, keep the listing) |
| Path traversal via `routeTemplate` | `%2e%2e%2f` | `validateRouteTemplate` **after percent-decoding** — the RFP calls this out by name (L323–325) |
| **Fake seller registration / listing hijack** | Attacker catalogs a resource under someone else's `payTo`, or overwrites a rival's entry | Only catalog on a **successfully settled** payment; bind the catalog entry to the `payTo` that actually received funds; refuse cross-owner overwrite of a canonical key; mark entries whose ownership cannot be re-verified |
| Price / network / asset mismatch | Listing advertises terms the endpoint does not honour | Index the `accepts[]` observed in the payload, never a client-asserted price; re-verify on each settlement and flag drift |
| SSRF | `iconUrl` fetching, MCP URL resolution, any crawl | Never fetch seller-supplied URLs server-side; if ever needed, allowlist scheme + deny private CIDRs + no redirects |
| Schema abuse | Hostile JSON Schema in `schema` to blow up `ajv` | Depth/size caps, compile timeout, reject `$ref`/remote refs, cache compiled validators |
| DoS / index spam | Cheap testnet payments to flood the catalog | Per-`payTo` and per-IP quotas, catalog write cost tied to settled value, TTL + re-verification eviction |
| Rate limiting | R8 | Configurable, documented, distinct limits for verify/settle vs discovery reads |
| Private-key custody | Sponsor key funds every settlement | Isolated signer process/KMS, no key in the web tier, spend caps + alerting, rotate-able |
| Relayer compromise | Sponsor account drained | Sponsor pays fees only, never the payment asset; balance floor alarms; key never authorises transfers |
| MCP canonical URL | Upstream #3121 builds a broken URL for `mcp://tool/{toolName}` | Do not paper over it locally — fix upstream, keyed dedup on `(resource.url, input.toolName)` |

### 14. Competitive landscape

`gh api search/repositories q="stellar x402 facilitator" sort=updated` on 2026-08-11 returns **ten** candidates, nine created after the RFP opened on 2026-07-23. Threat is assessed against the RFP's actual evaluation criteria, not against LOC.

| Project | Status | Source | What exists | Overlap | Threat |
|---|---|---|---|---|---|
| **Vellar-Wallet/vellar-facilitator** | Live on testnet, pre-production. Created 2026-07-31, **59 commits**, last push 2026-08-11 17:57. Author `davedumto`. Apache-2.0. | `github.com/Vellar-Wallet/vellar-facilitator` | ~12.9k LOC TS. `src/facilitator.ts`, `src/catalog.ts` (`/discovery/resources` + `/discovery/search` with `scoreResource()` token ranking at `catalog.ts:1527`), `src/bazaar.ts`, `src/mcp.ts` (2 registered tools), `src/ownership.ts` + `src/trust.ts` (listing-hijack defence), `src/policy.ts`, ~25 test files, mutation-testing harness (`scripts/mutate.mjs` + 6 mutation configs), CI, `render.yaml` deploy with keep-alive, `docs/security-audit.md` (102KB), `docs/operator-runbook.md` (29KB), published testnet tx hashes. Also filed upstream issue **#3125** against `@x402/stellar` settle. | R1(testnet), R10, R11(partial), R12, R13, R14, R15, R20, R30, R38 | **HIGH — near-duplicate** |
| **`Eras256`** (repo not public) | Upstream-first. PR **#3098** "docs: add upto scheme implementation spec for Stellar" open since 2026-08-08; issue **#3097**; issue **#3121** (bazaar MCP canonical URL bug), 2026-08-11. | `github.com/x402-foundation/x402` | No public implementation found. But owns exactly the artefacts §4 of the RFP grades highest: a spec contribution and an interop bug report, both in-scope, both cited by name in the RFP text. The #3098 body already argues the SEP-41-allowance-is-insufficient position that R24 demands. | R23, R24, R13, R16 | **HIGH — owns the wedge we'd want** |
| Galmanus/x402-bazaar | Created 2026-08-11 03:34, pushed 18:42 same day. 238MB, `Makefile`, Apache-2.0. | `github.com/Galmanus/x402-bazaar` | Same-day repo; size suggests vendored artefacts. Not assessed in depth. | Claims facilitator + Bazaar | MEDIUM |
| Veridex-Protocol/stellar-facilitator | Created 2026-08-03 11:45, **pushed 12:24 — 39 minutes later. 2 commits. Not touched since.** Apache-2.0. Has an MCP server listed on Glama. | `github.com/Veridex-Protocol/stellar-facilitator` | 78 files: `bazaar-service/src/{catalog,search/embeddings,p2p/mesh,telemetry/circuit-breaker}`, `contracts/upto-settlement/`, `contracts/upto_escrow/` (Rust), docker-compose, spec docs. Ambitious surface, zero iteration, abandoned 8 days. Reads as a single generated dump. | Nominally R11, R20, R23, R24 | MEDIUM (loud README, no evidence of working code) |
| kunaldrall29/walras | Created 2026-08-02, last push 2026-08-05. 604KB. | `github.com/kunaldrall29/walras` | "Stellar x402 facilitator + Bazaar discovery layer". Stalled 6 days. | Nominal | MEDIUM |
| accensa/x402-facilitator-stellar | Created **2026-08-11 10:30**, 4 commits, merged an e2e-harness PR same day. 11 files, JS. | `github.com/accensa/x402-facilitator-stellar` | Self-described "conformance spike": `src/facilitator.js`, `src/rpc-retry.js`, `scripts/e2e.mjs`. Small but pointed at R29. | R1, R29 | LOW–MEDIUM |
| HeylmStoned/stellar-x402-facilitator | Created and abandoned 2026-08-04 (20 min). 36KB. | — | "SCF spike: permissive Stellar x402 facilitator + Bazaar discovery" | Nominal | LOW |
| AiFinPay/stellar-x402-facilitator | Created and abandoned 2026-08-03 (15 min). 64KB. | — | README claims exact + upto + MCP + testnet/mainnet | Nominal | LOW |
| matrixcrstudio/tollgate-x402 | Created and abandoned 2026-08-05 (3 s). 10KB. | — | "Design stage." | Nominal | LOW |
| StevenMolina22/stellar-x402-paywall-kit | 2026-08-06 | — | Express/Hono paywall middleware with a Stellar facilitator preset. Adjacent, not competing. | R18 | LOW |
| mertkaradayi/stellar-x402-facilitator | 2025-11-29, dormant. | — | Predates the RFP. | — | LOW |
| collinsezedike/domino | 2026-03-16, 0KB. | — | Empty. | — | LOW |
| `tolgayayci` | PR **#3018** (contract accounts signing auth entries), open since 2026-08-01. | x402 repo | Fixing R3 upstream. Possibly a bidder, possibly SDF-adjacent. | R3 | UNKNOWN |

Reading: the field is nine READMEs and **two real efforts**. Vellar has the implementation; Eras256 has the upstream credibility. Both started 8–12 days ahead. Under a probable single-award assumption (A1), entering on 2026-08-11 means beating both on criteria that reward exactly what they already have on the record.

### 15. Six-day feasibility

The correct reframing first: **2026-08-16 is a submission deadline, not a delivery deadline.** The awards page shows tranches named Initial / MVP / Testnet / Mainnet, each due within 90 days of the prior payment, ceiling $150K in XLM. Nothing in §"Process & Timeline" requires running infrastructure at submission. So the six days buy *evidence attached to a proposal*, and evidence should be chosen for signal-per-hour against the §4 evaluation criteria.

Ranked by signal per hour:

| Rank | Artefact | Criterion it hits | Cost |
|---|---|---|---|
| 1 | A passing `e2e/` run against our facilitator on `stellar:testnet`, with the published tx hash, using the **unmodified** stock client | R29 conformance — *"Reviewers will point stock SDK code at the deliverable"* | ~1 day |
| 2 | The relevance **eval harness**: versioned golden query set + nDCG@10 baseline comparing `includes()` vs BM25 vs hybrid, with numbers | §4 "Discovery design… a real answer on natural language search quality and **how it is evaluated**" — literally nobody has this | ~1.5 days |
| 3 | Working `/discovery/search` with hybrid retrieval + cursor + `partialResults` over a persistent index | R11, the highest-weighted line item | ~1.5 days |
| 4 | An upstream PR that lands: **#3121 fix** (MCP canonical URL) or the `upto` Stellar *implementation* behind #3098 | §4 "Prior conformance runs, spec contributions, or interop bug reports are strong signals" | ~1 day |
| 5 | `stellar:pubnet` in `/supported` — no one else advertises it | R1, and it is a one-line differentiator reviewers can curl | hours |

Plan:

- **Aug 11 (today, remaining)** — decision. If GO: scaffold from `stellar/x402-stellar` `examples/facilitator`; pin `@x402/stellar@2.22.0`, `@x402/extensions@2.22.0`; provision testnet keys; stand up `/verify`, `/settle`, `/supported`.
- **Aug 12** — wire `validateAndExtract` → Postgres+pgvector index; automatic cataloging on settle; `EXTENSION-RESPONSES`; `/discovery/resources` with all six filters. First real testnet settlement, hash recorded.
- **Aug 13** — `/discovery/search`: BM25 lexical + embedding dense, RRF fusion, cursor pagination, `partialResults`. Two demo resources (`/weather`, `/translate`) proving the index is not hard-coded.
- **Aug 14** — **the eval harness.** 40–60 golden queries over a seeded catalog, nDCG@10 + recall@20, baseline table vs the reference `includes()` implementation. This is the proposal's centrepiece; publish the numbers and the methodology.
- **Aug 15** — run the x402 `e2e/` suite with `mechanisms_stellar.json` against our deployment on both networks; MCP discovery server with `search` + `pay_and_call`; open the upstream PR.
- **Aug 16** — write the submission. Deploy to a stable URL. Freeze.
- **Aug 17** — buffer only. The real deadline is the 16th.

`upto` + the Soroban escrow contract does **not** fit and must be proposed as tranche work, with the design position stated (contract required; SEP-41 allowance fails recipient-binding and single-use).

### 16. Risks

**P0**
- **Competitive displacement.** Vellar has 59 commits, live testnet proof, a completed security review and an upstream bug report; Eras256 owns the `upto` spec PR. If A1 resolves to a single award, a 5-day entrant loses on "relevant experience" and "security and audit history" regardless of code quality.
- **Positioning collapse.** Submitting "we built a Stellar x402 facilitator" is factually weak — `@x402/stellar` already did the hard part and the RFP says so (L223: *"Settlement on Stellar is largely solved"*). Anything not centred on discovery quality is a losing frame.

**P1**
- Upstream Stellar defects (#3018 contract accounts, #3125 settle error opacity) sit on our critical path for R3 and R21 and are not ours to merge.
- `e2e/` may not run clean against a third-party facilitator without harness surgery; the RFP makes a passing run an acceptance criterion, so a failed run is worse than no run.
- Embedding-based search adds a model dependency; a self-hosted embedder must be pinned and licence-checked (R28 covers *every* dependency).
- 7-decimal SEP-41 amount handling and trustline prerequisites are classic silent-failure sources in demos.

**P2**
- Discovery conventions are explicitly moving (L248) — anything built this week may need conformance updates before review.
- Testnet friction: trustline setup for the demo buyer, channel-account sequencing under load.
- `@x402/extensions` `ajv` schema compilation is a DoS surface if left uncapped.

### 17. Kill conditions

Stop, and do not submit, if any of these holds:

1. **The submission cannot be positioned around retrieval quality.** If the proposal reduces to "another facilitator", it is strictly dominated by Vellar. Kill.
2. **No eval harness with real numbers by end of Aug 14.** The one thing no competitor has is a measured answer to "how good is your search and how do you know". Without numbers, there is no differentiation left. Kill.
3. **The `e2e/` suite cannot be made to pass against our deployment by Aug 15.** R29 makes wire conformance a hard acceptance criterion; claiming it without a run is the exact failure mode ("drift, not inability") that §4 screens for. Kill.
4. **A1 resolves to single-award and a delegate signals Vellar is the presumptive awardee.** Resolvable by asking in the Stellar Dev Discord before investing the week — cheap, and the answer changes everything.
5. **Any required dependency turns out to be copyleft.** R28 is absolute: no AGPL in the path, including embedding models and search libraries.
6. **We cannot land a real testnet settlement with an unmodified stock client by Aug 13.** If the payment plane is not green by day 3, the discovery plane has nothing to sit on.

### 18. Final recommendation

**CONDITIONAL GO — NEED a positioning commitment and one external answer.**

The gap is real, verified, and matches the RFP exactly: Stellar has `exact` settlement and no Bazaar; the canonical facilitator 404s on `/discovery/resources`; the reference index is an in-memory `Map` searched with `includes()`; `scheme_upto_stellar.md` does not exist. OpenZeppelin is out on licence, not on merit, which removes the reuse shortcut entirely.

But the gap is contested by two credible teams with a 8–12 day head start, and the evaluation criteria reward precisely the artefacts they already have on the public record.

Proceed **only** on the narrow frame:

> *"Measured retrieval quality for the Stellar Bazaar — the first x402 discovery index with a published relevance evaluation methodology — plus the `upto` Stellar implementation behind the open spec."*

That frame is honest (it does not claim we built x402 on Stellar), it targets the RFP's own highest-weighted and self-described hardest deliverable, and it is the one thing no competitor has shipped on any chain.

Two conditions before committing the week:

- **C1 (product, escalate to the user):** commit to the retrieval-quality frame and accept that the facilitator is commodity scaffolding, not the pitch. If the intent is to build a full production facilitator to compete head-on with Vellar, the answer is **NO-GO**.
- **C2 (external, one question):** whether SCF funds one or multiple teams per RFP for #45. Not answerable from the handbook text — the sibling DVN RFP says "one or more teams", the x402 RFP does not. Ask in the Stellar Dev Discord or via the SCF Interest form. **Multiple awards → GO. Single award → the bar is beating Vellar outright, and C1 becomes mandatory rather than advisable.**

Neither condition is resolvable by further read-only investigation. Both are cheap to resolve today.
