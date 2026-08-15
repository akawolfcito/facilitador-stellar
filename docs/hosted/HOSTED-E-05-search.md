# HOSTED-E-05 — Semantic search over the hosted catalog

**Claim.** The hosted facilitator answers a natural-language query with the
resource that was cataloged by a real payment.

`GET https://facilitator.testnet.x402seek.xyz/discovery/search?query=…`

Query: *"I need something that can condense a long passage of text"*

```
abstained  no
top        Text Summarizer
resource   https://demo-api.testnet.x402seek.xyz/summarize
```

The query shares no vocabulary with the listing's title. "Condense" does not
appear in "Text Summarizer", and a substring matcher returns nothing for this
sentence — which is the gap the whole discovery layer exists to close.

## Where this result comes from

The **hosted facilitator's own index**, built from its own catalog: one listing,
placed there by the settlement in
[HOSTED-E-02](./HOSTED-E-02-settlement.md). After the restart in
[HOSTED-E-06](./HOSTED-E-06-restart.md), `/health` reports:

```json
{"discovery":{"status":"ready","indexed":1},"catalog":1}
```

It is **not** the frozen preview catalog served by `x402seek.xyz`, which holds
seven listings from recorded local runs and is a different data source entirely.

## What this is not

This is **not** a retrieval quality measurement, and it must not be read
alongside the benchmark numbers as if it were one.

The synthetic benchmark in `docs/research/bazaar-retrieval-evaluation.md` — 65
listings, 56 queries, a held-out split, labels written before any retriever
existed — is what supports any claim about ranking quality. Those numbers are
tied to `762c6e6` and are unchanged.

What this evidence shows is narrower and different: that the same engine, the
same document representation and the same abstention threshold behave as
expected when the catalog is real, hosted, and populated by an actual payment. A
catalog of one cannot measure ranking. It can show that the pipeline runs end to
end in public, which is all this claims.
