# Pubnet preconditions

Derived from the analysis in this package, not from a generic checklist.

**Status: NOT READY.** Nothing here is a defect on testnet. Each line is
something whose cost is currently zero and would not be.

## Blocking

| # | Precondition | Why, in terms of this system |
| --- | --- | --- |
| 1 | **External security review complete** | RFP row 6.4 puts the review before the mainnet production tag. T-21, the facilitator signer, has rotation and shutdown as its only controls and is the highest-value asset here |
| 2 | **A real-value fee budget for the facilitator** | E-2 is the only economic path with no persistent budget: its ceiling is the account balance. On testnet that is ~20 free XLM. On pubnet it is a drainable, funded position with no code enforcing a limit |
| 3 | **Spend alerts** | Both recorded incidents were found by reading a balance afterwards. Nothing pages anyone. `ALERT_GUIDANCE` exists in the metrics payload and nothing consumes it |
| 4 | **Signer funding policy** | How much the facilitator holds, who tops it up, at what floor, and what happens when it empties. Undefined |
| 5 | **Secret rotation procedure, rehearsed** | `incident-response.md` describes rotation. It has never been performed |
| 6 | **Incident response, rehearsed** | Same. Written today, untested |
| 7 | **Deployment provenance under change control** | Provenance is PASS: every service reports its commit. What is missing is a rule about who may deploy and a rollback that has been exercised |
| 8 | **Mainnet asset verification** | The testnet USDC contract is pinned as a constant. The pubnet equivalent must be pinned the same way and verified against the issuer, not copied from a search result |
| 9 | **A rollback procedure that has been run** | Railway can redeploy a previous commit. Nobody has done it under pressure |

## Decisions that must be made first

| # | Decision | Current state |
| --- | --- | --- |
| 10 | **`upto`** | Blocked on upstream spec selection; two competing PRs open. Shipping a facilitator on pubnet that advertises only `exact` is a choice, not an omission, and should be a deliberate one |
| 11 | **Contract accounts** | Facilitator plausibly capable, never evidenced. Deciding to launch without proving it is also a choice |
| 12 | **Domain ownership posture** | Only our own seller publishes a declaration. Everything else is TOFU, and on pubnet a squatted listing has a plausible path to real money (T-11) |

## Controls that would need re-argument, not just re-use

Every number in this system was chosen for worthless testnet USDC. None of them
transfers automatically:

- **0.15 USDC per day** for the demo buyer is a rounding error on testnet and a
  real, if small, cost on pubnet. The demo buyer arguably should not exist on
  pubnet at all.
- **0.0022973 XLM per settlement** in fee sponsorship is free today. At scale on
  pubnet it is the facilitator's main operating cost and its main drain risk.
- **3 payments per hour per visitor** was sized for a reviewer demo.
- **The 0.5 USDC balance floor** is three days of runway at the testnet ceiling
  and means nothing at a different price.

## Gaps found while writing this package

Recorded here rather than as findings, because neither is a defect on testnet:

- **The domain verifier has no independent kill switch.** It runs inside the
  facilitator process, so containing it means stopping settlement for everyone.
  Acceptable while the blast radius is an outbound fetch; on pubnet, coupling
  discovery enrichment to the payment plane's availability is worth separating.
- **T-18: a corrupt ledger fails closed only because reservations throw.** That
  is the right outcome by accident rather than by design. On pubnet the budget
  is the control that bounds loss, and it deserves an explicit unavailable state
  rather than an exception.

## Not a precondition

**Bit-for-bit reproducible builds.** Provenance is established per service and
the licence gate covers the dependency graph. Reproducibility would be nice and
is not what stands between here and pubnet.
