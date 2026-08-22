# HOSTED-E-03 — Balance deltas and fee sponsorship

**Claim.** The buyer paid in USDC and spent no XLM; the hosted facilitator paid
the network fee.

Measured on chain before and after the settlement in
[HOSTED-E-02](./HOSTED-E-02-settlement.md), not read from the facilitator's own
success flag.

| Account | USDC | XLM |
|---|---:|---:|
| buyer `GA2DVFND…KOA3` | **−0.0010000** | **+0.0000000** |
| seller `GD45744Y…XBRK` | **+0.0010000** | +0.0000000 |
| facilitator `GDX6H6PL…ZEMQ` | — | **−0.0022973** |

Facilitator XLM: 20.0000000 → 19.9977027.

## Observed fee

**22,973 stroops = 0.0022973 XLM**, read from `fee_charged` on the transaction
result.

This is the exact figure this repository already had: the nine-payment run in
E-19 cost 0.0206757 XLM in total, a mean of 0.0022973 per settlement. A hosted
signer costs what the local one did.

**That is one observation, not a guarantee.** Stellar fees respond to network
conditions, and a single settlement on a quiet testnet says nothing about what a
busy ledger will charge. The operator alert thresholds in `apps/facilitator/src/metrics.ts`
are derived from this magnitude precisely because it is a magnitude and not a
constant.

## Why the buyer spent no XLM

The facilitator runs with `ARE_FEES_SPONSORED=true`. The buyer signs an auth
entry authorising one transfer; the facilitator builds, signs and submits the
transaction, and is therefore the fee source account. An agent needs only the
payment asset and never has to hold gas.

RFP §3.1 asks for this to be demonstrated rather than asserted in a header. The
`+0.0000000` above is that demonstration, now on a deployment anyone can reach.

## Fee accounting in the facilitator

The facilitator records sponsored spend by reading `feeCharged` from the chain
after answering, and keeps confirmed spend strictly apart from settlements whose
fee it could not read. It was not enabled during this settlement —
`ENABLE_INTERNAL_METRICS=false` — so the figure above comes from the transaction
result directly, which is the same source the metric would have used.
