# x402Seek security review package

For an external reviewer. Prepared 2026-08-16 against the deployed system, not
against an idealised one.

**This is not an audit report.** It is the material an auditor would otherwise
have to reconstruct.

## State of the system under review

| | |
| --- | --- |
| Posture | **LIVE TESTNET.** Not production, not mainnet-ready |
| Core repo | `facilitador-stellar`, branch `feat/hosted-testnet-facilitator`, `5e8f740` |
| Web repo | `x402seek-web`, branch `main`, `64cfa78` |
| SCF freeze | `762c6e6`, untouched; `docs/scf/` is not modified by this package |
| Tests | 388 core, 97 web, typecheck clean, licence gate green |

**Start at `auditor-handoff.md`.** It gives a reading order, names the four
things worth the first hour, and states what we already believe is weak.

The baseline is frozen: `BASELINE-2026-08-16.md`, core `1ca2684`, web `64cfa78`,
with the deployed commit of every service recorded.

## The documents

| File | What it answers |
| --- | --- |
| `auditor-handoff.md` | **read first**: order, priorities, and the `upto` re-review scope |
| `BASELINE-2026-08-16.md` | the frozen baseline, and what invalidates it |
| `architecture.md` | what runs where, and which boundary each hop crosses |
| `assets-and-trust-boundaries.md` | what is worth protecting, and who is trusted with it |
| `security-invariants.md` | what must always hold, with code, test and hosted evidence |
| `threat-model.md` | what could go wrong, with severity and current control |
| `deployment-and-secrets.md` | provenance, secrets by name, runtime configuration |
| `reviewer-runbook.md` | how to reproduce the claims, **safely** |
| `incident-response.md` | what to do when something is wrong |
| `pubnet-readiness.md` | what stands between here and real money |
| `audit-scope.md` | what an external review should and should not cover |
| `FINDINGS-2026-08-16.md` | two findings, both closed, with their remediation |

Referenced rather than duplicated: `../hosted/HOSTED-E-01`…`HOSTED-E-08`,
`../hosted/STATUS.md`, `../hosted/FREEZE-*.md`,
`../security/catalog-ownership-model.md`.

## The one rule this package exists to make verifiable

**SEC-OPS-01.** *A health, readiness, deployment-propagation, rate-limit or
kill-switch check against an economic service must use a request that cannot
reach signing or settlement.*

This is not a style preference. It is here because the same operator mistake was
made twice: a loop polling for a state change used a **payable** body, and each
time the first request paid before the state change arrived. Two settlements,
`5dc0ab05cdbb…` and `21c6eccbab50…`, 0.001 USDC each. No control failed either
time. The spend ledger recorded both, the daily ceiling was never approached, and
the money is worthless testnet USDC. That is precisely why it is worth writing
down: the failure was invisible in every dashboard that mattered, and only the
ledger caught it.

Writing the lesson in `HOSTED-E-07` was not enough, because it was written and
then not applied. So it is an invariant with a number, it appears in
`security-invariants.md`, every economic path in `threat-model.md` carries a
**safe non-spending probe** field, and the runbook separates non-spending checks
from economic ones at the top rather than in a footnote.

Verified today against production: every economic path has a probe that is
refused before signing.

## Known limitations, stated up front

- **LIVE TESTNET only.** Not production. Not pubnet.
- **No `upto`.** Blocked on upstream spec selection; two competing PRs open.
- **Contract accounts unproven.** The facilitator appears capable and has never
  settled from one. See `../hosted/roadmap-recheck-2026-08-16.md`.
- **`.well-known/x402` is an x402Seek convention**, not an upstream standard, and
  its path is provisional.
- **TOFU remains** for any resource without a domain declaration, which is every
  resource except our own seller.
- **The browser demo buyer is x402Seek-funded.** The visitor never pays.
- **No user-wallet payment.**
- **No external audit has been performed.**
