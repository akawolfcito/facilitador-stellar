# Roadmap re-check, 2026-08-16

Read-only. Every state below was queried today from primary sources, not
remembered. Nothing was implemented, deployed, paid or contracted.

Upstream: `x402-foundation/x402`, `origin/main` at `167a828e`. Unchanged since
the `upto` audit yesterday.

## PR states, as of today

| PR | State | Updated | Review | Subject |
| --- | --- | --- | --- | --- |
| #3098 | OPEN | 2026-08-13 | REVIEW_REQUIRED | `upto` scheme implementation spec for Stellar |
| #3134 | OPEN | 2026-08-13 | REVIEW_REQUIRED | define `upto` scheme for Stellar |
| #3018 | OPEN | 2026-08-01 | REVIEW_REQUIRED | let a contract account sign its own auth entries |
| #2979 | OPEN | 2026-08-10 | REVIEW_REQUIRED | discovery: DNS + `.well-known` facilitator records |
| #2646 | OPEN DRAFT | 2026-07-03 | REVIEW_REQUIRED | Well known x402 discovery, "DO NOT MERGE" |

None merged. `specs/schemes/upto/` still contains only `scheme_upto.md`,
`scheme_upto_evm.md` and `scheme_upto_svm.md`. No `scheme_upto_stellar.md`.
No `.well-known/x402` anywhere in the merged spec tree.

## `upto`: still blocked, but the shape of the block changed

**Has one Stellar `upto` spec been selected? NO.**

What did change is the tone. The two authors are talking to each other rather
than past each other. #3134 carries a comment reading the designs against #3098
and arguing "the two designs shouldn't be treated as mutually exclusive winners,
the real split is settlement…", and #3098's author replies engaging with it and
citing a reference implementation (`contracts/upto-settlement`) checked against a
live testnet run rather than against spec text.

That is convergence in progress, not a decision. Both PRs write the same file,
both are `REVIEW_REQUIRED`, and no TSC resolution exists.

**Waiting is still correct.** RFP row 4.2 requires the work be contributed
upstream, and an implementation of an unmerged contested spec cannot be
contributed. What has improved is the odds: two engaged authors converging is a
much better predictor of a near-term decision than two silent PRs, so this is
worth re-checking weekly rather than shelving.

## Contract accounts: the blocker is narrower than our own matrix says

**Current support: PARTIAL, and the partition is not where `docs/scf/` records
it.**

Our compliance matrix says "contract accounts blocked on upstream PR #3018".
Read against the code today, that conflates two different halves.

**The client half is genuinely blocked upstream.** #3018's description is
precise: a `C…` account cannot produce a payment because `createPaymentPayload`
throws `invalid version byte. expected 48, got 16`. `signAuthEntries` delegates
to the SDK's `authorizeEntry`, which resolves every signer through
`Keypair.fromPublicKey`, and that rejects a contract address. The fix adds an
optional `authorizeEntry` to `ClientStellarSigner`. The PR states plainly: "No
wire format, payload, or facilitator changes."

**The facilitator half appears already capable, and is unevidenced.** Read from
`@x402/stellar@2.22.0`'s facilitator: it validates credential type, expiration
ledger and sub-invocations, then decides who signed via
`gatherAuthEntrySignatureStatus` against the simulation. It never derives a
keypair from the payer address, and our own code adds no address-shape check —
we delegate auth validation entirely. Nothing found today rejects a `C…` payer
on the verify or settle path.

"Appears capable" is not "works". We have never settled from a contract account
and cannot construct one to try without either #3018 or hand-building auth
entries, so the honest status is **plausibly capable, unevidenced**.

The practical consequence: if #3018 merges, our work is likely **evidence, not
implementation**. Estimate in that case: SMALL, a `C…` buyer in
`apps/e2e-stellar`, one settled hash, one evidence document. If it does not
merge, the same outcome needs hand-built auth entries, which is MEDIUM and forks
nothing but costs real Soroban work.

`docs/scf/` is frozen and is not being edited. This correction is recorded here.

## `.well-known` collision: coexistence possible

Compared against ours:

```json
{ "kind": "resource-ownership", "version": 1, "resources": [...] }
```

**#2979** claims `/.well-known/x402` for a facilitator manifest and carries its
own `kind`. Two documents with discriminators can be told apart by any reader.
What cannot be shared is the file: a host that is both a seller and a facilitator
would have to merge them or move one.

**#2646** is a draft marked DO NOT MERGE, at `/.well-known/x402.json`, and is
about advertising resources rather than authorising a payee. Different path,
different purpose.

**Classification: COEXISTENCE POSSIBLE. Migration: POSSIBLY**, and only if
upstream fixes a canonical shape at that exact path. See
`FREEZE-well-known-ownership.md` for the migration shape and why it costs a
re-fetch and no data.

## Security review readiness

**NOT AUDIT-READY**, for two concrete reasons and no invented polish.

The codebase itself is in good shape to hand over. Six runtime workspaces,
roughly 7,100 lines of source, 388 tests plus 92 in the web repo, typecheck
clean, licence gate green with zero copyleft, no TODO, FIXME, XXX or HACK
anywhere in `src`, and every secret held in exactly one Railway service each.
The surfaces an auditor would care about are all present and evidenced: exact
settlement, discovery and catalog, the ownership verifier with its SSRF boundary,
the demo seller, the bounded demo buyer with its spend ledger and rate limits,
and the hosted deployment configuration.

The blockers are not quality. They are scope stability:

1. **`upto` will add a Soroban contract.** A contract is the single highest-value
   thing an audit could look at, and paying for a review that predates it means
   paying twice or shipping an unaudited contract. RFP row 6.4 ties the review to
   the mainnet production tag, not to today.
2. **Contract-account support may change the auth-entry validation path.** That
   path is exactly what an auditor would scrutinise hardest. Auditing it before
   we know whether it accepts `C…` accounts is auditing a draft.

Neither is a defect to fix. Both are reasons the review is more valuable slightly
later, and the RFP sequences it that way already.

## Pubnet

**PREMATURE.** Technically deployable is not operationally ready, and the gap is
not small.

- **Real value.** Every control currently sized for worthless testnet USDC would
  need re-argument: the demo buyer's 0.15 USDC daily ceiling, the facilitator's
  fee sponsorship exposure, the settle rate limit.
- **Fee sponsorship becomes a real cost.** The facilitator pays 0.0022973 XLM per
  settlement today and nobody cares. On pubnet that is a funded, monitored,
  drainable budget with no ceiling currently defined.
- **Security review is a prerequisite, not a parallel track.** RFP row 6.4 puts
  the third-party review before the mainnet production tag. Deploying pubnet
  first inverts the RFP's own order.
- **Ownership is still mostly TOFU.** Domain binding exists and works, but only
  our own seller publishes a document. On pubnet, a squatted listing has a
  plausible path to real money.
- **Incident response is undefined.** There is no documented procedure for
  pausing settlement, rotating the signer, or responding to a drain. On testnet
  the answer is "redeploy"; on pubnet that is not an answer.
- Contract accounts and `upto` are both RFP-required and both unshipped, so a
  pubnet deployment today would advertise an incomplete facilitator on a network
  where incompleteness costs money.

## Decision

| Option | RFP | Blocker | External dep | Risk | Reviewer value | Time to completion |
| --- | --- | --- | --- | --- | --- | --- |
| `upto` | REQUIRED 4.2 | spec not selected | **blocking**, two live PRs | high | high | unknown, gated |
| Contract accounts | REQUIRED 1.3 | client-side, #3018 | **blocking for the easy path** | medium | medium | small if unblocked |
| Security review prep | REQUIRED 6.4 | scope not stable | Audit Bank, later | low | high | weeks, ours to control |
| Pubnet | REQUIRED 1.1 | review, controls, ops | funds, review | high | high | premature |

Applying the stated decision rule: `upto` has no selected spec, and contract
accounts are not unblocked. That leaves **security review preparation**.

**Recommended next step: security review preparation.**

Not the audit itself, which should follow `upto` and contract accounts. The
preparation is the part that is entirely ours, blocked by nobody, and useful
whichever of the two protocol gaps unblocks first:

- a written threat model covering the facilitator signer, the demo buyer float,
  the catalog's ownership model and the SSRF boundary
- an asset and trust-boundary inventory: which service holds which secret, what
  each one can spend, and what a compromise of each reaches
- an incident-response procedure, which pubnet needs anyway and which currently
  does not exist in any form
- correcting the contract-account row recorded above, in the hosted docs rather
  than the frozen ones
- a reproducible build and deploy description an auditor can follow

Every one of those is work the audit will demand, none of it depends on an
upstream decision, and all of it makes the eventual review cheaper and shorter.
Re-check #3098 and #3134 weekly; if the TSC picks a spec, `upto` takes priority
immediately.
