# Evidence Log — SCF #45

Every claim we intend to make in the submission, with the evidence behind it and
the command that regenerates it. A claim without a reproducible line here does
not go in the proposal.

Environment: Node v22.20.0 (`.nvmrc`), pnpm 10.5.2, darwin.
Upstream pinned at x402-foundation/x402 @ `c8247c4cd15f29498474404d94636e7dbb894e86`,
packages `@x402/{core,stellar,extensions}@2.22.0`.

---

## E-01 — The x402 reference Bazaar search cannot answer a natural-language query

**Claim.** The only server-side Bazaar search in the x402 monorepo returns an
empty result set for every natural-language, constraint, multi-intent and
MCP-phrased query in our benchmark: nDCG@10 = 0.0% on 36 of 52 answerable
queries.

**Evidence.** `examples/typescript/facilitator/advanced/bazaar.ts:87-108`
matches the entire query as one lowercase substring
(`haystack.includes(needle)`), with `partialResults` hard-coded `false` at line
413. Reproduced faithfully as `baseline-includes`; per-category results in
`artifacts/retrieval-eval/latest.json`.

**Reproduce.** `pnpm eval:retrieval`

**Status.** ✅ Confirmed 2026-08-11.

---

## E-02 — Dense retrieval is 4.2x the reference on unseen queries

**Claim.** Held-out nDCG@10: `baseline-includes` 22.6%, `bm25` 83.0%, `dense`
95.3%, `hybrid-rrf` 93.6%. The held-out split (20 queries) was never used for
tuning.

**Evidence.** `artifacts/retrieval-eval/latest.json` → `reports[].heldout.ndcgAt10`.
Method, threats to validity and the labelling protocol in
`docs/research/bazaar-retrieval-evaluation.md`.

**Reproduce.** `pnpm eval:retrieval`

**Status.** ✅ Confirmed 2026-08-11. Caveat recorded: synthetic corpus and
author-written labels inflate absolute numbers; see §5 of the evaluation doc.

---

## E-03 — RRF hybrid is worse than dense alone on this corpus

**Claim.** Fusing BM25 with dense embeddings via RRF *lowers* held-out nDCG@10
from 95.3% to 93.6%, and costs 10.8 points on natural-language queries
(94.7% → 83.9%).

**Evidence.** Same artifact. Cause: RRF reads rank, not confidence, so a
near-noise lexical ranking still contributes `1/(60+rank)`.

**Why it is in the proposal.** It demonstrates the benchmark can disconfirm the
team's own prior, which is the property that makes a quality claim credible.

**Status.** ✅ Confirmed 2026-08-11.

---

## E-04 — Dense retrieval cannot abstain; BM25 can

**Claim.** On four unanswerable queries, `dense` still returns a top hit at
median cosine 0.1776 against 0.4477 on answerable queries (separation 0.397),
while `bm25` scores exactly 0.

**Consequence.** A calibrated abstention threshold is a required deliverable —
an agent acting on a 0.18-cosine result pays for an irrelevant service. This is
the strongest argument for retaining the lexical arm despite E-03.

**Reproduce.** `pnpm eval:retrieval`, "negatives" line per retriever.

**Status.** ✅ Confirmed 2026-08-11.

---

## E-05 — Our facilitator emits the RFP-mandated `/supported` contract

**Claim.** `GET /supported` returns
`{"x402Version":2,"scheme":"exact","network":"stellar:testnet","extra":{"areFeesSponsored":true}}`
— byte-identical to the conformance baseline the RFP names (the public x402.org
facilitator), which RFP §3.6 makes an acceptance criterion.

**Evidence.** Booted 2026-08-11 with one ephemeral testnet signer:

```
$ curl -s localhost:4402/supported
{"kinds":[{"x402Version":2,"scheme":"exact","network":"stellar:testnet",
  "extra":{"areFeesSponsored":true}}],"extensions":[],
  "signers":{"stellar:*":["GDOP5L26AK4DXPGKPT5O3MZA2CTRBWRNT3ZHHMLZICBX3MSSMJEYUUR7"]}}
```

Compare, same day:

```
$ curl -s https://x402.org/facilitator/supported | jq '.kinds[] | select(.network|test("stellar"))'
{"x402Version":2,"scheme":"exact","network":"stellar:testnet","extra":{"areFeesSponsored":true}}
```

The value is derived from `ExactStellarScheme.getExtra()` via
`x402Facilitator.getSupported()`, so it cannot drift from what settlement does.

**Reproduce.** `SIGNER_SECRET_KEYS=<S…> pnpm --filter @stellar-bazaar/facilitator start`

**Status.** ✅ Confirmed 2026-08-11. ⚠️ Not yet a payment: see E-06.

---

## E-06 — Real testnet settlement with an unmodified stock client

**Claim.** An unmodified canonical x402 client completes a real payment against
our facilitator on `stellar:testnet`: 402 → auth entry → verify → settle →
on-chain transaction → retry → 200.

**Command.** `pnpm --filter @stellar-bazaar/e2e-stellar provision` once, then
`pnpm --filter @stellar-bazaar/e2e-stellar e2e`

**Stock client.** No client or protocol code was patched. The buyer is
`wrapFetchWithPayment` from `@x402/fetch` driving an `x402Client` registered with
`ExactStellarScheme` from `@x402/stellar/exact/client` — the same two symbols the
upstream harness uses at `e2e/clients/typescript/client.ts:20-21,242-246`. The
seller is `paymentMiddleware` from `@x402/fastify` with `ExactStellarScheme` from
`@x402/stellar/exact/server`. Only configuration is ours.

| Field | Value |
|---|---|
| facilitator commit | `8e42bad` (payment plane), harness at `HEAD` of this branch |
| upstream x402 commit | `c8247c4cd15f29498474404d94636e7dbb894e86` |
| `@x402/core` | 2.22.0 |
| `@x402/stellar` | 2.22.0 |
| `@x402/fetch` / `@x402/fastify` | 2.22.0 |
| network | `stellar:testnet` |
| scheme / x402Version | `exact` / 2 |
| asset | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| amount | `10000` (0.0010000, 7 decimals) |
| payer | `GBA75KBIVWVJ53QOTG5E3K5O5BJQUHDKT6EYZCCABCB32YSNJZNQR7N6` |
| payTo | `GDOEUTRI3CA534VATJBFTEFDOOAQR47UQBBLNRQ2IWAPLHV2OF433ULR` |
| facilitator signer | `GABMU5BF3MJ6HAB5BIKKP27KADMWCNDWQPG7EEYX3HSIPU2YMHAKTL5X` |
| **transaction** | **`6a8353024fc7bbcfc9bf0b5a060b02be7d7c9cc0f28f2295f4110cfd813faf83`** |
| ledger | 4097028 |
| settled | 2026-08-12T03:44:31Z (10.6 s end to end) |

**HTTP sequence.**

| Stage | Result |
|---|---|
| `GET /supported` → `{"scheme":"exact","network":"stellar:testnet","extra":{"areFeesSponsored":true}}` | PASS |
| `GET /paid-ping` unpaid → **HTTP 402** | PASS |
| buyer signs Soroban auth entry | PASS |
| `POST /verify` → valid | PASS |
| `POST /settle` → `{"success":true,"transaction":"6a83…af83"}` | PASS |
| retry with `X-PAYMENT` → **HTTP 200** | PASS |
| body → `{"ok":true,"message":"paid"}` | PASS |
| transaction on Horizon, `successful: true` | PASS |
| transaction source == our facilitator signer | PASS |
| value moved buyer → seller for the declared amount | PASS |

**Independent on-chain verification.** The facilitator reporting success is not
evidence, so the harness checks Horizon directly:

```
$ curl -s https://horizon-testnet.stellar.org/transactions/6a8353024fc7bbcfc9bf0b5a060b02be7d7c9cc0f28f2295f4110cfd813faf83
successful: True   ledger: 4097028
source_account: GABMU5BF3MJ6HAB5BIKKP27KADMWCNDWQPG7EEYX3HSIPU2YMHAKTL5X

$ …/operations → invoke_host_function, asset_balance_changes:
  {"type":"transfer","asset_type":"native","amount":"0.0010000",
   "from":"GBA75KBIVWVJ…R7N6","to":"GDOEUTRI3CA…3ULR"}
```

Explorer: https://stellar.expert/explorer/testnet/tx/6a8353024fc7bbcfc9bf0b5a060b02be7d7c9cc0f28f2295f4110cfd813faf83

**Fee sponsorship proven by balances.** After the run the buyer's balance is down
exactly `0.0040000` XLM across four settlements — the payment amounts and *not
one stroop of network fee*. The facilitator signer is down `0.0020554` XLM,
having paid every fee. This is `extra.areFeesSponsored: true` demonstrated on
chain rather than asserted in a header (RFP §3.1).

**Artifact.** `artifacts/e2e/stellar-testnet-exact.json` — 9 stages, all PASS.

**Status.** ✅ PASS 2026-08-12.

**Caveats, stated plainly.**
1. **Asset is native XLM via its Stellar Asset Contract**, not USDC. Chosen so
   the run is autonomous: friendbot funds XLM directly, while testnet USDC needs
   an external faucet and trustline setup. The SAC exposes the SEP-41 interface
   and `@x402/stellar` applies no asset allowlist
   (`validateStellarAssetAddress` is a strkey regex), so USDC is the one-line
   `E2E_ASSET` change RFP §3.1's "any SEP-41 token, USDC by default" describes.
   A USDC run is still owed.
2. **Testnet only.** No `stellar:pubnet` run; no mainnet funds were touched.
3. **The x402 repo's own `e2e/` suite has not been run yet.** RFP §3.6 requires
   that separately; this harness is our own, using stock client symbols.

---

## E-06a — A green E2E run proved nothing until we checked who settled it

**What happened.** The first fully-green run of this harness reported PASS on
every stage — 402, verify, settle, retry, 200, and a real transaction hash
confirmed successful on Horizon. It was settled by the **public x402.org
facilitator**, not ours.

**How it was caught.** The transaction's `source_account`
(`GC6CSXBV4C6RL3HEDTW57KXYXSSXKAWKGYDEOSATXM3XNKXSR2VRYN3K`) was not our
facilitator signer, and the fee was paid by a third account
(`GC5OLUZ4WANP…`) — a channel-account plus fee-bump pattern our code does not
implement. Our signer's balance was still exactly `10000.0000000` XLM with only
its friendbot funding transaction: it had never submitted anything.

**Cause.** Ours, not upstream. `new HTTPFacilitatorClient(url)` was called with a
string; the constructor takes `FacilitatorConfig`, so `config.url` was undefined
and it fell back to `DEFAULT_FACILITATOR_URL`
(`@x402/core/http/httpFacilitatorClient.ts:14,336-339`) — `https://x402.org/facilitator`.
TypeScript rejects this (`TS2559: Type '"http://…"' has no properties in common
with type 'FacilitatorConfig'`); we had simply run the harness before
typechecking that package. **Not filed upstream: the type system already catches
it.**

**Fix.** One line in `apps/e2e-stellar/src/seller.ts`, plus two permanent
assertions in the harness: the transaction's on-chain source account must equal
our facilitator signer, and the on-chain value transfer must match payer, payee
and amount. A run cannot silently pass through someone else's facilitator again.

**Why this is in the evidence log.** It is the concrete reason our conformance
claims cite on-chain source accounts rather than `success: true`. RFP §4 screens
for drift; this is what the discipline looks like when it catches something.

**Related observation (not a bug report).** `x402ResourceServer` constructed with
no facilitator argument instantiates `new HTTPFacilitatorClient()` and therefore
routes real settlements to `https://x402.org/facilitator`
(`x402ResourceServer.ts:331-343`). Convenient for a first tutorial; worth an
operator warning in our own docs, since a misconfiguration yields a fully
working flow that pays through a third party.

---

## E-07 — Every dependency is permissively licensed

**Claim.** No AGPL or other strong copyleft anywhere in the dependency path, as
RFP §3.6 requires by name.

**Evidence.** Direct dependencies, verified against the npm registry
2026-08-11: `@x402/core` `@x402/stellar` `@x402/extensions` `@stellar/stellar-sdk`
`@huggingface/transformers` — Apache-2.0. `fastify` `onnxruntime-node` `vitest`
`tsx` `typescript` — MIT. Model weights `Xenova/all-MiniLM-L6-v2` — Apache-2.0.

The OpenZeppelin Relayer (`gh api repos/OpenZeppelin/openzeppelin-relayer` →
`AGPL-3.0`) and its x402 plugin are excluded, and were neither used nor studied,
per RFP §3.6 and the RFP Appendix "Do not use".

**Reproduce.** `pnpm licenses list --prod`

**Status.** ✅ Confirmed for direct dependencies 2026-08-11. ⏳ Full transitive
audit pending.

---

## E-08 — Competitive and gap analysis from primary sources

**Claim.** No Stellar-native Bazaar index exists: SDF's `stellar/x402-stellar`
contains no discovery code, and the public x402.org facilitator returns HTTP 404
on `/discovery/resources` while correctly serving `stellar:testnet` payments.

**Evidence.** `docs/research/scf45-x402-bazaar-kill-or-go.md` §4, §6, §8, with
per-claim URLs, file paths, line numbers and the pinned upstream commit.

**Status.** ✅ Confirmed 2026-08-11.

---

## E-09 — A successful Stellar payment automatically catalogs a Bazaar resource

**Claim.** A settled x402 payment carrying a valid Bazaar extension creates a
persistent discovery listing with no registration step, and the listing survives
a facilitator restart.

**Command.** `pnpm --filter @stellar-bazaar/e2e-stellar e2e`

| Field | Value |
|---|---|
| **transaction** | **`d833ca60f9f8fc22498cdb481c55a94909f061ae5c4d5f1bb1d0278c745afd5d`** |
| ledger | 4097316, `successful: true`, source = our facilitator signer |
| canonical resource | `http://127.0.0.1:4403/paid-ping` |
| payTo | `GDOEUTRI3CA534VATJBFTEFDOOAQR47UQBBLNRQ2IWAPLHV2OF433ULR` |
| network / scheme / asset | `stellar:testnet` / `exact` / `CDLZFC3S…CYSC` |
| amount | `10000` |
| catalogedAt | 2026-08-12T04:08:31Z |
| **registration calls made** | **0** |
| extension outcome | `{"bazaar":{"status":"success"}}` |
| persisted across restart | yes |

**Automatic, verifiably.** The seller declares metadata with
`declareDiscoveryExtension` in its 402 and never calls a registration endpoint —
none exists. The listing appears because `onAfterSettle` fired on a settlement
the facilitator itself performed. `registrationCallsMade: 0` is recorded in the
artifact.

**Terms derive from the settled payment, not the metadata.** The stored `payTo`,
`network`, `scheme`, `asset` and `amount` are copied from the
`PaymentRequirements` the facilitator validated and Soroban enforced. Discovery
metadata contributes only `serviceName` (`Paid Ping`), `description`, `tags`
(`demo, ping, stellar`), `mimeType` and the input/output schemas.

**Restart durability.** The facilitator is closed entirely — HTTP server and
SQLite handle — and a new instance opened against the same file on a different
port, so a pooled keep-alive socket cannot be mistaken for durability. The
listing is still returned by `GET /discovery/resources`.

**Filters over the persisted index.**
`?type=http&payTo=…&extensions=bazaar&limit=10&offset=0` → 1 resource;
`?type=mcp` → 0. Ordering is `firstSeenAt ASC, canonicalKey ASC` — total, so
paging can neither skip nor repeat.

**Upstream helpers used** (`@x402/extensions@2.22.0`, all reused, none
reimplemented): `validateDiscoveryExtensionSpec`, `validateDiscoveryExtension`,
`isValidRouteTemplate`, `extractDiscoveryInfo` (which internally applies
`sanitizeResourceServiceMetadata` → `isValidServiceName`, `sanitizeTags`,
`isValidIconUrl` and their SSRF defences), `declareDiscoveryExtension`, `BAZAAR`.

**Artifact.** `artifacts/e2e/stellar-testnet-bazaar-catalog.json` — 15 stages,
all PASS.

**Status.** ✅ PASS 2026-08-12.

---

## E-10 — Invalid discovery metadata cannot corrupt payment settlement

**Claim.** Discovery is soft-fail. A valid payment with unusable Bazaar metadata
still settles; only the `EXTENSION-RESPONSES` header changes.

**Structural reason, not just a test.** Cataloging runs in `onAfterSettle`, on a
`SettleResponse` that is already final, and `catalogSettlement` never throws —
every path returns an outcome, including a `try/catch` that converts an
exploding store into `CATALOG_WRITE_FAILED`. There is no code path by which the
catalog can alter a settlement result.

**Covered by tests** (`packages/catalog/test/catalog.test.ts`,
`apps/facilitator/test/discovery-endpoint.test.ts`):

| Case | Result |
|---|---|
| malformed extension (`{info:{nope:true}}`) | `INVALID_SCHEMA`, nothing written |
| `info` violating its own supplied `schema` | rejected, nothing written |
| traversal `routeTemplate` `/../../etc/passwd` | `INVALID_ROUTE_TEMPLATE` |
| percent-encoded traversal `/%2e%2e/…`, `/a/%2E%2E/b`, `/x/..%2Fy` | rejected |
| scheme injection `/a/https://evil.example/b` | rejected |
| store throws | `CATALOG_WRITE_FAILED`, no exception escapes |
| `null`, `42`, `"string"`, `[]`, `{info:null}` as the extension | never throws |
| over-long `serviceName` (33 chars) | dropped, listing kept |
| loopback `iconUrl` | dropped, listing kept |
| no bazaar extension | skipped, no header emitted |

**Every rejection carries a reason.** The header is
`{"bazaar":{"status":"rejected","rejectedReason":"CODE: sentence"}}` — greppable
code plus the human-readable string the spec requires. A test asserts a non-null
reason on every rejection path (RFP §3.3, §3.6).

**Deliberate divergence from upstream, recorded.** Upstream soft-*drops* an
invalid `routeTemplate` and falls back to the URL pathname; we soft-*reject* the
listing. Re-keying a resource to a path the seller never declared is worse than
not listing it. Our behaviour is strictly stricter, never more permissive.

**Wire shape verified.** Success encodes to
`eyJiYXphYXIiOnsic3RhdHVzIjoic3VjY2VzcyJ9fQ==`, byte-identical to the example in
`specs/extensions/bazaar.md`, and the stock `HTTPFacilitatorClient` logs
`[x402] extension responses: {"bazaar":{"status":"success"}}` when it reads it.

**Status.** ✅ PASS 2026-08-12.

---

## E-11 — The catalog resists cross-seller overwrite, under a stated model

**Claim.** A payment recipient other than the one bound at first settlement
cannot create or update an existing canonical listing.

**Model.** `docs/security/catalog-ownership-model.md`. The key is bound to the
`payTo` from the validated `PaymentRequirements`; subsequent writes are accepted
only from that same recipient, else `OWNERSHIP_CONFLICT`. The check and the write
share one SQLite transaction, so two concurrent settlements for a new key cannot
both observe "no owner".

**Tested:** seller B registers, seller A attempts to overwrite → rejected, and
B's `ownerPayTo`, `serviceName` and `lastSettlementTx` are all unchanged. Also
not bypassable by respelling the URL: `SELLER-A.example` (case),
`seller-a.example:443` (default port) and a trailing slash all normalise onto
B's row and are rejected there — exactly one listing remains.

**What we do NOT claim, and this is the point.** x402 proves **payment recipient
authenticity** — value provably moved to `payTo`, enforced by a buyer-signed
Soroban auth entry and the ledger. It proves **nothing about resource URL
ownership**: `resource.url` travels through the client, which may lie, and the
facilitator never contacts the URL. So the binding is trust-on-first-use, every
listing is served with `ownershipBinding: "tofu"`, and a first-mover can squat
an unregistered URL.

The squat is bounded rather than fixed: catalog payment terms are advisory, and
a conformant buyer pays against the 402 the live URL returns, so a squatter
pollutes metadata rather than capturing revenue. The real fix — an origin-hosted
`.well-known/x402` authorizing payTo addresses, fetched off the hot path with
SSRF defences — is specified in §6 of the model document and is not implemented.

**Status.** ✅ PASS 2026-08-12, with the limitation stated rather than papered
over.

---

## E-12 — `/discovery/search` runs measured natural-language retrieval over the real catalog

**Claim.** Resources cataloged only by settled Stellar payments are searchable by
natural language, with the ranking the benchmark measures.

**Command.** `pnpm --filter @stellar-bazaar/e2e-stellar search`
**Commit.** `<this commit>` · **Artifact.** `artifacts/e2e/stellar-testnet-bazaar-search.json`

Six paid resources, six real testnet settlements, **zero direct database
inserts**. Deliberately overlapping: three weather services, three
"translation" services one of which resolves token identifiers rather than
language.

| Settled resource | transaction |
|---|---|
| `/weather/forecast` | `f2d314684a2ff147…` |
| `/weather/history` | `cef5279fe5549c51…` |
| `/weather/alerts` | `4686c7c642d56fce…` |
| `/translate/text` | `aad676cd8cf932cc…` |
| `/translate/document` | `a60acdb9d0c4409d…` |
| `/tokens/translation-table` | `325a347a047f39cd…` |

| Query | Top result | Why it is hard |
|---|---|---|
| "will it rain tomorrow?" | **Weather Forecast** | no term shared with any listing |
| "translate this document" | **Document Translation** | must beat two rival "translation" services |
| "what is the current token translation?" | **Token Translation Table** | the lexical distractor is correct *only* here |
| "book me a dentist appointment" | **abstained** | top 0.0268 < 0.22 threshold |

Search latency **p50 3.3 ms, p95 4.4 ms** over 6 listings. Index build cost
(measured on the 65-listing benchmark corpus): 19.9 ms/listing cold, 2 ms total
to resync when nothing changed.

**Limitations.** Six listings is a tiny catalog; latency here says nothing about
10⁴+. Exact cosine in-process is used because measurement, not habit, justified
it — no ANN index, no pgvector. No MCP entry appears in this evidence: an
`mcp://tool/…` listing cannot arise from an HTTP settlement without an MCP
transport, so the MCP key space is covered by unit tests instead (E-17 below).

---

## E-13 — Production search preserves the benchmark's ranking behaviour

**Claim.** There is one ranking implementation, not two. The benchmark measures
the shipped code.

**Command.** `pnpm eval:retrieval` and `pnpm eval:retrieval:integration`

**Mechanism, not promise.** `buildSearchDocument` and `buildSearchTokens` live
in `@stellar-bazaar/catalog`; the embedder and `Bm25Index` live in
`@stellar-bazaar/search`. Both the benchmark retrievers and `SearchEngine` import
those exact symbols. There is no second representation to drift.

| | pure retrieval | production path |
|---|---|---|
| held-out nDCG@10 | 95.3% | 84.9% |
| all-queries nDCG@10 | 91.8% | 84.7% |
| all-queries Recall@20 | 97.9% | 77.7% |

**The gap is the abstention policy, and only that.** Production returns nothing
below 0.22 and truncates the tail; pure retrieval always returns top-k. Recall
falls 20.3 points because relevant-but-weak results are deliberately withheld.
That is the cost of not recommending paid services the ranker does not believe
in, and it is reported rather than hidden.

**Wording for the proposal:** "95.3% nDCG@10 on our held-out synthetic
benchmark" — never as production accuracy. The corpus and labels are
author-written (see `docs/research/bazaar-retrieval-evaluation.md` §5).

**Dense-first, because the benchmark said so.** RRF hybrid scored 93.5% against
dense's 95.3% and lost 10.8 points on natural-language queries specifically. It
is not shipped. The lexical arm is retained for exact-term behaviour and because
it is the only retriever here that abstains cleanly.

---

## E-14 — Search abstains instead of recommending an irrelevant paid service

**Claim.** A query the catalog cannot serve returns an empty result set with a
machine-readable reason, not a nearest neighbour.

**Command.** `pnpm calibrate`

Live evidence: "book me a dentist appointment" against the six real listings →
`{"abstained":{"reason":"BELOW_RELEVANCE_THRESHOLD","topScore":0.0268,"threshold":0.22}}`.

**Threshold selection, dev split only** (34 answerable, 2 unanswerable; the 20
held-out queries were not read):

```
   T    coverage  reject  FP-rate  nDCG@10|accepted
 0.15    100.0%    50.0%   50.0%      92.0%
 0.20     97.1%   100.0%    0.0%      89.4%
 0.22     97.1%   100.0%    0.0%      86.9%   <- shipped
 0.24     97.1%   100.0%    0.0%      85.4%
 0.30     91.2%   100.0%    0.0%      81.2%
```

0.20–0.24 is a plateau; the middle is the right place to sit because an edge is
where sampling noise bites.

**On the full query set** (including held-out): coverage **96.2%** on answerable
queries, **3 of 4** unanswerable rejected, false-positive rate **25%**.

**What it gets wrong — stated, not buried.**

1. **The distributions overlap, on both splits.** Dev: weakest answerable 0.1523
   < strongest negative 0.1827. Held-out: the one false positive, "print and
   mail a physical postcard", scores **0.2362** — *above* a legitimate query,
   "on-chain analytics available on stellar mainnet", at **0.2091**. No
   threshold separates them. Any T strict enough to refuse the postcard also
   refuses a real query.
2. **Two negative queries in the dev split.** Two. Rejection rate can only move
   in 50% steps, so "100% rejection on dev" is two data points. This is a
   conservative default, not a calibrated threshold, and it is labelled as such
   in `DEFAULT_ABSTENTION_THRESHOLD`.
3. **Bias is deliberate.** A false positive makes an agent pay for the wrong
   service; a false negative makes it find nothing and retry. We prefer the
   retry.

**How it evolves.** Real `/discovery/search` logs: queries that returned results
but were never followed by a settlement are candidate false positives, and the
score distribution of queries that did convert yields a per-catalog threshold
instead of one global constant.

---

## E-15 — Deterministic filters execute before semantic ranking

**Claim.** A resource the buyer cannot pay for is not a low-ranked result. It is
not a result.

**Evidence, live against the six real listings:**
`?query=will it rain tomorrow?&network=stellar:pubnet` → `0` results,
`{"abstained":{"reason":"NO_ELIGIBLE_RESOURCES"}}`, while the same query with no
filter returns Weather Forecast first. `&type=mcp` → `0` results.

**Structural.** `SearchEngine.search` calls `store.list(filters)` to build the
candidate set *before* the query is embedded. Scoring never sees an ineligible
listing, so it cannot rank one.

**Unit-tested directly** (`packages/search/test/engine.test.ts`): the top
semantic match for "weather forecast pro" is a `stellar:pubnet` listing; adding
`network=stellar:testnet` removes it from the results entirely rather than
demoting it.

**Security properties tested alongside:** a query containing `'; DROP TABLE
listings; --` is treated as text and the catalog survives; a filter value
containing SQL matches nothing and writes nothing; a cursor from a different
query or a different filter set is refused (`INVALID_CURSOR`) so it cannot page
across a filter boundary; malformed cursors leak no SQL, table or column names;
hostile metadata is bounded (8000-char document cap) before reaching the
embedder; lone surrogates and zero-width characters do not crash indexing;
search performs no catalog writes; and every result carries `ownershipBinding`
so search cannot launder a spoofed listing into apparent legitimacy.

---

## E-16 — The search index is derived state, rebuildable from the catalog

**Claim.** The catalog is the source of truth; embeddings are a cache that can
be destroyed at any time.

**Tested** (`packages/search/test/engine.test.ts`): deleting every row from
`embeddings` and re-syncing rebuilds all vectors from `listings` and restores
identical ranking. A restart reuses persisted vectors (0 re-embedded). A
payment-only update — new amount, unchanged description — re-embeds **nothing**,
because freshness is keyed on the hash of the search document plus the model id
and representation version. A descriptive-metadata update re-embeds exactly one
listing and measurably changes the ranking.

---

## E-17 — MCP canonical keys are structurally correct before MCP exists

**Claim.** MCP listings key on `(resource.url, input.toolName)` per
specs/extensions/bazaar.md, even though no MCP server is implemented.

`mcpCanonicalKey` builds the key from the raw payload URL rather than upstream's
`extractDiscoveryInfo().resourceUrl`, because that field is wrong for `mcp:`
URLs: `mcp:` is not a WHATWG special scheme, so `url.origin` is the string
`"null"` and the canonical URL comes out as `null/tool/x`. That is
x402-foundation/x402 issue **#3121**, filed upstream by another team.

**Status.** ✅ Unit-tested. Not exercised by a real payment — see the limitation
in E-12.

---

## E-18 — Upstream x402 e2e suite against our facilitator — GREEN

**Claim.** The x402 repository's own e2e suite passes fully against our
facilitator: 9/9 payment scenarios and 5/5 Bazaar discovery endpoints, exit
status 0, with no client or protocol patches.

**Command.**
```
pnpm --filter @stellar-bazaar/e2e-stellar provision       # once
pnpm --filter @stellar-bazaar/e2e-stellar provision:usdc  # trustlines
e2e-harness/run-upstream-e2e.sh
```

| | |
|---|---|
| upstream commit | `c8247c4cd15f29498474404d94636e7dbb894e86` |
| our commit | see this commit |
| facilitator URL | `http://localhost:4027` (our adapter, spawned by the harness) |
| network / scheme | `stellar:testnet` / `exact` |
| asset | testnet USDC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Bazaar extension | enabled |
| artifact | `artifacts/e2e/upstream-e2e-results.json` |

**Per-server, per-client — all green.**

| Server | axios | fetch | mcp |
|---|:--:|:--:|:--:|
| express | ✅ | ✅ | — |
| fastify | ✅ | ✅ | — |
| hono | ✅ | ✅ | — |
| next | ✅ | ✅ | — |
| mcp | — | — | ✅ |

`Discovery Validation: PASSED — Discovered 5/5`.

**How our facilitator enters the suite.** Through
`e2e/facilitators/external-proxies/`, the directory upstream gitignores for
exactly this purpose. The adapter (`e2e-harness/proxy/`) maps harness env onto
our config, adds the `/close` endpoint the rig calls between scenarios, and
imports `buildFacilitator` unmodified. **No client or protocol package is
patched.** Configuration changes only: two throwaway credentials for protocol
families this run does not test, and upstream's own build steps.

---

## E-19 — Canonical Stellar testnet USDC settlement

**Claim.** All nine payments settled in canonical testnet USDC, fee-sponsored,
submitted by our own signer.

**Nine transaction hashes**, one per payment case:
```
117b374785bf3bdfdd8ff7d5ac888771fd62ee5faf27372efb4f2e2fbffacc4d
176212ceff76044485dd703acbea4aeedc5b85e29b404890543e6f2790192452
46b6fb48390b9154478ccb97dbfb1bd85ac36b0d78824f9d63087b9734592a51
4dfff09dc8cf15ce82d5e6cae1a30e865e3bb02c9a7769507eff5ca3f747a6e2
8558d67ec03f6f593f9921d181c74a610672cf4f32f21c7a6339b7ea585b775e
8dea2302dae6b2d25b929107868e654a16f643ab8127d19accf898565efcdb40
c99ef0cd1dc14a4566a3ffa1193e5ca3202e61341b1a1de97f857e9d2439c10c
e2d72fd61ee1e65d1a39bcaa280743b96744e7484018613e966145daa00ac0d3
f369e3fd7f18657e63a16c6bacaea77def9d46abff5cefb08df38345958b5cbf
```

| | before | after | delta |
|---|---|---|---|
| buyer `GBA75KBI…R7N6` USDC | 20.0000000 | 19.9910000 | **−0.0090000** |
| buyer XLM | — | — | **+0.0000000** |
| seller `GDOEUTRI…3ULR` USDC | 0.0000000 | 0.0090000 | **+0.0090000** |
| facilitator `GABMU5BF…TL5X` XLM | — | — | **−0.0206757** |

Nine payments × `0.0010000` USDC. **The buyer spent no XLM at all** — fee
sponsorship (`extra.areFeesSponsored: true`) demonstrated on chain rather than
asserted in a header. The facilitator signer paid every fee.

Artifacts: `artifacts/e2e/balances-before-green.json`,
`artifacts/e2e/balances-after-green.json`.

**Caught by measuring, not by trusting.** An earlier run of this same command
reported 9/9 "USDC" — and the chain showed **zero USDC movement and 0.009 XLM
moving instead**. `git checkout <sha>` carries local modifications across rather
than discarding them, so a previous `--asset native` rewrite of
`mechanisms_stellar.json` had silently persisted. Fixed with an explicit
`git checkout --force <sha> -- .`. This is the second time balance verification
caught a green run measuring the wrong thing (see E-06a); it is why every claim
here cites deltas.

---

## E-20 — Framework interoperability, and the Hono+fetch investigation

**Claim.** Express, Fastify, Hono, Next and MCP resource servers all settle and
all catalog against our facilitator, with both stock HTTP clients. Evidence: the
per-server table in E-18, all cells green, from a single run.

### The Hono + fetch failure: BOUNDED, root cause UNKNOWN

It failed once during an earlier run with `SyntaxError: Unexpected end of JSON
input` — an empty response body on the final 200, after a settlement that had
already succeeded. We refused to call it a flake and measured it.

**Measurements**

| Configuration | Runs | Failures | Rate |
|---|---:|---:|---:|
| hono+fetch, upstream harness, cold model cache | 13 | 8 | **61.5%** |
| hono+fetch, upstream harness, warm model cache | 10 | 2 | **20.0%** |
| hono+fetch, upstream harness, after our fix below | 12 | 3 | **25.0%** |
| **fastify+fetch, same harness / facilitator / client** | 8 | 0 | **0.0%** |
| hono, in-process, stock `@x402/hono`, no warmup | 30 | 0 | 0.0% |
| hono, in-process, upstream server shape, no startup delay | 20 | 0 | 0.0% |
| hono, in-process, unpaid request first | 10 | 0 | 0.0% |
| express / fastify, in-process | 20 | 0 | 0.0% |

Reproducers: `e2e-harness/measure-hono-fetch.sh`,
`e2e-harness/measure-fastify-fetch.sh`,
`pnpm --filter @stellar-bazaar/hono-repro repro`.
Raw observations (status, `content-length`, `transfer-encoding`, body byte
length, settlement result, timings) in `artifacts/e2e/hono-fetch-repro.json`.

**What the controls exclude.**

- **Not our facilitator.** Fastify+fetch through the *same harness, same
  facilitator process, same client* fails 0/8 while hono fails 3/12.
- **Not the fetch client.** Same client, passes with fastify, express and next.
- **Not `@x402/hono` middleware, hono, or `@hono/node-server`.** 60 in-process
  runs with the stock middleware — including a byte-for-byte replica of the
  upstream server's shape (`app.use("*", …)`, no startup delay, default
  `syncFacilitatorOnStart`) — produced 60 non-empty 200s and zero failures.

**What remains.** It reproduces only when hono runs as a **separate process
under the upstream harness**. That leaves harness timing or process lifecycle,
and we have not isolated which. Classification: **UNKNOWN AFTER CONTROLLED
MEASUREMENT**, bounded by the controls above.

**Nothing has been filed upstream, and nothing should be.** The failure is not
reproducible independently of the harness, so there is no minimal reproducer
that would let a maintainer act on it. Filing a 25%-flaky harness scenario with
"we could not reproduce it outside your test rig" would waste their time.

**Our own bug, found on the way and fixed.** `onAfterSettle` used to
`await search.sync()`, putting embedding work — including a one-time ~90MB model
download on a cold process — between a completed settlement and the seller's
`/settle` response. The catalog write has already happened and the index is
derived state, so the seller was waiting for nothing. It is now scheduled in the
background and coalesced: at most one sync in flight, one more queued, never on
the response path (`apps/facilitator/src/app.ts`, `scheduleSearchSync`).

Reported honestly: **that fix did not change the failure rate** (20% before,
25% after — indistinguishable at these sample sizes). The large drop from 61.5%
to 20% came from the model cache being warm, not from the fix. The fix is
correct on its own merits — settlement latency must not depend on index
maintenance — and it removes that cost permanently, but it is not the
explanation for the residual failures.

**Impact on the deliverable: none.** The upstream suite is green end to end
(E-18), re-verified after this change: 9/9 payments, 5/5 discovery, exit 0.

## E-21 — Bazaar discovery wire compatibility with stock clients

**Claim.** `GET /discovery/resources` is readable by unmodified upstream
tooling: the suite's own discovery validator parses our response and finds all
five endpoints it expects.

Two of our bugs stood between us and this, both found by the suite and neither
findable by reading the spec prose.

**1 — wrong envelope.** We returned `{resources, pagination}`. Stock clients
parse `{x402Version, items, pagination}`, and the asymmetry is real: the list
endpoint returns `items` while search returns `resources`
(`@x402/extensions@2.22.0` `bazaar/facilitatorClient.ts:126-159`). Each resource
also needs `resource`, `type`, `x402Version`, `accepts[]` and `lastUpdated`; we
emitted storage column names. Fixed in `packages/catalog/src/wire.ts`.

**2 — over-strict `routeTemplate` handling.** The Next server routes through a
catch-all and emits `routeTemplate: ":var1"`, with no leading slash, which
upstream's `isValidRouteTemplate` rejects. Upstream then soft-*drops* the field
and keys the listing on the URL's own pathname. We rejected the entire listing —
a deliberate divergence recorded in E-10, reasoning that re-keying to an
undeclared path was worse than not listing.

That reasoning was wrong in both directions. It was non-conformant: the suite's
discovery validation expects the resource present, and we silently lost it (4/5)
while every payment passed. And it was backwards on the merits: the fallback is
the pathname the buyer *actually paid against*, which no client controls, making
it strictly more trustworthy than an attacker-supplied template. We now match
upstream — drop the template, keep the listing, and surface
`droppedRouteTemplate` on the outcome so a seller can see their field was
ignored.

The security property is unchanged and still tested: a hostile template
(`/../../etc/passwd`, `/%2e%2e/x`, `/a/https://evil.example/b`, `:var1`) is
never stored and never moves the canonical key — all of them collapse onto the
single URL that was paid for.

**Regression test:** `packages/catalog/test/next-wire.test.ts` replays the exact
wire shape captured from a live Next settlement (`TRACE_SETTLE=1`), verbatim.

**MCP listing:** `mcp://tool/exact_stellar#tool=exact_stellar` was cataloged
from a real payment under our `(resource.url, toolName)` key, upgrading E-17
from unit-tested to observed end to end.

---

## E-22 — An agent discovers an MCP tool through Bazaar with no pre-baked integration

**Claim.** Given a sentence and nothing else, an agent finds a paid MCP tool it
has never seen, and gets back everything needed to decide whether to pay.

**Command.** `pnpm --filter @stellar-bazaar/e2e-stellar mcp`
**Artifact.** `artifacts/e2e/mcp-discovery-pay-call.json`

The agent is handed the query *"I need something that can condense a long
passage of text"*. No URL, no tool name, no payment terms. `bazaar_search`
returns:

```
Text Summarizer → mcp://127.0.0.1:4531/tool/summarize_text
stellar:testnet · exact · 10000 · CBIELTK6…QDAMA · payTo GDOEUTRI…
inputSchema present · ownershipBinding: tofu
```

The tool entered the catalog the only way anything can: a real settled payment
(`530f07513fdebfdc…`). No direct insert.

`ownershipBinding: tofu` is on every result. The party being asked to spend is
told the binding is trust-on-first-use, not proof of URL control.

**Status.** ✅ PASS 2026-08-13.

---

## E-23 — The agent pays and invokes the discovered tool on Stellar testnet

**Claim.** Discovery → live 402 → Soroban auth entry → verify → settle → invoke
→ result, end to end, in canonical testnet USDC.

| | |
|---|---|
| **transaction** | **`f92a6aeca76861010f90f7e36d11837e6a9463df40b4a0b9024b6a2c6c16ed4b`** |
| network / scheme | `stellar:testnet` / `exact` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (USDC) |
| amount | `10000` (0.0010000) |
| payer | `GBA75KBIVWVJ53QOTG5E3K5O5BJQUHDKT6EYZCCABCB32YSNJZNQR7N6` |
| payTo | `GDOEUTRI3CA534VATJBFTEFDOOAQR47UQBBLNRQ2IWAPLHV2OF433ULR` |
| facilitator signer | `GABMU5BF3MJ6HAB5BIKKP27KADMWCNDWQPG7EEYX3HSIPU2YMHAKTL5X` |
| total latency | 8612 ms |
| settlement latency | 8598 ms |

Tool arguments: a 38-word passage. Tool result:
`"The Stellar Bazaar lets an autonomous agent find… (38 words)"`.

Explorer: https://stellar.expert/explorer/testnet/tx/f92a6aeca76861010f90f7e36d11837e6a9463df40b4a0b9024b6a2c6c16ed4b

**No second stack.** `bazaar_search` is an adapter over `GET /discovery/search`
— same hard filters, same dense ranking, same abstention threshold, same cursor
semantics, because it is the same endpoint. `bazaar_pay_and_call` is an adapter
over the stock `@x402/mcp` client with `autoPayment`; it builds no payload of
its own. The MCP layer owns schemas, orchestration and error translation, and
nothing else.

**Status.** ✅ PASS 2026-08-13.

---

## E-24 — Live payment requirements override stale discovery metadata

**Claim.** Catalog terms are advisory. The live 402 is the contract, and a
disagreement stops the payment instead of silently proceeding.

Before signing, `bazaar_pay_and_call` re-fetches requirements from the tool
itself and compares network, scheme, asset, payTo and amount against what the
caller discovered. Verified live in the same run:

| Scenario | Result |
|---|---|
| discovered amount no longer matches the live offer | `PAYMENT_REQUIREMENTS_CHANGED`, nothing signed |
| live price above the caller's `maxAmount` | `PRICE_EXCEEDS_LIMIT`, nothing signed |
| resource is the spec's authority-less `mcp://tool/name` | `INVALID_RESOURCE`, no network contact |

The ceiling is enforced twice: once in the pre-flight check, and again as a
`policies` filter on the stock client, so a bug in the former cannot let the
latter sign something dearer than allowed.

**Status.** ✅ PASS 2026-08-13.

---

## E-25 — Deterministic, machine-readable failures

**Claim.** Every rejection carries a code from a closed set plus a non-null
sentence, and leaks nothing.

Codes: `NO_MATCH`, `BELOW_RELEVANCE_THRESHOLD`, `INVALID_RESOURCE`,
`PAYMENT_REQUIREMENTS_CHANGED`, `PRICE_EXCEEDS_LIMIT`, `UNSUPPORTED_NETWORK`,
`UNSUPPORTED_ASSET`, `PAYMENT_FAILED`, `SETTLEMENT_FAILED`,
`TOOL_INVOCATION_FAILED`, `DISCOVERY_UNAVAILABLE`.

15 unit tests in `apps/mcp-discovery/test/tools.test.ts` cover search
translation, abstention passthrough, catalog-down, non-200, asset filtering,
filter/cursor forwarding, endpoint parsing and message redaction.

**No atomicity is implied, because there is none.** x402 does not make
settlement and invocation atomic. A payment can settle and the tool can then
fail. When that happens the failure is `TOOL_INVOCATION_FAILED` and it carries a
`paid` block with the transaction hash, amount, asset and network — the caller
is told money moved, rather than left to infer it.

**SSRF.** The adapter dials only a host taken from an `mcp://` URL. `http(s)://`,
`file://` and malformed resources are refused with `INVALID_RESOURCE` before any
connection, tested against a link-local metadata address among others.

**Redaction.** `safeReason` drops any message containing a filesystem-ish path,
credentials in a URL, or a long base32 run that could be a Stellar secret.
Fixing a test failure here surfaced a real weakness: the original pattern
anchored on a secret's exact 56-character length, so a token one character
longer passed through. It now matches any long base32 run and errs toward
dropping.

**Status.** ✅ PASS 2026-08-13.

---

## Spec gap — Bazaar cannot express an MCP server's address

`McpDiscoveryInfo.transport` is constrained to a transport *kind*
(`"sse" | "streamable-http"`), and the spec's canonical resource identity is
`mcp://tool/{toolName}` — which parses with host `tool` and carries no
authority. **There is no field anywhere in the Bazaar extension for the endpoint
an MCP server actually listens on**, so a discovered MCP tool can be identified
but not reached, and discovery→invoke cannot be closed by a third party.

Our workaround: sellers publish an authority in `resource.url`
(`mcp://host:port/tool/name`). This keeps the spec's `(resource.url, toolName)`
identity intact and is not a private extension — any facilitator reading the
same URL reaches the same server. It is recorded here as an upstream discussion
item; nothing has been filed yet.

---

## E-26 — The resolved runtime graph contains no forbidden copyleft

**Claim, scoped precisely.** *The resolved production dependency graph of the
workspaces we operate as a network service — `apps/facilitator`,
`apps/mcp-discovery`, `packages/catalog`, `packages/search` — contains no
AGPL, GPL, SSPL or other strong-copyleft dependency under the stated policy.*
Not "all software everywhere is permissive".

**Command.** `pnpm audit:licenses`
**Artifacts.** `artifacts/compliance/licenses.json`, `licenses.txt`

| | |
|---|---|
| resolved packages | 244 |
| runtime packages | 238 |
| tooling/dev-only | 6 |
| forbidden | **0** |
| unknown | **0** |
| needing review | **0** |

Runtime licence distribution: MIT 202, BSD-3-Clause 11, ISC 11, Apache-2.0 10,
BSD-2-Clause 2, `(MIT OR CC0-1.0)` 1, Unlicense 1.

**Method.** The graph comes from `pnpm list --prod --depth Infinity` per runtime
workspace — the resolved tree, not the direct dependencies in `package.json`.
Each licence is read from the package **as installed on disk**: the `license`
field first, then the shipped `LICENSE` file, and only headers that are
unmistakable are recognised. A dual licence passes only if one option is on the
allow list, and any forbidden term anywhere in an SPDX expression fails, because
we will not rely on an unstated election.

The policy fails on `unknown` and on anything needing review, not just on
forbidden. Silently normalising `SEE LICENSE IN LICENSE.md` into MIT is the
exact mistake this exists to prevent.

**Status.** ✅ PASS 2026-08-13.

---

## E-27 — The search and model runtime is permissively licensed, artifacts included

**Claim.** The embedding stack — loader, native binaries and model artifacts —
is permissive end to end.

| Component | Licence | Evidence |
|---|---|---|
| `onnxruntime-node@1.24.3` | MIT | package metadata; repository `github.com/Microsoft/onnxruntime` |
| `onnxruntime-common@1.24.3` | MIT | package metadata |
| `@huggingface/tokenizers@0.1.3` | Apache-2.0 | packaged `LICENSE`; **zero dependencies of its own** |
| `better-sqlite3@13.0.3` | MIT | package metadata |
| model `Xenova/all-MiniLM-L6-v2` | Apache-2.0 | stated on the model repository, verified at source |

Model artifacts, fetched at a pinned revision and hashed:

```
model.onnx             759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e
tokenizer.json         da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0
tokenizer_config.json  9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3
```

The licence claim is about the artifacts we actually download, not merely the JS
wrapper. `Xenova/all-MiniLM-L6-v2` is an ONNX export of
`sentence-transformers/all-MiniLM-L6-v2`; the export repository states
`apache-2.0`.

`onnxruntime-node` redistributes native binaries (`libonnxruntime.so.1`,
`libonnxruntime.*.dylib`, `onnxruntime_binding.node`) for linux x64/arm64 and
darwin arm64. The package ships no `LICENSE` file, so the MIT claim rests on its
metadata and on ONNX Runtime's own repository rather than on a bundled file —
recorded here rather than glossed over.

### The finding that made this worth doing

The first audit run **failed**. `@huggingface/transformers` depends on `sharp`,
which ships prebuilt `@img/sharp-libvips-*` binaries under
**LGPL-3.0-or-later** — 23 packages, one of them copyleft, pulled into the
runtime path purely for image preprocessing we never invoke.

LGPL is weak copyleft and libvips is dynamically linked (a 15.3MB `.dylib`), so
a compliance argument exists. RFP §3.6 asks for better than an argument. We
replaced the loader: `packages/search/src/embedder.ts` now drives the ONNX
session directly through `onnxruntime-node` and `@huggingface/tokenizers`,
removing `sharp` and every `@img/*` package.

**The swap is behaviourally neutral, and that was verified rather than assumed.**
Cosine similarities are byte-identical on a fixed probe (0.4862 / 0.0209), and
the full benchmark is unchanged: held-out nDCG@10 stays at baseline 22.6%,
BM25 83.0%, dense 95.3%, hybrid 93.5%. Every retrieval number in E-02, E-13 and
E-14 still describes the shipped code.

**Status.** ✅ PASS 2026-08-13.

---

## E-28 — No OpenZeppelin AGPL code in the dependency or deployment path

**Claim.** No OpenZeppelin Relayer package, x402 plugin or relayer SDK appears
anywhere in the resolved graph, runtime or tooling.

RFP §3.6 and the RFP Appendix name these specifically: the Relayer, its x402
plugin and the relayer SDK are AGPL-3.0-or-later and are "unusable code base to
use or study", with AGPL's network clause applying to a service serving third
parties.

**Evidence.** `pnpm audit:licenses` scans every resolved package name for
`openzeppelin` and `relayer` across both runtime and tooling graphs and fails
the build on any match. Current result: `openzeppelin/relayer matches: none`,
recorded in `artifacts/compliance/licenses.json` under `openzeppelinMatches: []`.
Zero packages in the graph carry an AGPL or GPL licence string.

**We also did not read it.** The RFP says the codebase is unusable to *use or
study*; no OpenZeppelin source was consulted at any point in this work. Our
facilitator is built on `@x402/stellar` (Apache-2.0) and patterns from
`stellar/x402-stellar` (Apache-2.0).

**Status.** ✅ PASS 2026-08-13.

---

## E-29 — Licence compliance is enforced continuously

**Claim.** A dependency update that introduces a forbidden or unclassifiable
licence fails CI before merge.

`.github/workflows/ci.yml` runs typecheck, the full test suite and
`pnpm audit:licenses` on every push to `main` and every pull request. The audit
exits non-zero on a forbidden licence, an unknown licence, a package needing
manual review, or any OpenZeppelin/relayer match. Compliance artifacts are
uploaded on every run, including failures, so a reviewer can see what changed.

The gate is deliberately noisy: a new licence string that the policy has never
seen fails the build rather than being accepted because it looks harmless.

**Status.** ✅ PASS 2026-08-13.

---

## Container and system scope

We do not ship a Docker image yet. When we do, the base image and its OS
packages will be recorded here; the RFP-relevant question is anything *we*
bundle, and today that is the three model artifacts above plus the
`onnxruntime-node` native binaries, both covered in E-27.

---

## Open items

Source of truth as of 2026-08-13. Everything not listed here is closed and has
an E-number above.

| Item | Status | Blocking |
|---|---|---|
| `stellar:pubnet` deployment and a mainnet settlement | not started | tranche 3; no mainnet funds moved to date |
| `.well-known/x402` domain binding — closes the TOFU squat in E-11 | designed, not built | before mainnet |
| `upto` Stellar scheme: design doc, then Soroban contract | not started | tranche work; spec PR #3098 is another team's |
| Hono+fetch residual ~25% failure under the upstream harness | BOUNDED (E-20) | not blocking; no upstream filing until reproducible outside the rig |
| Propose an MCP endpoint field to the Bazaar spec | not filed | discussion; workaround in place and conformant |
| Docker image, base image and OS package licences | not built | before a hosted deployment |
| Abstention threshold recalibrated on real query logs | not started | needs production traffic; today's 0.22 rests on 2 dev negatives |
| Operational runbook and monitoring | not started | RFP §5 deliverable |
| Role-based developer guide contributed to Stellar Developer Docs | not started | RFP §5 deliverable |
| Third-party security review via the Audit Bank | not started | before the mainnet production tag |

### Closed

Retrieval benchmark and abstention calibration (E-01…E-04, E-14) · `/supported`
conformance (E-05) · stock-client testnet settlement (E-06) · automatic Bazaar
cataloging with ownership binding (E-09…E-11, E-16, E-17) · natural-language
`/discovery/search` over the persistent catalog (E-12…E-15) · upstream x402 e2e
suite 9/9 payments and 5/5 discovery in canonical testnet USDC, fee sponsorship
proven on chain (E-18…E-21) · MCP discovery server, agent discovery → pay →
invoke (E-22…E-25) · transitive licence audit and CI gate (E-26…E-29).
