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

## Open items

| Id | Item | Blocking |
|---|---|---|
| — | Same run against USDC instead of native XLM | before submission |
| — | `stellar:pubnet` run | tranche 3 |
| — | x402 `e2e/` suite green against our deployment | Aug 15 stop condition |
| — | Persistent catalog + automatic cataloging via `onAfterSettle` | Aug 13 stop condition |
| — | `/discovery/resources` + `/discovery/search` served from the index | Aug 13 |
| — | MCP discovery server | Aug 15 |
| — | Transitive licence audit | before submission |
| — | `upto` Stellar design doc | tranche work |
