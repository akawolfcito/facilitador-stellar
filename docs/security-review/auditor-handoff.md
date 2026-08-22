# External auditor handoff

Start here. Baseline: `BASELINE-2026-08-16.md`, core `1ca2684`, web `64cfa78`.

**System posture: LIVE TESTNET.** Not production, not pubnet. Every limit was
sized for worthless testnet USDC, and a finding of the form "this is too
permissive for real money" is expected rather than unwelcome.

## Read in this order

| # | Document | Time | Why this order |
| --- | --- | --- | --- |
| 1 | `BASELINE-2026-08-16.md` | 5 min | What exactly you are reviewing, down to the deployed commit |
| 2 | `architecture.md` | 20 min | Eight trust boundaries. TB-2 and TB-6 are where the interesting failures live |
| 3 | `assets-and-trust-boundaries.md` | 10 min | Twelve assets. Asset 1 dominates; spend your budget there |
| 4 | `threat-model.md` | 30 min | 23 threats, 3 economic paths. One HIGH, accepted, named |
| 5 | `security-invariants.md` | 30 min | 33 invariants with code, test and hosted evidence. The place to disagree with us |
| 6 | `reviewer-runbook.md` | hands-on | Reproduce it. **Part 1 cannot spend. Part 2 can and is not required** |
| 7 | `deployment-and-secrets.md` | 15 min | Provenance, secrets by name, runtime configuration |
| 8 | `FINDINGS-2026-08-16.md` | 15 min | Two findings we found and closed, with the measurements |
| 9 | `incident-response.md` | 10 min | What we would actually do |
| 10 | `audit-scope.md` | 5 min | What we think you should cover |
| 11 | `pubnet-readiness.md` | 10 min | What we already know is missing for real money |

Hosted evidence is referenced, not duplicated: `../hosted/HOSTED-E-01`…`E-08`.

## The four things worth your first hour

1. **The facilitator signer** (asset 1, threat T-21). The highest-value secret,
   with rotation and shutdown as its only controls. If it is wrong, nothing else
   matters.
2. **The two-layer live-402 boundary** (invariant P-2). The demo buyer validates
   the seller's terms pre-flight *and* installs the same predicate as an
   `x402Client` policy at the signing boundary. The second layer is the actual
   control. We would like to be told if it is not.
3. **`trustProxy: 2`** (invariant I-1, finding SR-01). Measured against one
   platform's current behaviour. The obvious value would have been wrong and
   worse than the bug. It is correct today and silently becomes wrong if Railway
   changes.
4. **The domain verifier's SSRF boundary** (invariants S-1…S-6). A URL a stranger
   chose, fetched by a host holding a signing key.

## What we already believe is weak

Stated so you do not have to find it, and so you can disagree:

- **T-21**, the signer, accepted rather than mitigated.
- **T-02**, fee sponsorship has no persistent budget. Its ceiling is a balance.
- **T-11**, most listings are TOFU because almost nobody publishes a declaration.
- **T-18**, a corrupt ledger fails closed only because reservations throw. Right
  outcome, wrong reason.
- **P-8 / SEC-OPS-01**, the only invariant with no mechanism behind it. It is
  procedure, and the procedure has been broken twice by us.
- The domain verifier has **no kill switch independent of the facilitator**.

## Two operator incidents, disclosed

Both settled 0.001 USDC that nobody intended: `5dc0ab05cdbb…` and
`21c6eccbab50…`. Both caused by polling a payable endpoint while waiting for a
state change. No control failed; the ledger recorded both and the daily ceiling
was never approached. They are in the record because the second happened *after*
the lesson from the first had been written down, which is why the rule now has a
number and every economic path carries a documented safe probe.

---

# If `upto` lands

`upto` is blocked on upstream spec selection (#3098 and #3134, both open, both
writing the same file). If it ships **before** the external review, this is the
delta. If it ships **after**, this is the re-review scope.

## Becomes MUST AUDIT, at the top

**The Soroban contract.** It does not exist yet. When it does it will be the
single highest-value surface in the system, and unlike everything else here it
cannot be fixed by a redeploy. Both open proposals agree a contract is required,
because a bare SEP-41 allowance fails two of `scheme_upto.md`'s four MUSTs:
`transfer_from` lets the spender choose any destination, and an allowance is a
standing balance rather than a single-use authorisation. The contract exists to
enforce max-amount, single-use nonce, time bounds and recipient binding at
settlement.

## Invariants that change meaning and must be re-reviewed

| Invariant | Today | Under `upto` |
| --- | --- | --- |
| **P-2** demo buyer signs only the canonical demo | an **exact** term match: amount must equal 10000 | becomes a **maximum**. The strongest control in the demo weakens from equality to `<=`, and the settled amount is chosen by the seller after the fact |
| **P-4** amounts compared as integers | equality on `BigInt` | a comparison, and a second one: settled `<=` authorised, re-verified against `permitted.amount` and never against the settle-time amount |
| **F-3** buyer XLM delta is zero | proven for a single `transfer` | must be re-evidenced for a contract invocation with up to three token transfers including a refund leg |
| **F-5** settle concurrency and rate | sized for one `transfer` | a contract call is heavier; the 50000-stroop fee ceiling needs re-argument |
| **P-6** reserve before signing | reserves an exact amount | reserves a maximum and settles less, so the ledger must reconcile a reservation against an actual |

## The protocol change that invalidates existing settle review

`scheme_upto.md` makes `PaymentRequirements.amount` **phase-dependent**: the
maximum at verify time, the actual at settle time. The facilitator's settle path
today reads that field with one meaning. Any review of the settle path completed
before `upto` does not cover the version that reads it with two, and the
facilitator must re-verify the client's signature against the authorised maximum
rather than the settlement amount. This is the single most re-reviewable item
after the contract itself.

## Likely to arrive alongside, and separately reviewable

Both proposals state the contract works for classic `G` and contract `C`
accounts without special-casing `__check_auth`. **Contract-account support may
therefore arrive with `upto`**, which changes the auth-entry validation path.
That path is the one an auditor scrutinises hardest and it is currently
unevidenced for `C` accounts. See `../hosted/roadmap-recheck-2026-08-16.md`.

## Explicitly unaffected, no re-review needed

Discovery and ranking. Abstention. Domain binding and the whole SSRF boundary.
The proxy and client identity boundary. Secrets and their redaction. The catalog
ownership precedence rules. The demo payment's body allowlist, which has no
payment field regardless of scheme.

## Our recommendation on sequencing

Wait. Auditing now means either paying twice or shipping an unaudited immutable
contract, and neither is a good trade for a system whose current exposure is ~20
XLM of testnet fees. Re-check #3098 and #3134 weekly; the two authors are
actively converging, which is a better predictor of a decision than two silent
PRs.

If waiting becomes untenable, the fallback is a scoped review of items 1, 2, 6, 7
and 9 from `audit-scope.md` now, explicitly excluding the settle path, with the
contract and settle semantics as a second engagement.
