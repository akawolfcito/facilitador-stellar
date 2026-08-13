# Proposal red team

An adversarial pass over `proposal.md`, `reviewer-one-pager.md` and the demo
script, written as an SCF delegate who has already read nine other submissions
for this RFP and is looking for a reason to say no.

Findings are marked **FIXED** (changed in the drafts), **ACCEPTED** (a real
project risk that stays visible), or **OPEN** (unresolved before submission).

---

## 1. What sounds exaggerated?

**F-01 — "95.3%" is doing too much work. FIXED.**
It appeared in the summary, §5, §16 and the one-pager. A reviewer skimming sees
a big number four times and the caveat once. Every occurrence now reads "on our
held-out synthetic benchmark", the caveat paragraph sits directly under the
results table rather than below the fold, and §16 sets the *target* as "no
regression below the committed baseline" rather than restating the number as an
achievement.

**F-02 — "measured" risks becoming a slogan. ACCEPTED, with a guard.**
The word carries the positioning, so it stays, but it is only used where a
committed artifact backs it. The claim matrix is the enforcement: 13 rows are
marked **NO** and none of them appear in either draft.

**F-03 — The demo script said "the number I'd defend". FIXED.**
Kept, deliberately. A presenter volunteering which number they would *not*
defend is more persuasive than one who defends everything.

## 2. What sounds like another facilitator?

**F-04 — §7 opens with the payment plane in earlier drafts. FIXED.**
The architecture diagram now runs agent → discovery → payment, top to bottom,
because that is the order of our contribution. The payment plane is explicitly
labelled "thin, mostly upstream".

**F-05 — §4's capability table led with settlement. ACCEPTED.**
Settlement stays row one because a reviewer needs to know it works before
anything above it matters, but the table is preceded by the sentence that
settlement is the substrate, and §2 leads with the gap rather than our
implementation.

**F-06 — Risk of reading as "we re-implemented x402". FIXED.**
§7 now names what we reused, symbol by symbol, and states plainly "We wrote none
of it." A reviewer comparing submissions can see the boundary in one paragraph.

## 3. Where is the differentiation unclear?

**F-07 — The link from retrieval to payment safety was implied, not argued.
FIXED.** This was the most serious structural weakness. §6 now opens with why an
agent's search failure is a *payment* failure, and §3 ends on it. The one-pager
has a dedicated section, "Why this is a payment-safety problem, not a search
problem". Without that bridge, §5 reads as an unrelated IR side-project.

**F-08 — Abstention was buried. FIXED.** It is the single most agent-specific
feature in the submission and now appears in the executive summary, §6 and the
one-pager, framed as the thing that stops an agent from paying for a result the
system does not believe in.

## 4. Which RFP requirement is missing?

**F-09 — Contract accounts (`__check_auth`). OPEN, and it is a real gap.**
§3.1 requires support for both classic keypairs and custom `__check_auth`
accounts. We have only ever settled from classic `G…` accounts, and upstream PR
#3018 exists because a contract account currently *cannot* produce an `exact`
payment. Surfaced by the compliance matrix, not by us. Now stated as a partial
in the matrix and a tranche-1 item with upstream engagement attached. A
diligent reviewer will find this; better that we found it first.

**F-10 — "a settled transaction hash per network per scheme". FIXED.**
Four hashes once `upto` lands, not two. Corrected in the compliance matrix.

**F-11 — Conformance upkeep is graded as heavily as the build. FIXED.**
We have the discipline and not the documented process. Now an explicit
tranche-1 deliverable rather than an implied one.

**F-12 — Business model and rate limiting (§3.1). FIXED.** Both are required
and both were missing from the tranche plan. Added to tranche 1.

## 5. Which claim is unsupported?

**F-13 — "framework interoperability" while Hono has a 25% isolated failure.
FIXED.** §8 states the full-suite result and then discloses the residual in the
same section, with the controls that bound it and an explicit statement that we
have filed nothing upstream because it is not reproducible outside the rig.
Hiding it would be the single worst decision available: a reviewer who runs
`measure-hono-fetch.sh` and finds it undisclosed discounts everything else.

**F-14 — "MCP agent flow works" glosses over localhost. FIXED.** Claim-matrix
row 26 carries the caveat, and §19 lists "hosted deployment" as not built.

**F-15 — Availability and latency targets. FIXED.** §16 no longer invents
numbers where we have no basis; it says "baseline first, then a target" and
labels the 3.3/4.4 ms figure as six listings.

## 6. Where is the completed/planned boundary blurry?

**F-16 — `upto`. FIXED, and worth stating twice.** It is an RFP requirement and
appears in §13, §14 and §15 — but §13 states that the open spec PR belongs to
another team and our contribution is the implementation, and the claim matrix
marks "upto is implemented" as **NO**. The proposal must never let `upto`
dominate the pitch: the differentiating evidence is the discovery layer.

**F-17 — "upstream contribution" as a credential. FIXED.** We have filed
nothing. §13(C) says so, and §18 names it as a gap under "where we are thin".
Three upstream issues we hit were filed by others; claiming proximity to them
would be dishonest.

## 7. What would a stronger competitor say we lack?

The most credible rival has been shipping since 2026-07-31, is live on testnet
with a completed pre-mainnet security review, has ~13k LOC with mutation
testing, and has filed an upstream issue. A second competitor owns the open
`upto` Stellar spec PR. Both are real (kill-or-go audit §14).

What they would say, and our honest answer:

| Their point | Fair? | Our answer |
|---|---|---|
| "They have no security review; we do." | **Yes.** | Audit Bank engagement is tranche 3. We have a written threat model produced *before* implementation, which is not the same thing. |
| "They have no hosted deployment; ours is live." | **Yes.** | Tranche 1. Today we are reproducible, not hosted. |
| "They have no upstream contributions." | **Yes.** | Stated in §18. Tranche-1 commitment. |
| "Their benchmark is synthetic." | **Yes.** | Said first and loudest, by us. And nobody in this RFP has published *any* retrieval measurement — a synthetic benchmark with a stated method beats an unmeasured claim. |
| "Anyone can wire `@x402/stellar` into an HTTP server." | **Yes, and we agree.** | Which is why the proposal does not claim the facilitator as the contribution. |

**Where we are genuinely ahead:** measured retrieval with a held-out split and
published threats to validity; a disconfirming negative result that changed what
we shipped; a licence audit that failed and forced a dependency removal; and a
green upstream e2e run including Bazaar discovery validation, which is the RFP's
own acceptance criterion.

**F-18 — The team section over-claimed in draft. FIXED.** §18 now ends with an
explicit "where we are thin" paragraph. A reviewer comparing us against a team
with an audit history will find that paragraph before they find a reason to
distrust the rest.

## 8. Is retrieval quality clearly tied to x402?

**F-19 — This was the weakest link and is now the spine.** Fixed via F-07. The
argument in one line: *a false search result is not an irrelevant click, it is a
spent payment* — which makes ranking, abstention and live-terms revalidation
part of payment safety. Every discovery feature in §6 is justified by that
sentence, not by IR convention.

## 9. Does it explain why Stellar?

**F-20 — Under-argued. PARTIALLY FIXED, ACCEPTED as a residual.**
The proposal now states the economic case (sub-cent settlement is what makes
per-request micropayments viable) and the technical one (Soroban auth entries
let the facilitator sponsor fees, so an agent holds only the payment asset —
demonstrated on chain by a zero XLM buyer delta). What it does not do is argue
Stellar against other chains, and it should not: the RFP is a Stellar RFP and
that argument would read as filler.

## 10. Would a reviewer know exactly what they are funding?

**F-21 — Deliverables were verbs, not tests. FIXED.** §15 now pairs every
deliverable with an objective acceptance test. "Improve search" became
"`/discovery/search` with a committed harness reporting nDCG@5/@10, MRR@10 and
Recall@10/@20 on a held-out split, gated in CI."

**F-22 — Mainnet readiness could be inferred. FIXED.** §19 exists solely to
prevent that inference and ends with an explicit sentence that this is not
production-ready on mainnet.

---

## Findings that stay open

| # | Finding | Why it stays |
|---|---|---|
| F-09 | Contract account (`__check_auth`) support is untested and blocked on an unmerged upstream PR | Real capability gap against a REQUIRED item. Disclosed in the compliance matrix; tranche-1 with upstream engagement |
| F-13 | Hono+fetch residual, root cause unknown | Bounded by controls, does not affect the green suite. Disclosing it costs less than being caught omitting it |
| F-20 | "Why Stellar" is asserted with evidence but not argued comparatively | Deliberate; comparative chain advocacy is filler in a Stellar RFP |

## The single biggest weakness

**We are the least-proven operator among the credible bidders.** No hosted
service, no security review, no upstream contribution landed, and a benchmark
whose corpus we wrote ourselves. Our case rests entirely on the quality and
honesty of the evidence — a green upstream conformance run, on-chain USDC
settlement with demonstrated fee sponsorship, a working agent demo, and three
occasions where our own measurement caught us being wrong.

That is a real bet for a reviewer to make, and the proposal should not pretend
otherwise.
