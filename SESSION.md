# Session Handoff — 2026-08-13

## Completed

- **Kill-or-go audit** (`d8fb983`) — CONDITIONAL GO on a retrieval-quality wedge, not "another facilitator". OpenZeppelin excluded by licence (AGPL-3.0), not architecture.
- **Retrieval benchmark** (`0cc33b2`) — 65-listing corpus, 56 queries, 36/20 dev/held-out, labels written before retrievers. Held-out nDCG@10: reference `includes()` 22.6%, BM25 83.0%, dense 95.3%, RRF hybrid 93.5%.
- **Payment plane** (`8e42bad`) — `/verify` `/settle` `/supported` on `@x402/stellar`. `/supported` byte-identical to the x402.org conformance baseline.
- **E-06 stock-client settlement** (`0427482`, `e4be59f`) — real testnet tx. Caught E-06a: the first green run settled through the **public x402.org facilitator**, not ours.
- **Automatic Bazaar cataloging** (`223f177`, `ecea96e`) — listing created only by a settled payment, no registration endpoint. TOFU ownership model written *before* implementation.
- **`/discovery/search`** (`7bd7b7a`) — dense-first (benchmark falsified the hybrid), abstention at cosine 0.22, cursor pagination. 6 paid resources, 0 direct DB inserts.
- **Upstream conformance** (`cc94fc2`, `aa2af60`) — **9/9 payments, 5/5 discovery, exit 0** against pinned upstream `c8247c4`, no client/protocol patches. Suite found two of our bugs: wrong discovery envelope (`items` vs `resources`), over-strict `routeTemplate`.
- **Canonical testnet USDC** (E-19) — 9 tx, buyer −0.0090000 USDC / **+0.0000000 XLM**, facilitator −0.0206757 XLM. Fee sponsorship proven on chain.
- **Hono+fetch investigation** (`ce1c46c`) — BOUNDED, root cause unknown. Also moved index sync off the settlement response path.
- **MCP discovery server** (`c0b161a`) — `bazaar_search` + `bazaar_pay_and_call`. Agent goes from a sentence to an invoked paid tool. tx `f92a6aec…`.
- **Licence audit** (`331e9bd`) — audit **failed first run**, found `sharp` → libvips LGPL-3.0; removed the dependency, verified retrieval unchanged. 244 resolved / 238 runtime, 0 forbidden/unknown/review. CI gate added.
- **Proposal pack** (`d031170`) — 5 artifacts + adversarial red team.

## Current State

- **Branch**: `main` (no git remote configured)
- **Build**: passing — 167 tests, typecheck clean, `pnpm audit:licenses` exits 0
- **Uncommitted work**: none, working tree clean
- **Code status**: **FROZEN**. Docs/evidence only until submission.

## Next Tasks

1. **Submit to SCF #45 by 2026-08-16** (3 days). Process: SCF Interest form → invited to a Build round → Build form naming this RFP. Reviewed by 2 delegates from the quarter's Category Delegate Panel.
2. **Final delegate-eyes read of `docs/scf/proposal.md`** — offered but not done: a pure reading-friction pass with no edits to substance.
3. **C2 still unanswered**: does SCF fund one or multiple teams per RFP for #45? The sibling LayerZero RFP says "one or more teams"; the x402 one does not pluralise. User said they'd ask in Discord. Changes competitive calculus, not the submission.
4. Optional before submission: a USDC run of `apps/e2e-stellar/src/e2e.ts` (currently uses the native XLM SAC; the upstream suite already proves USDC).

## Blockers

- **None blocking submission.**
- Open but non-blocking: contract accounts (`__check_auth`) untested and blocked on upstream PR #3018 — a REQUIRED item in RFP §3.1, disclosed in the proposal and compliance matrix.
- Hono+fetch ~25% failure in isolation under the upstream harness: BOUNDED, controls exclude our facilitator/client/`@x402/hono`. Nothing filed upstream — not reproducible outside the rig.

## Notes

- **Evidence discipline is the whole strategy.** Every proposal claim traces to `docs/scf/evidence-log.md` by E-number. `docs/scf/proposal-claim-matrix.md` has 45 rows; **13 marked NO** and absent from all drafts. Do not add a claim without adding evidence first.
- **Never write**: "production accuracy 95.3%", "first ever", "atomic pay-and-invoke", "URL ownership proven", "upto implemented", "production ready on mainnet".
- **Positioning**: the discovery layer, not the facilitator. Payments are already machine-readable; discovery has to become decision-grade. Do not let `upto` dominate the pitch.
- **Three times our own measurement caught us being wrong** — public-facilitator settlement (E-06a), an "9/9 USDC" run that actually moved XLM (E-19), and the LGPL dependency. These are proposal assets, not embarrassments.
- **Competition is real**: 10 repos target this RFP. `Vellar-Wallet/vellar-facilitator` (davedumto) is live on testnet with a completed security review; `Eras256` owns the open `upto` Stellar spec PR #3098. See kill-or-go audit §14.
- Node 22 required (`@x402/stellar` engines). `nvm use` before anything.
- Testnet accounts in `apps/e2e-stellar/.env.e2e` (gitignored). Buyer needs USDC from faucet.circle.com; `provision:usdc` reports the balance.
- Upstream clone at `.x402-upstream/` (gitignored). First `run-upstream-e2e.sh` clones + builds; several minutes.
- Roadmap parked deliberately: pubnet, `.well-known/x402` domain binding, `upto` + Soroban contract, hosted deployment/Docker, threshold recalibration on real traffic, runbook, developer guide, Audit Bank review.
