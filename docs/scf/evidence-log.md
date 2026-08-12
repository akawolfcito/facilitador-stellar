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

**Claim (not yet earned).** An unmodified canonical x402 client completes a
payment against our facilitator on `stellar:testnet`, and against
`stellar:pubnet`.

**Required evidence.** Settled transaction hash per network per scheme; a
passing run of the x402 repo's own `e2e/` suite using
`e2e/config/mechanisms_stellar.json` (which already declares route
`/exact/stellar` with `"extensions": ["bazaar"]`).

**Status.** ⏳ Not done. This is the Aug 12 stop condition.

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
| E-06 | Stock-client testnet payment + tx hash | Aug 12 stop condition |
| — | x402 `e2e/` suite green against our deployment | Aug 15 stop condition |
| — | Persistent catalog + automatic cataloging via `onAfterSettle` | Aug 13 stop condition |
| — | `/discovery/resources` + `/discovery/search` served from the index | Aug 13 |
| — | MCP discovery server | Aug 15 |
| — | Transitive licence audit | before submission |
| — | `upto` Stellar design doc | tranche work |
