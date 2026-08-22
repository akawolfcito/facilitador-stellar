# Incident response

Small and executable. Every action below can be performed today with the access
the operator already has. Nothing here assumes tooling that does not exist.

**Rule that applies to every procedure: while investigating an economic service,
probe it with a request that cannot pay.** See `reviewer-runbook.md` §1.2. Both
recorded incidents on this system were caused by breaking that rule.

## Controls available right now

| Control | Where | Time to effect |
| --- | --- | --- |
| `DEMO_ENABLED=false` | Railway variable, demo buyer | ~30 s |
| Stop a service | Railway dashboard or API | seconds |
| Rotate a secret | Railway variable, then redeploy | ~2 min |
| Reduce a rate limit | code change and deploy | ~3 min |
| Budget exhaustion | automatic, at 150 payments or 0.15 USDC per UTC day | immediate |
| Option D | automatic: everything except the demo keeps working | immediate |

## A — Facilitator signer compromise

**Detect.** Unexpected transactions from the signer address on Horizon. XLM
falling faster than settlements explain. `secondsSinceLastSettlement` inconsistent
with the ledger.

**Contain.** Stop `x402seek-facilitator-testnet` in Railway. Settlement stops for
everyone; the site degrades to Option D and stays useful.

**Rotate.** Generate a new keypair, set `SIGNER_SECRET_KEYS`, redeploy, fund the
new address. Do **not** reuse the compromised address for anything.

**Preserve.** Before rotating, record the compromised public address, the last
known-good transaction hash, and the Horizon operation list for the account. The
account history is public and permanent; capture the interpretation while it is
fresh.

**Recover.** Redeploy with the new signer. `/supported` and `/health` return.
Verify with a non-spending probe first.

**Verify.** `GET /health` ready, `GET /supported` lists `stellar:testnet exact`,
and the catalog is intact. Only then consider a settlement.

**Communicate.** This is the one incident that would require saying so publicly:
the facilitator's address is published in the evidence documents, and a reader
comparing it to the chain would notice.

## B — Demo buyer secret compromise

**Detect.** The buyer's USDC falls without matching rows in the spend ledger.
That divergence is the signal: a stolen key spends directly and our ledger never
sees it.

**Contain.** `DEMO_ENABLED=false` first, because it is fastest. Then stop the
service.

**Rotate.** New keypair into `DEMO_BUYER_SECRET`, redeploy, establish the USDC
trustline, fund it. Leave the compromised account empty rather than topping it up.

**Preserve.** Record the compromised public address and the ledger's day totals
before redeploying; the volume survives a redeploy, so the ledger is not at risk.

**Recover, verify.** `/ready` reports 200 with a balance above the floor. Confirm
with the safe probe, not a payment.

**Communicate.** Low urgency. The float is worthless testnet USDC and the
address appears only in hosted evidence.

## C — Unexpected spend

**Detect.** Balance moved and the ledger does not explain it, or the ledger
explains it and nobody meant it.

**Contain.** `DEMO_ENABLED=false`.

**Investigate, in this order.** Ledger first: `day_spend` and the `requests`
rows, read from inside the container. Then Horizon for the buyer's operations.
Then match hashes. The ledger records intent, the chain records outcome, and the
gap between them is the finding.

**Do not rewrite accounting history.** A committed reservation stays committed
even if the payment turned out not to have happened. Under-spending the budget is
free; making the ledger agree with a story is not.

**Recover.** Re-enable only once the cause is understood.

## D — SSRF suspected in the domain verifier

**Detect.** Outbound connections from the facilitator to addresses that are not
public. `UNSAFE_ORIGIN` counts rising against origins that should be reachable.

**Contain.** Stop the facilitator. There is no separate switch for verification,
because it is enrichment inside the facilitator process. **Noted as a gap** in
`pubnet-readiness.md`; on testnet the blast radius is a fetch.

**Preserve.** The `domain_verification` table holds origin, status, reason and
timestamps. No response bodies are stored, deliberately, so the evidence is the
row and the origin, not the payload.

**Recover.** The verifier is derived state: dropping `domain_verification` costs
a re-fetch and nothing else. Listings keep their bindings.

**Verify.** The 14 address cases in `packages/catalog/test/ownership.test.ts`
assert no request is attempted for a forbidden address. Re-run them.

## E — Catalog or ownership corruption

**Detect.** A listing bound to an unexpected `payTo`. `OWNERSHIP_CONFLICT` counts
rising. A `domain-verified` listing that the origin does not declare.

**Contain.** Stop the facilitator to freeze writes. The catalog is the source of
truth and is on a volume, so it survives.

**Preserve.** Copy `/data/catalog.db` before touching anything.

**Recover.** The search index is derived and can be rebuilt for free. Ownership
is not: it is bound at first settlement and is on-chain-anchored through
`last_settlement_tx`. Reconstruct from settlement history rather than by editing.

**Verify.** Cross-seller overwrite still rejected, and `domain-verified` still
outranks `tofu`.

## F — Railway account or project compromise

**Detect.** Deployments nobody triggered. Variables changed. New services.

**Contain.** Rotate Railway credentials and enable every account protection
available. Assume both application secrets are compromised and run A and B.

**Preserve.** Deployment history, including the commit each build came from, is
in the Railway API and is the only record of what was actually running.

**This is the boundary with no technical control.** It reaches every asset. It is
recorded as such in `assets-and-trust-boundaries.md` rather than treated as
unlikely.

## G — Stellar RPC or network incident

**Detect.** Settlements failing with simulation errors. `/ready` on the seller
turning 503. Horizon slow or erroring.

**Contain.** Nothing to contain: the failure is external and the system fails
closed. Payments do not half-happen; they fail before signing or become
`uncertain` and are never retried.

**Recover.** The seller's facilitator probe climbs 1, 2, 4, 8, 16 seconds and
holds at 30, and recovers with no restart. The demo buyer refuses in the
meantime.

**Verify.** `GET /supported` and `GET /ready`.

## H — Accidental operator-triggered payment

The incident that has actually happened, twice.

**Detect.** A settled row in the ledger nobody meant to create. Balance down by
0.001 USDC.

**Immediately: stop using payable probes.** Switch to
`{"nope":1}` → 400, or `/health`, or `/ready`. This is the containment step,
because the loop that caused it is usually still running.

**Inspect the ledger.** `day_spend` and the most recent `requests` rows, from
inside the container. Note `created_at`, `status` and `tx_hash`.

**Inspect Horizon.** Confirm the transaction exists and matches.

**Record the transaction.** Add it to the relevant hosted evidence document with
what caused it. Both prior incidents are recorded in `HOSTED-E-07` and
`FINDINGS-2026-08-16.md`, including the second one, which happened after the
lesson had already been written down.

**Verify whether the spend was expected.** If it was a deliberate acceptance
test, it belongs in evidence. If it was a probe, it belongs in findings.

**Do not rewrite accounting history.** The ledger recorded what happened. The
budget absorbing an accident is the control working.
