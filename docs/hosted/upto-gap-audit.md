# `upto` on Stellar: read-only gap audit

**Status: audit only. Nothing implemented, nothing decided.**
2026-08-16. SCF freeze remains `762c6e6`.

## Sources, pinned

| Source | Revision |
| --- | --- |
| x402 upstream | `x402-foundation/x402` @ `c8247c4cd15f29498474404d94636e7dbb894e86` (2026-08-11) |
| Dependencies | `@x402/core`, `@x402/extensions`, `@x402/stellar` all `2.22.0` |
| Chain-agnostic spec | `specs/schemes/upto/scheme_upto.md` |
| Per-network specs present | `scheme_upto_evm.md`, `scheme_upto_svm.md` |
| Per-network spec **absent** | `scheme_upto_stellar.md` |
| Open spec PRs | **#3098** and **#3134**, both OPEN, both last touched 2026-08-13 |
| Related open PR | **#3018**, contract accounts, OPEN since 2026-08-01 |

Everything below was read from those sources today. Nothing is from memory.

## `exact` versus `upto`

**`exact`.** The buyer signs a Soroban auth entry for `transfer(from, to, amount)`.
The amount is one of the signed arguments, so it is fixed at signing time. The
facilitator rebuilds the transaction with itself as source to sponsor the fee,
but cannot alter anything the auth entry covers.

**`upto`.** The buyer authorises a **maximum**. The resource server chooses the
actual amount after the work is done and passes it to the facilitator in the
settlement-time `PaymentRequirements.amount`. Four properties are MUST in
`scheme_upto.md`:

1. **Single-use.** Settled at most once, whatever the amount.
2. **Time-bound.** Both `validAfter` and a deadline.
3. **Recipient binding.** The signature must bind the destination; a facilitator
   must not be able to redirect funds.
4. **Maximum enforcement.** Settled `<=` authorised; `0` is permitted.

Plus a fifth, phase-dependent rule: `PaymentRequirements.amount` means *maximum*
at verify time and *actual* at settle time, and the facilitator must re-verify
the signature against the authorised maximum, never against the settle-time
amount.

The consequence for Stellar is structural, not cosmetic: `exact` binds the
amount inside the signature, so its mechanism cannot express `upto` at all. This
is a different scheme, not a parameter on the existing one.

## Upstream status

| Layer | EVM | SVM | Stellar |
| --- | --- | --- | --- |
| Chain-agnostic spec | IMPLEMENTED | IMPLEMENTED | IMPLEMENTED (applies to all) |
| Per-network spec | IMPLEMENTED | IMPLEMENTED | **SPEC ONLY, contested** |
| Go client/server/facilitator | IMPLEMENTED | MISSING | MISSING |
| TypeScript client/server/facilitator | IMPLEMENTED | MISSING | MISSING |
| Contract | `x402Permit2Proxy` | — | **MISSING** |

`@x402/stellar@2.22.0` exports exactly `.`, `./exact/client`, `./exact/server`,
`./exact/facilitator`. There is no `upto` entry point, no `upto` type, and the
string does not appear anywhere in the package. `@x402/core` does not carry the
literal `"upto"` either. Nothing to extend; everything to add.

## Is a Soroban contract required? **Yes.**

Not assumed from the roadmap. Derived, and then confirmed against PR #3098,
which reaches the same conclusion independently.

A SEP-41 allowance (`approve` / `transfer_from`) is the obvious contract-free
candidate. It fails two of the four MUSTs:

| Core property | SEP-41 allowance alone | |
| --- | --- | --- |
| 4. Maximum amount | the allowance is a ceiling | ✅ |
| 2. Time-bound | `expiration_ledger` bounds it | ⚠️ no `validAfter` |
| 3. **Recipient binding** | `transfer_from` lets the spender pick **any** `to`; nothing the client signed constrains the destination | ❌ |
| 1. **Single-use** | an allowance is a standing balance, drawable across many calls until exhausted or expired | ❌ |

PR #3098 states the consequence in normative language: a facilitator doing
`upto` on Stellar via bare `approve`/`transfer_from` "does not satisfy Core
Properties 1 or 3 and MUST NOT advertise `upto` support."

This is the same reason Permit2 exists on EVM. ERC-20 `approve` has the identical
deficiencies, and Permit2's witness pattern is what fixes them.

### Smallest contract responsibility

One entry point, no more:

```
settle(authorization, actual_amount)
  require actual_amount <= authorization.max_amount
  require ledger within [valid_after_ledger, deadline_ledger]
  require nonce unspent, then mark spent
  require the caller is authorization.facilitator
  move actual_amount from authorization.from to authorization.to
  clear any unused remainder in the same invocation
```

No escrow, no balances, no custody between calls, no marketplace logic, no
upgradeability, no admin. The contract exists to make four signed constraints
enforceable at settlement and nothing else.

## The competing specs

This is the finding that changes the plan.

**Two open PRs write the same file**, `specs/schemes/upto/scheme_upto_stellar.md`:

- **#3098** — "add upto scheme implementation spec for Stellar". Defines two
  profiles, both shipping a contract: a stateful `contract` profile doing atomic
  pull-and-refund and bound to one named facilitator, and a `stateless` profile.
  Proposes an eight-field `Authorization` struct (`from`, `to`, `asset`,
  `max_amount`, `valid_after_ledger`, `deadline_ledger`, `nonce`, `facilitator`)
  entirely covered by the client's signature. Proposes `extra.uptoProfile` and
  `extra.settlementContract` as field names, explicitly marked as *proposed*.
- **#3134** — "define upto scheme for Stellar". A single minimal **stateless**
  contract. `settle()` grants itself the allowance from a client-signed
  `approve` sub-invocation, does `transfer_from(self, from, payTo, amount)`, and
  zeroes the remainder via a second fixed-argument `approve(from, self, 0, 0)`
  in the same tree. No contract state at all.

They are not merely different wordings. They differ on statefulness, on whether
the facilitator is bound into the authorisation, and on the wire fields. #3098's
`stateless` profile resembles #3134's design, so convergence is plausible, but
neither is merged and the TSC has not chosen.

Both PRs agree on the two things that matter most for scoping: **a contract is
required**, and **the design works for classic `G` and contract `C` accounts
alike** without special-casing `__check_auth`.

## Accounts

**Classic `G` accounts: supported by both proposals, and by our current `exact`
path.** This is what all our evidence settles from.

**Contract `C` accounts: a separate concern, and separately blocked.** Both
proposals say the contract does not special-case them and that facilitators MUST
treat the credential's `signature` field as opaque rather than requiring an
Ed25519 shape. Our facilitator currently does not support them, and upstream PR
#3018 exists precisely to fix that in `exact`. `upto` does not depend on #3018,
but shipping `upto` for C-accounts does.

Keeping these separate matters: an `upto` implementation for G-accounts is a
complete, conformant deliverable on its own.

## Security invariants, by enforcement layer

**Contract-enforced** — the ones that must not depend on anyone behaving:
settlement above `max_amount` impossible; nonce single-use; ledger window
respected; recipient fixed to the signed `to`; asset fixed to the signed
`asset`; unused remainder cleared atomically in the same invocation.

**Protocol-enforced** — from `scheme_upto.md`: `amount` is the maximum at verify
and the actual at settle; the facilitator re-verifies the signature against
`permitted.amount`, never against the settle-time amount; settling `0` is legal.

**Facilitator-enforced** — carried over from `scheme_exact_stellar.md`, which our
implementation already honours: the facilitator MUST NOT be `authorization.from`;
MUST NOT appear as a signer in any client-supplied auth entry; MUST NOT be the
operation source; auth expiry MUST NOT exceed the ledger bound; simulation must
succeed and emit the expected transfer events before submission.

**Client-enforced**: never sign a maximum larger than intended; bind the
facilitator address obtained from `/supported`; refuse a 402 whose terms moved
between discovery and signing. That last one already exists in this codebase and
is the reason the demo buyer validates at two layers.

## What the RFP actually requires

Quoted from the frozen `docs/scf/rfp-compliance-matrix.md`, not paraphrased:

| Row | Requirement | Level | Status |
| --- | --- | --- | --- |
| 4.2 | Author `scheme_upto_stellar.md` **and** implement it, contributed upstream | **REQUIRED** | not started, T2 |
| 4.3 | State whether `upto` ships a Soroban contract; a contract-free design must document its weaker trust model | **REQUIRED** | position stated in §12, T2 |
| 6.2 | A settled hash per network **per scheme** | **REQUIRED** | testnet `exact` now; `upto` pending |
| D4 | `upto` merged upstream with `scheme_upto_stellar.md` | — | not started |
| D9 | Test suite covering `exact` **and** `upto` | — | `exact` now |

**MUST SHIP:** the implementation, the Soroban contract, upstream contribution,
tests, and settled hashes per scheme.
**SHOULD SHIP:** a design doc stating the contract position (4.3 is arguably
already satisfied by §12 of the proposal).
**INTERPRETATION:** row 4.2 says "author the spec **and** implement it". The
proposal itself already narrows this, at §"B": PR #3098 belongs to another team,
and "our tranche-2 work is the *implementation* and the Soroban contract,
coordinated with that author and the TSC — not a competing spec PR."

That narrowing was written before #3134 appeared. There are now two competing
specs, neither merged.

## Upstream strategy

The contract cannot live in `@x402/stellar`; it is Rust and it is deployed, not
imported. The scheme code should be shaped to land upstream as
`@x402/stellar/upto/{client,server,facilitator}`, mirroring the existing `exact`
layout exactly, so a PR is a new directory rather than a diff through shared
code.

Expected file surface, if it were built:

- `contracts/upto-settlement/` — Rust, one entry point, plus its own tests
- `@x402/stellar` — three new export paths, no change to `exact`
- `apps/facilitator/src/app.ts` — register a second scheme alongside the first
- `apps/e2e-stellar/` — an `upto` client and balance assertions
- `docs/hosted/` — evidence, and a published contract address

## Coexistence with `exact`

`exact` is live, proven and frozen in behaviour. `upto` must be a **separate
scheme registration**, not a branch inside the exact path. The facilitator
already registers schemes per network (`.register(config.network, scheme)`), so a
second registration is additive and the exact code is never touched. Conditionals
threaded through the working path would put a proven settlement at risk to save a
file, which is the wrong trade.

## Test matrix, if built

Twenty-three cases in five groups.

**Happy path (5):** authorise max, settle below max, seller receives the actual
amount, buyer loses the actual amount, buyer XLM delta stays zero under
sponsorship.
**Boundaries (9):** settle exactly max; settle zero; settle above max rejected;
wrong asset; wrong `payTo`; expired deadline; before `validAfter`; replayed
nonce; modified contract arguments.
**Facilitator binding (3):** a different facilitator cannot settle; the
facilitator is not `from`; the facilitator is not a signer in client auth.
**Conformance (4):** `exact` unchanged; `upto` works independently; discovery and
Bazaar cataloging unaffected; `/supported` advertises both.
**Contract accounts (2):** classified separately and gated on #3018.

## Recommendation

**Do not start `upto` next.**

The blocker is not difficulty, it is that the specification does not exist yet.
Two competing proposals are open against the same file, they disagree on
statefulness, on facilitator binding and on wire field names, and the field names
in #3098 are explicitly marked *proposed*. RFP row 4.2 requires the work be
"contributed upstream", and an implementation of an unmerged, contested spec
cannot be contributed. Building now means picking a side in someone else's design
argument and rewriting whichever half loses.

**Start `.well-known/x402` domain binding instead.**

It is the only remaining gap with **no external dependency**. It is already
designed in the proposal, it upgrades listing ownership from trust-on-first-use
to domain-verified, and it closes the one security weakness the proposal
currently discloses rather than solves: a first mover can squat an unregistered
resource URL. RFP row 6.3 names `.well-known` verified as its acceptance
criterion.

### Comparison

| Gap | RFP value | Differentiation | Risk | External dependency | Reviewer value |
| --- | --- | --- | --- | --- | --- |
| `upto` | REQUIRED (4.2) | high | high | **blocking: two unmerged specs** | high, once it exists |
| `.well-known/x402` | REQUIRED (6.3) | medium-high | low | **none** | high, closes a disclosed weakness |
| contract accounts | REQUIRED (1.3) | medium | medium | **blocking: PR #3018** | medium |
| pubnet | REQUIRED (1.1) | low | medium-high | real funds, ops readiness | high, but premature before review |
| security review | REQUIRED (6.4) | low | low | **blocking: Audit Bank** | high, and should follow the code |

`upto` remains the larger prize and should be next as soon as the TSC picks a
spec. Watching #3098 and #3134 costs nothing; building against them costs a
rewrite.

## Estimate, when unblocked

**LARGE.** A Rust contract with its own audit surface, deployment and published
address; three new SDK entry points; a second facilitator registration; a new
e2e client; a full test matrix; and an upstream PR that has to survive review by
the people currently disagreeing about the spec.

**Biggest unknown:** which of #3098 and #3134 the TSC adopts. Stateful versus
stateless is not a detail; it decides whether the contract stores nonces at all,
and therefore most of the contract, most of its tests, and its entire storage
and fee profile.
