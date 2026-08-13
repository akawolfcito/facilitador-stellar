# Stellar Bazaar: Measured Discovery for Autonomous x402 Payments

**SCF #45 — RFP Track — "X402 Facilitator with Bazaar (discovery) support"**

Every technical claim below traces to [`docs/scf/evidence-log.md`](./evidence-log.md)
by E-number. Claims without evidence are marked as planned work.
Cross-checked against [`proposal-claim-matrix.md`](./proposal-claim-matrix.md).

---

## 2. Executive summary

Payments are already machine-readable on Stellar. `@x402/stellar` settles
`exact` on both networks, a public facilitator runs it, and a settlement costs a
fraction of a cent. What an agent still cannot do is reliably **find** what to
pay for. The only server-side Bazaar search in the x402 monorepo matches the
whole query as one lowercase substring; on our benchmark it returns nothing at
all for 36 of 52 answerable queries (E-01).

That gap has an economic edge that ordinary search does not. When the consumer
is software with a wallet, a bad result is not a wasted click — it is a wasted
payment. Ranking quality, abstention, and revalidating payment terms before
signing are therefore part of payment safety, not product polish.

We built and measured that layer. A settled payment automatically catalogs the
resource; the catalog persists and survives restart; `/discovery/search` ranks
by intent; the engine declines to answer when nothing is relevant enough; and an
MCP server lets an agent go from a sentence to an invoked, paid tool. The
upstream x402 e2e suite passes 9/9 Stellar payment scenarios and 5/5 discovery
checks against our facilitator with no client or protocol patches (E-18), all
nine settling in canonical testnet USDC with the buyer spending zero XLM (E-19).

SCF funding completes what a self-funded MVP cannot: hardened hosted operation
on testnet and then pubnet, the `upto` scheme contributed upstream, a
third-party security review, and a retrieval benchmark rebuilt on real listings
and real query logs instead of synthetic ones.

---

## 3. Problem

**Settlement exists. Discovery does not.**

The RFP says it plainly: *"Stellar already has working exact settlement… What it
does not have is a native Bazaar."* We verified that independently rather than
taking it on faith:

- SDF's own `stellar/x402-stellar` reference facilitator contains **no discovery
  code**: a grep for `bazaar`, `discovery/resources` or
  `declareDiscoveryExtension` across the repository matches only an unrelated
  string in a Dockerfile (E-08, kill-or-go audit §4).
- The public `x402.org` facilitator correctly serves `stellar:testnet` in
  `/supported` and returns **HTTP 404** on `/discovery/resources` (E-08). The
  reference deployment implements payments and not discovery.
- `@x402/extensions` ships validation and extraction helpers but no index, no
  storage and no server-side implementation of either discovery endpoint. The
  spec itself labels them *"Optional Discovery Endpoints"* and leaves storage to
  the facilitator.

**Why a search miss costs money.** The only server-side Bazaar search upstream
(`examples/typescript/facilitator/advanced/bazaar.ts` at the pinned revision)
lowercases the query and asks `haystack.includes(needle)`. `"weather"` works.
*"what service can tell me whether it will rain tomorrow?"* matches nothing,
because no document contains that sentence. On our benchmark that behaviour
scores **0.0% nDCG@10 on every natural-language, constraint, multi-intent and
MCP-phrased query** — 36 of 52 (E-01).

An agent pointed at such a catalog can only find services whose vocabulary it
already knows, which defeats discovery. And the failure mode in the other
direction is worse: a retriever that always returns its nearest neighbour will
hand an agent an irrelevant paid service with no signal that it is irrelevant.
That is why abstention is in this proposal at all (E-04, E-14).

**Why Stellar specifically.** Two properties, both load-bearing rather than
decorative. A settlement costs about 0.0023 XLM, which is what makes a
per-request payment of 0.001 USDC economically coherent at all — on a chain
where the fee exceeds the payment, none of this works. And Soroban's
authorization model lets the buyer sign an auth entry while the facilitator
submits and pays: our nine-payment run moved USDC out of the buyer's account
while its XLM balance changed by exactly zero (E-19). An agent needs only the
payment asset, and never has to hold gas.

---

## 4. What is already built and proved

Everything in this table is done and reproducible today. Nothing here is
roadmap.

| Capability | Evidence | Status |
|---|---|---|
| Stellar `exact` settlement via unmodified stock client | E-05, E-06 | done, testnet |
| Automatic Bazaar cataloging from a settled payment, no registration path | E-09 | done |
| Persistent catalog, survives full facilitator restart | E-09, E-16 | done |
| `GET /discovery/resources` with the spec's filters, deterministic ordering | E-09, E-21 | done |
| Natural-language `GET /discovery/search` with measured ranking | E-12, E-13 | done |
| Abstention when nothing is relevant enough to recommend | E-14 | done, conservatively calibrated |
| Upstream x402 e2e suite green, no client/protocol patches | E-18 | done |
| Canonical testnet USDC settlement with fee sponsorship | E-19 | done, on-chain |
| Framework interoperability: Express, Fastify, Hono, Next, MCP | E-20 | done |
| Bazaar wire compatibility with stock clients | E-21 | done |
| MCP discovery → live-terms recheck → payment → invocation | E-22…E-25 | done, testnet |
| Transitive licence audit, zero copyleft, CI gate | E-26…E-29 | done |

167 unit and integration tests, typecheck clean across the workspace.

**Not done, and not claimed:** pubnet, `upto`, domain-verified listing
ownership, a hosted deployment, a security review. See §19.

---

## 5. Retrieval quality — the differentiating work

The RFP calls search quality *"the hardest part of the scope and the part
existing catalogs most often leave unimplemented"* and asks respondents to
describe both their retrieval approach and how they will evaluate it over time.
We answered by building the evaluation first.

**The benchmark.** 65 synthetic listings (55 HTTP, 10 MCP) across weather,
translation, imaging, documents, search, travel, identity, logistics,
blockchain and compute. Built adversarially: four overlapping weather services;
three "translation" services one of which — *Token Translation Table* —
resolves asset identifiers and performs no language translation; "price"
spanning market data, FX, shipping quotes, customs duty and network fees.

56 queries across seven categories, split **36 dev / 20 held-out**, with graded
relevance labels (0–3) **written against the corpus before any retriever
existed**. Tuning touches `dev` only.

**Results — held-out nDCG@10:**

| Retriever | held-out nDCG@10 |
|---|---:|
| `baseline-includes` (upstream reference behaviour) | **22.6%** |
| `bm25` | 83.0% |
| `dense` (all-MiniLM-L6-v2, 384d cosine) | **95.3%** |
| `hybrid-rrf` | 93.5% |

Per-category, the reference implementation scores **0.0%** on
natural-language, constraint, multi-intent and MCP queries (E-01).

**The validity caveat, stated up front.** The corpus and the labels are
author-written. Service descriptions are fluent prose that may paraphrase the
queries more naturally than a real seller's copy would, which plausibly
flatters dense retrieval. **95.3% is a held-out score on a synthetic benchmark,
not production accuracy**, and we do not present it as one. The *relative*
ordering is more robust than the absolute number: the baseline's zeros are a
structural property of substring matching, not an artefact of phrasing. Full
threats-to-validity in `docs/research/bazaar-retrieval-evaluation.md` §5.

**The negative result, which is why the method is worth trusting.** We expected
reciprocal rank fusion to win. It did not: 93.5% against dense's 95.3%, and
**10.8 points worse on natural-language queries specifically**. RRF reads rank
rather than confidence, so a near-noise lexical ranking still contributes
`1/(60+rank)` and displaces correct dense hits. We shipped dense-first and did
not ship the architecturally richer option (E-03).

A benchmark that only ever confirms the author's prior is not a benchmark. This
one disconfirmed ours, in public, and changed what we shipped.

**Same code, measured and served.** `buildSearchDocument` and the embedder live
in shared packages that both the benchmark and the live endpoint import, so
there is no second ranking stack to drift. `pnpm eval:retrieval` measures the
logic; `pnpm eval:retrieval:integration` measures persisted SQLite →
`SearchEngine.search()` (E-13).

---

## 6. Paid-agent safety

Discovery for an agent with a wallet needs guarantees a human-facing search box
does not.

**Hard filters before ranking.** `type`, `network`, `scheme`, `asset`, `payTo`
and `extensions` are applied in SQL *before* the query is embedded. A
semantically perfect match on the wrong network is not a lower-ranked result —
it is not a result. Verified live: the same query returns Weather Forecast first
unfiltered and **zero results** with `network=stellar:pubnet` (E-15).

**Abstention.** Dense retrieval always returns its nearest neighbour; on
unanswerable queries the top hit still scores around 0.18 cosine, and an agent
acting on that pays for the wrong service. The engine returns an empty set with
a machine-readable reason below a cosine threshold of 0.22 (E-14). Live: *"book
me a dentist appointment"* against six real listings →
`BELOW_RELEVANCE_THRESHOLD`, top score 0.0268.

**The live 402 is the contract; the catalog is advisory.** Before signing,
`bazaar_pay_and_call` re-fetches payment requirements from the resource itself
and compares network, scheme, asset, `payTo` and amount against what was
discovered. A material difference aborts with
`PAYMENT_REQUIREMENTS_CHANGED` and nothing is signed (E-24).

**Max-spend enforcement**, applied twice — a pre-flight check and a policy
filter on the stock client — so a bug in one cannot let the other overspend
(E-24).

**Ownership disclosure.** Every listing carries `ownershipBinding: "tofu"`. x402
proves who received a payment; it proves nothing about who controls a URL. We
say so on every result rather than implying more (E-11, §11).

**No atomicity, because there is none.** A payment can settle and the tool can
then fail. That returns `TOOL_INVOCATION_FAILED` **with a `paid` block carrying
the transaction hash**, so the caller knows money moved instead of inferring it
(E-25).

---

## 7. Architecture

```
  AGENT PLANE            ours
  ┌─────────────────────────────────────────────┐
  │ MCP discovery server                        │
  │   bazaar_search        bazaar_pay_and_call  │
  │   orchestration · schemas · error codes     │
  └───────┬─────────────────────────┬───────────┘
          │ HTTP                     │ stock @x402/mcp client
          ▼                          ▼
  DISCOVERY PLANE  ours      ┌───────────────────┐
  ┌──────────────────────┐   │ seller / MCP tool │
  │ GET /discovery/search│   │ stock middleware  │
  │ GET /discovery/…     │   │ + declareDiscovery│
  │ dense ranking        │   └────────┬──────────┘
  │ abstention · cursor  │            │ 402 → X-PAYMENT
  │ SQLite catalog +     │            ▼
  │ derived embeddings   │◄── onAfterSettle ──┐
  └──────────────────────┘                    │
                                              │
  PAYMENT PLANE   thin, mostly upstream       │
  ┌─────────────────────────────────────────────┐
  │ /verify  /settle  /supported                │
  │ ExactStellarScheme  ← @x402/stellar         │
  │ validateAndExtract  ← @x402/extensions      │
  │ channel-account pattern ← stellar/x402-stellar
  └───────────────────┬─────────────────────────┘
                      ▼
              Soroban / Stellar
```

**Reused, not rebuilt.** Verification and settlement are `@x402/stellar`
(Apache-2.0). All discovery validation is upstream —
`validateDiscoveryExtensionSpec`, `validateDiscoveryExtension`,
`isValidRouteTemplate`, `extractDiscoveryInfo` and the sanitisation it applies,
including its SSRF defences. The MCP payment path is the stock `@x402/mcp`
client. We wrote none of it.

**What we own:** the canonical key, the ownership binding, persistence, the
search document representation, ranking, abstention, cursors, the discovery HTTP
surface, and the MCP orchestration and error vocabulary.

Cataloging attaches through the facilitator's own `onAfterSettle` hook — an
upstream extension point — so nothing is forked. Index maintenance runs off the
settlement response path: the catalog write has already happened and the index
is derived state, so a seller never waits for embedding work (E-27 commit).

---

## 8. Interoperability

Upstream pinned at `c8247c4cd15f29498474404d94636e7dbb894e86`. Our facilitator
enters the suite through `e2e/facilitators/external-proxies/`, the directory
upstream gitignores for exactly this purpose.

**9/9 payment scenarios, 5/5 Bazaar discovery checks, exit status 0** (E-18).

| Server | axios | fetch | mcp |
|---|:--:|:--:|:--:|
| Express | ✅ | ✅ | — |
| Fastify | ✅ | ✅ | — |
| Hono | ✅ | ✅ | — |
| Next | ✅ | ✅ | — |
| MCP | — | — | ✅ |

**No client or protocol package was patched.** Configuration only: two
throwaway credentials for protocol families the run does not test (the stock
e2e client constructs EVM and SVM accounts unconditionally before any family
filtering), plus upstream's own build steps.

**Two of our bugs were found by this suite, not by us** (E-21):

1. Our `/discovery/resources` returned `{resources, pagination}`. Stock clients
   parse `{x402Version, items, pagination}` — and the asymmetry is real, the
   list endpoint returns `items` while search returns `resources`. Settlement
   was correct throughout; the catalog was simply unreadable by any stock
   client. Exactly the failure RFP §3.6 describes.
2. We rejected listings whose `routeTemplate` failed validation. Upstream
   soft-*drops* the field and keys on the URL pathname, and the Next server
   legitimately emits `":var1"` from its catch-all route. We silently lost one
   resource from discovery validation while every payment passed.

Both are fixed with regression tests replaying the exact captured wire shapes.
This is the concrete argument for why the RFP makes an upstream e2e run an
acceptance criterion rather than a claim.

**One residual, disclosed** (E-20). Running *only* Hono with *only* the fetch
client through the upstream harness fails intermittently (3/12 in the latest
measurement) with an empty response body. Controls exclude our facilitator
(Fastify through the same harness and facilitator: 0/8), the fetch client, and
`@x402/hono` itself (60/60 passes in-process, including a byte-for-byte replica
of the upstream server shape). It reproduces only when Hono runs as a separate
process under the harness. Classification: **BOUNDED, root cause unknown after
controlled measurement**. It does not affect the full suite, which is green. We
have filed nothing upstream because it is not reproducible outside the rig, and
filing a flaky harness scenario we cannot reproduce would waste a maintainer's
time.

---

## 9. Stellar payment evidence

All nine upstream e2e payments settled in canonical testnet USDC
(`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`).

Representative transaction:
[`117b374785bf3bdfdd8ff7d5ac888771fd62ee5faf27372efb4f2e2fbffacc4d`](https://stellar.expert/explorer/testnet/tx/117b374785bf3bdfdd8ff7d5ac888771fd62ee5faf27372efb4f2e2fbffacc4d).
All nine hashes are listed in E-19.

**Balance deltas across the run** — measured on chain before and after, not read
from the facilitator's own success flag:

| Account | USDC | XLM |
|---|---:|---:|
| buyer `GBA75KBI…R7N6` | **−0.0090000** | **+0.0000000** |
| seller `GDOEUTRI…3ULR` | **+0.0090000** | +0.0000000 |
| facilitator `GABMU5BF…TL5X` | 0 | **−0.0206757** |

Nine payments × 0.0010000 USDC. **The buyer spent no XLM at all.** Fee
sponsorship (`extra.areFeesSponsored: true`) demonstrated on chain rather than
asserted in a header, as RFP §3.1 requires.

**How we know the number is real.** An earlier run of the same command reported
9/9 "USDC" while the chain showed zero USDC movement and XLM moving instead — a
stale asset override had persisted because `git checkout <sha>` carries local
modifications across. Balance verification caught it (E-19). It is the second
time on this project that reading the chain caught a green run measuring the
wrong thing; the first was a fully green run settled by the public x402.org
facilitator rather than ours (E-06a). Both are why every payment claim here
cites deltas and source accounts.

---

## 10. The agent demo

The shortest complete statement of what this project is for.

The agent is handed a sentence and nothing else — **no URL, no tool name, no
payment terms**:

> *"I need something that can condense a long passage of text"*

1. `bazaar_search` → **Text Summarizer**, `mcp://127.0.0.1:4531/tool/summarize_text`,
   `stellar:testnet` · `exact` · `10000` USDC · `payTo GDOEUTRI…` · input schema
   · `ownershipBinding: tofu`
2. Live payment requirements re-fetched from the tool and compared with what was
   discovered
3. **0.0010000 USDC settled on Stellar testnet** —
   [`f92a6aeca76861010f90f7e36d11837e6a9463df40b4a0b9024b6a2c6c16ed4b`](https://stellar.expert/explorer/testnet/tx/f92a6aeca76861010f90f7e36d11837e6a9463df40b4a0b9024b6a2c6c16ed4b)
4. Tool invoked → `"The Stellar Bazaar lets an autonomous agent find… (38 words)"`

Total 8.6 s, of which 8.6 s is settlement. The tool had entered the catalog the
only way anything can: by being paid for (E-22, E-23).

In the same run, three refusals fired before any signature: a stale discovered
amount (`PAYMENT_REQUIREMENTS_CHANGED`), a price above the caller's ceiling
(`PRICE_EXCEEDS_LIMIT`), and an unreachable authority-less `mcp://` URL
(`INVALID_RESOURCE`) (E-24).

---

## 11. Security model

Written up in full in `docs/security/catalog-ownership-model.md`, drafted
**before** the implementation because the answer constrains the schema.

**What the protocol proves.** A buyer-signed Soroban auth entry authorises
exactly one contract call, asset, amount and recipient. Tampering fails
signature verification. After settlement, the recipient of a payment is an
on-chain fact.

**What it does not prove.** Nothing about who controls the resource URL. In
x402 v2 the resource block travels *through the client*, which may lie, and the
facilitator never contacts the URL. So listing ownership is **trust on first
use**: the canonical key binds to the `payTo` observed at first settlement, and
later writes are accepted only from that recipient (`OWNERSHIP_CONFLICT`
otherwise). Every listing is served with `ownershipBinding: "tofu"`.

A first mover can therefore squat an unregistered URL. What that buys them is
bounded: catalog terms are advisory and a conformant buyer pays against the live
402, so a squatter pollutes metadata rather than capturing revenue. The real
fix — an origin-hosted `.well-known/x402` authorising `payTo` addresses, fetched
off the hot path with SSRF defences — is specified and **not implemented**; it
is tranche-3 work before mainnet.

**Also in place and tested:** settlement provenance recorded per listing;
idempotent catalog writes; upstream metadata sanitisation including percent-decoded
traversal checks on `routeTemplate` and loopback/decimal/hex-IP rejection on
`iconUrl`; bounded document sizes and malformed-Unicode tolerance before
embedding; SQL-injection-as-text for queries, filters and cursors; cursors bound
to the query and filter set that produced them so they cannot page across a
filter boundary; the MCP adapter dialling only hosts from `mcp://` URLs, with
`http(s)://` and `file://` refused before any connection; and error redaction
that drops paths, URL credentials and anything resembling a Stellar secret.

That last one is worth a sentence because it shows the process: fixing a test
failure revealed the redaction pattern anchored on a secret's exact 56-character
length, so a token one character longer passed through. It now matches any long
base32 run and errs toward dropping (E-25).

---

## 12. Licensing and independence

RFP §3.6 requires a permissive OSI-approved licence with no strong copyleft
anywhere in the dependency path, and names the OpenZeppelin Relayer, its x402
plugin and the relayer SDK as excluded.

- **244 resolved packages, 238 runtime. Zero forbidden, zero unknown, zero
  needing manual review** (E-26).
- MIT 202 · BSD-3-Clause 11 · ISC 11 · Apache-2.0 10 · BSD-2-Clause 2 ·
  `(MIT OR CC0-1.0)` 1 · Unlicense 1.
- **No OpenZeppelin or relayer package anywhere** in runtime or tooling (E-28).
  We also did not read the source: the RFP says it is unusable to *use or study*.
- Model artifacts audited, not just the loader: `Xenova/all-MiniLM-L6-v2` is
  Apache-2.0, verified at source, with the three downloaded files hashed (E-27).
- The audit is a CI gate on every push and PR, and fails on unknown or
  unclassifiable licences, not only on forbidden ones (E-29).

**The audit was not ceremonial — it failed.** The first run found
`@huggingface/transformers` → `sharp` → `@img/sharp-libvips-*` under
**LGPL-3.0-or-later**: 23 packages, one copyleft, in the runtime path purely for
image preprocessing we never invoke. A compliance argument existed. We removed
the dependency instead, driving the ONNX session directly through
`onnxruntime-node` (MIT) and `@huggingface/tokenizers` (Apache-2.0, no
dependencies of its own) — then verified the swap was behaviourally neutral
rather than assuming it: identical cosine similarities on a fixed probe and an
unchanged held-out nDCG@10 of 95.3% (E-27).

Our licence: Apache-2.0. Self-hostable; the ecosystem does not depend on us
operating it.

---

## 13. Spec and upstream findings

Kept separate from shipped functionality.

**A. Bazaar cannot express an MCP server's address.**
`McpDiscoveryInfo.transport` is constrained to a transport *kind*
(`"sse" | "streamable-http"`), and the canonical identity `mcp://tool/{toolName}`
carries no authority. A discovered MCP tool can be identified but not reached,
so discovery → invocation cannot be closed by a third party. For the demo,
sellers publish an authority in `resource.url` (`mcp://host:port/tool/name`),
which preserves the spec's `(resource.url, toolName)` identity and is readable
by any facilitator. **This is a practical workaround and an interop finding, not
a proposed standard.** Raising it with the x402 TSC is tranche-1 work.

**B. The `upto` Stellar spec PR belongs to another team.** PR #3098 has been
open since 2026-08-08. Our tranche-2 work is the *implementation* and the
Soroban contract, coordinated with that author and the TSC — not a competing
spec PR.

**C. Contributions we have not yet made.** We have filed nothing upstream. The
MCP canonical-URL defect (#3121) and the settle-error-opacity issue (#3125) were
filed by others; we hit both and worked around them locally. Upstream
contribution is a tranche-1 commitment, not a past accomplishment.

---

## 14. Milestones and tranches

Mapped onto the RFP's own acceptance criteria and the award's
MVP → Testnet → Mainnet tranche structure. The current implementation is
evidence of feasibility, not a claim that tranche work is done.

### Tranche 1 — MVP and testnet hardening

- Hosted testnet facilitator at a stable URL, free and usable without friction
  (RFP §3.1), with configurable caller auth, metering and rate limiting, and a
  documented business model in which any mainnet fee is configuration rather
  than code
- Packaged hosted and self-hosted paths, including self-facilitation inside a
  resource server
- Persistent Bazaar catalog and search operated as a service, with index
  persistence, deduplication and resource re-validation
- MCP discovery server deployed
- Relevance evaluation in CI with a published nDCG@10/MRR/Recall report per
  release, and the benchmark corpus rebuilt from real cataloged listings
- Operational runbook, structured logs, request IDs, settlement latency and
  error-rate metrics, health endpoint, graceful shutdown
- Role-based developer guide (seller / buyer-agent / operator) with live testnet
  examples, contributed to Stellar Developer Docs
- Raise the MCP endpoint expressiveness gap with the x402 TSC

### Tranche 2 — protocol completion

- `scheme_upto_stellar.md` implementation and the Soroban contract it requires,
  coordinated with the open spec PR and the TSC
- `exact` + `upto` conformance, with a passing upstream e2e run and published
  settled transaction hashes per network per scheme
- Retrieval benchmark v2: corpus from real listings, query set from real
  `/discovery/search` logs, abstention threshold recalibrated on observed
  traffic, second annotator with inter-annotator agreement reported
- Seller and buyer SDK helpers for discovery metadata and Bazaar querying
- At least two end-to-end example integrations
- Integration work with early sellers and wallet teams on auth-entry signing

### Tranche 3 — mainnet

- `stellar:pubnet` deployment; both networks live, as the RFP requires
- `.well-known/x402` domain binding, upgrading listings from `tofu` to
  `domain-verified`
- Third-party security review via the Audit Bank, covering the settlement path,
  auth-entry validation and the discovery trust boundary, with findings resolved
- Production monitoring, 99%+ availability target, degraded-mode story
- Mainnet transaction evidence per scheme
- Maintenance commitment and a clean handoff path

---

## 15. Deliverables

Each is objectively testable.

1. **Facilitator** exposing `verify`, `settle`, `supported` on `stellar:testnet`
   and `stellar:pubnet`, built on `@x402/stellar`, Apache-2.0, self-hostable.
   *Test:* a passing upstream x402 e2e run on both networks with an unmodified
   stock client, plus a published settled transaction hash per network per
   scheme.
2. **`GET /discovery/resources`** with the spec's `type`, `payTo`, `network`,
   `extensions`, `limit`, `offset` filters and documented deterministic
   ordering. *Test:* the upstream suite's Bazaar discovery validation passes.
3. **`GET /discovery/search`** with natural-language ranking, cursor pagination
   and real `partialResults`, backed by a committed evaluation harness reporting
   nDCG@5/@10, MRR@10 and Recall@10/@20 on a held-out split. *Test:*
   `pnpm eval:retrieval` in CI with held-out nDCG@10 as a release gate.
4. **Automatic cataloging** of HTTP and MCP resources from settled payments,
   with `EXTENSION-RESPONSES` outcomes and a non-null reason on every rejection.
   *Test:* the invariant suite in `packages/catalog`, plus a live run showing
   listings created with zero direct database inserts.
5. **Abstention policy** with a published calibration method and reported
   coverage, rejection and false-positive rates. *Test:* `pnpm calibrate`
   output committed per release.
6. **MCP server** exposing discovery and paid-call tooling. *Test:* an
   end-to-end discovery → USDC settlement → invocation run with a transaction
   hash.
7. **`upto` for Stellar**: implementation plus Soroban contract, contributed
   upstream. *Test:* upstream e2e passing for `upto` on both networks.
8. **Licence compliance**: machine-readable audit of the resolved runtime graph,
   enforced in CI. *Test:* `pnpm audit:licenses` exits zero.
9. **Security review report** with findings resolved before the mainnet
   production tag.
10. **Developer guide and operational runbook**, contributed to Stellar
    Developer Docs.

---

## 16. Success metrics

Targets are stated where we have a basis; where we do not, the metric is
declared and the target is set after the first traffic rather than invented.

**Protocol**

| Metric | Target | Basis |
|---|---|---|
| Upstream e2e conformance | 100% of Stellar scenarios, both networks | today 9/9 + 5/5 on testnet (E-18) |
| Settlement success rate | ≥ 99% excluding client-side signature failures | to be baselined on real traffic |
| Duplicate settlement rate | 0 | idempotency keyed on the auth-entry hash |
| Settlement latency p95 | baseline first, then a target | today ~8.6 s end to end, dominated by ledger close (E-23) |
| Public endpoint availability | ≥ 99% | RFP §3.6 |

**Discovery**

| Metric | Target | Basis |
|---|---|---|
| Held-out nDCG@10 | no regression below the committed baseline | 95.3% synthetic today; re-baselined on real listings in tranche 2 |
| Recall@20 | reported per release | 95.9% held-out today |
| Abstention false-positive rate | reduce from today's 25% on 4 negatives | needs real negatives; today's sample is far too small (E-14) |
| Answerable-query coverage | ≥ 95% | 96.2% today |
| Search latency p50 / p95 | < 50 ms / < 200 ms at 10⁴ listings | 3.3 / 4.4 ms at 6 listings; scale untested |
| Catalog integrity | zero cross-seller overwrites | enforced and tested (E-11) |

**Adoption** — declared, no invented targets: cataloged services, unique
sellers, discovery queries served, discovery → live 402 rate, discovery →
settled payment rate. The last is the one that matters, and it is also the
signal that retires the synthetic benchmark.

---

## 17. Risks

| Risk | Impact | Mitigation | Resolved by |
|---|---|---|---|
| **Synthetic benchmark bias** — corpus and labels are ours, so 95.3% may not survive real listings | Headline metric weakens under scrutiny | Stated as a caveat everywhere; relative ordering is the robust claim; corpus and query set rebuilt from real data | Tranche 2 |
| **Abstention miscalibration** — threshold rests on 2 dev negatives, and the score distributions overlap | Agents pay for irrelevant services, or lose real results | Conservative default, bias toward refusing; both error directions measured and published | Tranche 2, on real query logs |
| **TOFU listing ownership** — a first mover can squat an unregistered URL | Metadata pollution, denial of listing | Bounded by catalog terms being advisory; binding disclosed on every result; `.well-known/x402` designed | Tranche 3 |
| **MCP address spec gap** — Bazaar cannot express an MCP endpoint | Third-party agents cannot invoke discovered MCP tools without a convention | Workaround demonstrated; raise with the TSC | Tranche 1 |
| **`upto` complexity** — needs a Soroban contract; SEP-41 allowances cannot enforce recipient binding or single use | Tranche-2 slip | Design doc before code; coordinate with the open spec PR author and the TSC | Tranche 2 |
| **Settlement latency and RPC variance** — agent traffic is bursty | Poor agent UX, sequence-number contention | Channel-account pattern from `stellar/x402-stellar`; multi-signer round-robin already wired | Tranche 1 |
| **Contract accounts (`__check_auth`)** — RFP §3.1 requires them; we have only settled from classic `G…` accounts, and upstream PR #3018 exists because a contract account cannot currently produce an `exact` payment | A REQUIRED capability is unproven and partly outside our control | Engage upstream early on #3018; test against contract accounts as soon as it lands | Tranche 1 |
| **Security review findings** | Mainnet slip | Audit Bank engagement early in tranche 3; threat model already written | Tranche 3 |
| **Ecosystem adoption** — a catalog with no sellers is worthless | Project becomes abandoned infrastructure | Cataloging is automatic, so listing costs a seller nothing beyond one metadata declaration; developer guide and two reference integrations | Tranches 1–2 |
| **Hono+fetch harness residual** | Reviewer diligence question | Bounded by controls; full suite green; disclosed rather than hidden | Not blocking |

---

## 18. Why this team

Stated factually; no credentials are claimed beyond what this repository shows.

- **We shipped a working implementation before writing the proposal.** Every
  claim in §4 is reproducible from the repository today, with commands in §20.
- **We debug against stock upstream code.** The upstream e2e suite found two of
  our conformance bugs — a wrong discovery envelope and an over-strict
  `routeTemplate` policy — and both are fixed with regression tests replaying
  captured wire shapes (E-21). We treat wire-level conformance as the acceptance
  criterion the RFP says it is.
- **We verify against the chain, not against our own success flags.** Two green
  runs on this project were caught measuring the wrong thing — one settled
  through the public facilitator, one moved XLM while reporting USDC. Both were
  caught by reading balances and source accounts, and both are written up rather
  than quietly fixed (E-06a, E-19).
- **We publish negative results.** RRF underperformed dense and we shipped
  dense. The licence audit failed and we removed the dependency instead of
  arguing for it. The Hono residual is documented as unresolved.
- **Evaluation methodology is the core skill this RFP asks for**, and it is
  where most of our work went: a committed corpus, a held-out split, labels
  written before retrievers, and a stated list of threats to validity.

Where we are thin, plainly: we have no prior audited-infrastructure track record
to point to, and we have not yet landed an upstream x402 contribution. Tranche 1
commits to the latter.

---

## 19. Open work before mainnet

Nothing here is claimed as done. Source of truth: the Open items table in
`evidence-log.md`.

| Item | Status | Tranche |
|---|---|---|
| `stellar:pubnet` deployment and mainnet settlement | not started; no mainnet funds moved to date | 3 |
| `.well-known/x402` domain binding | designed, not built | 3 |
| `upto` Stellar design, Soroban contract, upstream contribution | not started | 2 |
| Contract-account (`__check_auth`) settlement | untested; blocked on upstream PR #3018 | 1 |
| Hosted deployment, Docker image, base-image licence review | not built | 1 |
| Abstention threshold recalibrated on real traffic | not started | 2 |
| Operational runbook and monitoring | not started | 1 |
| Developer guide contributed to Stellar Developer Docs | not started | 1 |
| Third-party Audit Bank security review | not started | 3 |
| MCP endpoint field raised with the x402 TSC | not filed | 1 |
| Hono+fetch harness residual | bounded, unresolved | not blocking |

**This project is not production-ready on mainnet, and this proposal does not
claim it is.** It is a working, measured testnet implementation with a named
path to mainnet.

---

## 20. Reproducibility

```bash
nvm use                 # 22.20.0
pnpm install

pnpm -r test            # 167 unit and integration tests
pnpm -r typecheck
pnpm audit:licenses     # exits non-zero on any non-permissive licence

pnpm eval:retrieval                 # retrieval benchmark, all four retrievers
pnpm eval:retrieval:integration     # persisted catalog → live search path
pnpm calibrate                      # abstention threshold sweep, dev split only

# Needs funded testnet accounts:
pnpm --filter @stellar-bazaar/e2e-stellar provision
pnpm --filter @stellar-bazaar/e2e-stellar provision:usdc
pnpm --filter @stellar-bazaar/e2e-stellar e2e       # stock client → real settlement
pnpm --filter @stellar-bazaar/e2e-stellar search    # 6 paid resources → search
pnpm --filter @stellar-bazaar/e2e-stellar mcp       # agent discovery → pay → invoke
e2e-harness/run-upstream-e2e.sh                     # upstream x402 suite
```

**Evidence artifacts**

| Path | Contents |
|---|---|
| `docs/scf/evidence-log.md` | every claim, its evidence and its reproduce command |
| `docs/research/bazaar-retrieval-evaluation.md` | benchmark method and threats to validity |
| `docs/research/scf45-x402-bazaar-kill-or-go.md` | the gap analysis this work started from |
| `docs/security/catalog-ownership-model.md` | ownership threat model, written before implementation |
| `artifacts/retrieval-eval/latest.json` | per-query metrics for all retrievers |
| `artifacts/e2e/upstream-e2e-results.json` | upstream suite results |
| `artifacts/e2e/stellar-testnet-bazaar-search.json` | six paid resources, search evidence |
| `artifacts/e2e/mcp-discovery-pay-call.json` | the agent demo |
| `artifacts/e2e/balances-*.json` | on-chain balance deltas |
| `artifacts/compliance/licenses.json` | full resolved licence graph |
