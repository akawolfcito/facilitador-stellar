# Bazaar Retrieval Evaluation

**Measuring how well an x402 discovery index actually answers a natural-language query.**

Run: `pnpm eval:retrieval` · Artifact: `artifacts/retrieval-eval/latest.json`
Corpus `2026-08-11.1` (65 documents) · Queries `2026-08-11.1` (56 total: 36 dev / 20 held-out)
Node v22.20.0, darwin. First run downloads ~90MB of model weights; later runs are offline.

---

## 1. Why this exists

`specs/extensions/bazaar.md` defines `GET /discovery/search` as taking a
*"natural-language search query"*. It does not say how well the search has to
work, and it labels the endpoint **optional**. RFP §3.2 responds to exactly that
gap:

> Search quality is a deliverable, not a detail: this means real ranking, and
> submissions must describe both their retrieval approach and how they will
> evaluate result quality over time. It is the hardest part of the scope and the
> part existing catalogs most often leave unimplemented.

You cannot claim search quality without measuring it, and nobody in the x402
ecosystem has published a measurement. This harness is that measurement.

## 2. What the reference implementation does today

`examples/typescript/facilitator/advanced/bazaar.ts:87-108`
(x402-foundation/x402 @ `c8247c4`) — the only server-side Bazaar search in the
monorepo, mirrored in the Python and Go examples:

```ts
const needle = query.toLowerCase();
let results = Array.from(this.resources.values()).filter((r) => {
  const haystack = [ r.resource, r.type, r.description ?? "", r.serviceName ?? "",
    ...(r.tags ?? []), ...Object.values(r.extensions ?? {}) ].join(" ").toLowerCase();
  return haystack.includes(needle);
});
```

The whole query is one substring needle. `"weather"` works. *"what service can
tell me whether it will rain tomorrow?"* matches nothing, because no document
contains that sentence.

We reproduce this faithfully as the `baseline-includes` retriever — reading the
same fields every other retriever reads, so the comparison measures ranking and
not field access. Deliberately not weakened: beating a strawman would prove
nothing.

## 3. Results

nDCG@10, mean over queries. **Held-out is the number that counts** — no tuning
touched those 20 queries.

| Retriever | held-out nDCG@10 | dev nDCG@10 | MRR@10 | Recall@20 | p95 latency |
|---|---:|---:|---:|---:|---:|
| `baseline-includes` — x402 reference | **22.6%** | 24.3% | 27.8% | 12.7% | 0.0 ms |
| `bm25` — Okapi BM25, k1=1.2 b=0.75 | **83.0%** | 80.2% | 90.7% | 78.4% | 0.0 ms |
| `dense` — all-MiniLM-L6-v2, 384d cosine | **95.3%** | 93.1% | 100.0% | 95.9% | 3.1 ms |
| `hybrid-rrf` — RRF(BM25, dense), k=60 | **93.6%** | 90.6% | 97.2% | 95.9% | 2.4 ms |

Dense retrieval is **4.2x** the reference implementation on unseen queries
(+72.8 nDCG points).

### The result that matters most

Per-category nDCG@10 for the baseline, over all 52 answerable queries:

| Category | n | baseline | bm25 | dense |
|---|---:|---:|---:|---:|
| exact (`"weather"`, `"OCR"`) | 8 | 68.1% | 87.1% | 97.1% |
| ambiguous (`"price"`, `"search"`) | 8 | 86.1% | 83.4% | 91.5% |
| **natural-language** | 14 | **0.0%** | 59.0% | 94.7% |
| **constraint** | 8 | **0.0%** | 95.8% | 90.1% |
| **multi-intent** | 8 | **0.0%** | 89.8% | 91.0% |
| **mcp** | 6 | **0.0%** | 90.9% | 99.5% |

**The reference implementation scores exactly zero on 36 of 52 answerable
queries.** Not "poorly" — zero. It returns an empty result set for every
natural-language, constraint, multi-intent and MCP-phrased query in the
benchmark, because none of them appears verbatim in any document.

This is the concrete, measurable form of the gap the RFP describes. An agent
pointed at a reference Bazaar can find a service only if it already knows the
service's vocabulary — which defeats discovery.

### An honest negative result: the hybrid is worse than dense alone

We expected RRF fusion to win. It did not: **93.6% vs 95.3% held-out**, and the
gap is concentrated in the category we care most about — natural-language, where
hybrid scores **83.9%** against dense's **94.7%**.

Why: RRF reads rank, not confidence. On a paraphrase query BM25's ranking is
close to noise, but RRF still awards it `1/(60+rank)` for whatever it put first,
which is enough to displace a correct dense hit. Fusion helps when both arms are
individually informative; here one arm is not.

We are reporting this rather than quietly shipping the hybrid because a
benchmark that only ever confirms the author's prior is not a benchmark. The
practical consequence: **dense-first is the current recommendation**, with BM25
retained for exact-term queries where it beats dense on constraint (95.8% vs
90.1%). The obvious next experiment is score-aware fusion with a confidence
threshold on the lexical arm, evaluated the same way.

### Behaviour on unanswerable queries

Four queries ("book me a dentist appointment", "print and mail a physical
postcard") have no relevant document. nDCG over an empty relevant set is
undefined, so these are excluded from the tables above and reported separately.

| Retriever | median top-1 score, negatives | median top-1, answerable | separation |
|---|---:|---:|---:|
| `bm25` | 0.0000 | 8.3905 | **0.000** |
| `dense` | 0.1776 | 0.4477 | 0.397 |
| `hybrid-rrf` | 0.0164 | 0.0328 | 0.500 |

Lower separation is better: it means the retriever's own confidence distinguishes
"I found it" from "there is nothing here", which is the precondition for an
abstention threshold. BM25 abstains perfectly by construction (no shared term,
no score). Dense always returns *something* at cosine ≈ 0.18 — an agent acting on
that would pay for an irrelevant service. **A calibrated abstention threshold is
therefore a required deliverable, not a nicety**, and it is the strongest
argument for keeping the lexical arm in the system even though it loses on
nDCG.

## 4. Method

**Corpus.** 65 synthetic services — 55 HTTP, 10 MCP — across weather, translation,
imaging, documents, search, travel, identity, logistics, blockchain and compute.
Built adversarially: four overlapping weather services; three translation
services plus "Token Translation Table", a deliberate lexical distractor that
resolves asset identifiers; "price" spanning market data, FX, shipping quotes,
customs duty and network fees. Payment metadata uses the real USDC contract ids
from `@x402/stellar@2.22.0` `src/constants.ts`; 62 listings are
`stellar:testnet`, 2 `stellar:pubnet`, 1 `eip155:8453` so network filters have
something to exclude.

**Queries.** 56, split 36 dev / 20 held-out, across seven categories: exact,
natural-language, constraint, ambiguous, multi-intent, mcp, negative. Graded
judgments 0–3 (3 = essentially this service, 1 = an agent might reasonably
consider it), 3.10 relevant documents per answerable query on average.

**Metrics.** nDCG@5/@10 with exponential gain `2^rel - 1` and `log2(rank+1)`
discount; MRR@10; Recall@10/@20; latency p50/p95 around `search` only, excluding
the amortised index build. All implemented in-package against hand-computed
fixtures (21 unit tests) rather than pulled from a library.

**Hard filters before ranking.** `type`, `network`, `scheme`, `asset`, `payTo`
are applied by the harness identically for every retriever, before any score is
read. A semantically perfect match on the wrong network is not a worse result,
it is an unpayable one. `test/filters.test.ts` asserts directly that a hit with
score 0.99 outside the filter never outranks a payable hit at 0.42, and that
truncation happens after filtering rather than before.

**Dependencies.** All permissive, all pinned:
`@huggingface/transformers@4.2.0` (Apache-2.0), `onnxruntime-node` (MIT),
model `Xenova/all-MiniLM-L6-v2` (Apache-2.0). No hosted model API — the embedder
runs in-process, so the benchmark reproduces without a key and a self-hoster
inherits the same property. This satisfies RFP §3.6's requirement that every
dependency be compatible with permissive redistribution and with operating the
code as a network service.

## 5. Threats to validity

Stated plainly, because the RFP grades the evaluation method and not the score.

1. **Author-written corpus and queries.** The same author wrote the service
   descriptions and the queries. Descriptions are fluent prose that may
   paraphrase the queries more naturally than a real seller's copy would, which
   plausibly flatters the dense retriever. **This is the single largest caveat
   and it inflates the absolute numbers.** The *relative* ordering is more
   robust — the baseline's zeros are a structural property of substring
   matching, not an artefact of phrasing — but a 95.3% should be read as "works
   on well-described services", not as a production expectation.
2. **Labels are author-assigned**, not pooled from multiple annotators and not
   derived from user behaviour. No inter-annotator agreement is reported because
   there is only one annotator. No retriever produced or influenced them: they
   were written against the corpus before any retriever existed.
3. **Small scale.** 65 documents. IDF statistics, ANN recall and latency all
   behave differently at 10⁴–10⁶ listings. Latency numbers here are exact search
   over 65 vectors and say nothing about a production index.
4. **Single embedding model, single language.** English only. No multilingual
   evaluation, and Bazaar listings will not be English-only.
5. **Held-out is small** (20 queries). A 1.7-point gap between dense and hybrid
   on that split is within noise; the natural-language category gap (10.8
   points, n=14) is the more trustworthy signal.

## 6. How this improves over time

RFP §3.2 asks not just for a retrieval approach but for how quality is evaluated
as the system runs. The path from this harness to that:

- **v0.1 (here).** Synthetic corpus, author labels, four retrievers, committed
  metrics, one command, machine-readable artifact.
- **v0.2.** Corpus generated from real cataloged listings once the index runs on
  testnet, so document text stops being ours. Second annotator on a sample, with
  Cohen's κ reported.
- **v0.3.** Query set seeded from real `/discovery/search` logs rather than
  imagination. This is the change that retires threat 1 — the queries stop being
  written by the person who wrote the documents.
- **v0.4.** Click/settlement feedback as implicit relevance: a listing that gets
  discovered *and then paid* is a positive. Report nDCG against implicit labels
  alongside the curated set.
- **Continuous.** The benchmark runs in CI on every change to retrieval, and the
  held-out nDCG@10 is a release gate. A regression fails the build.

## 7. Reproducing

```bash
nvm use            # 22.20.0
pnpm install
pnpm test          # 61 unit tests: metrics, retrievers, filters, config
pnpm eval:retrieval
```

Output: table above plus `artifacts/retrieval-eval/latest.json` carrying every
per-query metric, the corpus and query-set versions, and the environment.
