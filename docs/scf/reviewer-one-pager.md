# Stellar Bazaar — reviewer one-pager

**SCF #45 · "X402 Facilitator with Bazaar (discovery) support"**
Full proposal: [`proposal.md`](./proposal.md) · Evidence: [`evidence-log.md`](./evidence-log.md)

---

## Problem

Stellar can already settle agent payments. `@x402/stellar` does `exact` on both
networks, a public facilitator runs it, and network fees can be sponsored — in
our nine-payment run the buyer's XLM balance changed by exactly zero (E-19).

What an agent cannot do is reliably **find what to pay for**. The only
server-side Bazaar search in the x402 monorepo matches the whole query as one
lowercase substring. `"weather"` works; *"what service can tell me whether it
will rain tomorrow?"* matches nothing.

Payments are machine-readable. Discovery needs to become decision-grade.

## Why now

We verified the gap independently rather than taking the RFP's word: SDF's own
reference facilitator has no discovery code, and the public x402.org facilitator
returns **HTTP 404** on `/discovery/resources` while correctly serving Stellar
payments. The RFP calls search quality *"the hardest part of the scope and the
part existing catalogs most often leave unimplemented."*

## Why this is a payment-safety problem, not a search problem

When the consumer is software with a wallet, a bad result is not a wasted click
— it is a wasted payment. So ranking quality, abstention, and revalidating
payment terms before signing all belong to payment safety.

That framing produced three things a normal search layer would not have: hard
payment filters that run *before* semantic ranking, an engine that returns
nothing rather than recommend a service it does not believe in, and the rule
that **the live 402 is the contract while the catalog is advisory**.

## What we already proved

Working today, reproducible from the repository, testnet:

- **Upstream x402 e2e suite: 9/9 Stellar payment scenarios, 5/5 Bazaar discovery
  checks, exit 0**, against our facilitator with **no client or protocol
  patches** (Express, Fastify, Hono, Next, MCP; axios and fetch).
- **All nine settled in canonical testnet USDC**, with the buyer spending
  **0.0000000 XLM** — fee sponsorship demonstrated by on-chain balance deltas
  rather than asserted in a header. Facilitator paid every fee.
- **An agent went from a sentence to an invoked paid tool.** Given only *"I need
  something that can condense a long passage of text"*, it found a tool it had
  never seen, re-checked the live terms, settled 0.001 USDC
  ([`f92a6aec…`](https://stellar.expert/explorer/testnet/tx/f92a6aeca76861010f90f7e36d11837e6a9463df40b4a0b9024b6a2c6c16ed4b))
  and got the result back.
- **Automatic cataloging**: a resource is listed because a payment for it
  settled. No registration endpoint exists. Six paid resources, zero direct
  database inserts.
- **Retrieval measured, not asserted**: held-out nDCG@10 of **22.6%** for the
  upstream reference search against **95.3%** for dense retrieval, on 65
  listings and 56 queries with a 36/20 split and labels written before any
  retriever existed.

## What is different about how we work

Three moments that say more than the numbers:

**The benchmark disconfirmed us.** We expected reciprocal-rank fusion to win. It
lost — 93.5% against dense's 95.3%, and 10.8 points worse on natural-language
queries. We shipped dense and did not ship the architecturally richer option.

**The licence audit failed on its first run.** It found `sharp` → libvips under
LGPL-3.0 in the runtime path, for image preprocessing we never invoke. A
compliance argument existed; we removed the dependency instead, then verified
the replacement changed nothing — identical similarities, unchanged held-out
score. Final graph: **244 packages, 238 runtime, zero forbidden, zero
unknown**, enforced in CI.

**Two green runs were caught measuring the wrong thing.** One settled through
the public x402.org facilitator rather than ours; one moved XLM while reporting
USDC. Both were caught by reading the chain, not our own success flags, and both
are written up rather than quietly fixed.

## What SCF funds

- **Tranche 1** — hosted testnet operation, runbook and monitoring, developer
  guide into Stellar Developer Docs, relevance evaluation as a CI release gate.
- **Tranche 2** — the `upto` scheme for Stellar including its Soroban contract,
  contributed upstream; benchmark rebuilt on real listings and real query logs.
- **Tranche 3** — pubnet, `.well-known/x402` domain binding, third-party Audit
  Bank review, mainnet evidence.

## Key risks, stated plainly

1. **The benchmark is synthetic.** Corpus and labels are author-written, so
   95.3% is a held-out synthetic score and **not production accuracy**. The
   robust claim is the relative ordering; the absolute number gets rebuilt on
   real data in tranche 2.
2. **Listing ownership is trust-on-first-use.** x402 proves who received a
   payment, not who controls a URL. Every listing says `ownershipBinding: tofu`.
   `.well-known/x402` closes it before mainnet.
3. **Abstention is conservatively guessed, not calibrated.** The dev split has
   two negative queries, and the answerable and unanswerable score distributions
   overlap. Real query logs fix this; nothing else will.

A fourth, found by our own compliance matrix rather than by a reviewer: the RFP
requires settlement from Soroban **contract accounts** (`__check_auth`), and we
have only ever settled from classic accounts — upstream PR #3018 exists because
a contract account cannot currently produce an `exact` payment. Tranche-1 work,
with upstream engagement attached.

**This is not production-ready on mainnet and we do not claim it is.** It is a
working, measured testnet implementation with a named path to mainnet.
