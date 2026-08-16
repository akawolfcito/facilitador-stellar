# Recommended external audit scope

For an eventual review by the Audit Bank, per RFP row 6.4. Sized so a reviewer's
time goes where the money is.

## MUST audit

| # | Surface | Why it leads |
| --- | --- | --- |
| 1 | **Facilitator `exact` settlement and Soroban auth validation** | The signer is the highest-value asset in the system (asset 1, T-21) and auth-entry validation is what stands between a payload and a submitted transaction |
| 2 | **Fee sponsorship** | The only economic path with no persistent budget. Its ceiling is a balance |
| 3 | **Demo buyer economic controls** | The two-layer live-402 boundary, the exact-terms policy at the signing boundary, and whether anything can reach a signer that should not |
| 4 | **Persistent spend ledger** | Reserve-before-signing, restart safety, and whether the UTC day ceiling can be defeated |
| 5 | **Idempotency and ambiguous settlement** | A duplicate payment and an auto-retried uncertain settlement are the two ways this system could pay twice |
| 6 | **Proxy and client identity boundary** | `trustProxy = 2` is measured against one platform's current behaviour. SR-01 shows what a wrong value does, and it was not obvious |
| 7 | **Domain verifier SSRF** | A URL a stranger chose, fetched by a host holding a signing key |
| 8 | **Catalog ownership precedence** | `OWNERSHIP_CONFLICT`, and whether `domain-verified` can be demoted or spoofed |
| 9 | **Secret boundaries** | Which service holds what, redaction, and that nothing reaches the browser |
| 10 | **Deployment assumptions** | Privilege drop, volume ownership, private networking, and that the demo buyer is genuinely unreachable |

## SHOULD audit

- Discovery and ranking, for input handling rather than for retrieval quality.
- The MCP discovery app, which is not on the hosted payment path.
- Metrics endpoints and what they disclose to a holder of the token.
- The frozen preview catalog in `x402seek-web`, which is read-only by
  construction and worth confirming as such.

## Out of scope

- Retrieval accuracy and the benchmark. A measurement question, not a security one.
- UI design and copy, except where it makes a custody claim. Those claims are in
  `security-invariants.md` and the wording is deliberate.
- Anything upstream: `@x402/core`, `@x402/stellar`, `@x402/fastify`. Pinned at
  `2.22.0` and reviewed by their own project.
- Stellar, Soroban and Horizon themselves.
- `upto` and contract accounts, neither of which exists here yet.

## The condition that changes this document

**If `upto` is implemented before the external review, its Soroban contract
becomes MUST AUDIT, at the top of the list.**

A deployed contract holding an authorisation and moving funds is a different
class of surface from anything currently in this system: it is immutable once
deployed, it is reachable by anyone, and a defect in it cannot be fixed by a
redeploy. That is the single strongest argument for sequencing the audit after
`upto` rather than before, and it is why `../hosted/roadmap-recheck-2026-08-16.md`
records the codebase as not audit-ready on scope-stability grounds rather than on
quality grounds.

## Suggested sequence

1. Items 1 and 2. If the signer or the fee path is wrong, nothing else matters.
2. Items 3, 4 and 5, the demo buyer's economics as one unit.
3. Items 6, 7 and 8, the input boundaries.
4. Items 9 and 10, deployment and secrets.

Scope note for the reviewer: the system is **LIVE TESTNET**. Every number was
sized for worthless assets, and `pubnet-readiness.md` lists what would have to be
re-argued. A finding of the form "this limit is too high for real money" is
useful and expected.
