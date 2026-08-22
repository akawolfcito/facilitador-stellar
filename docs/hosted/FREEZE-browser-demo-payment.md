# Browser demo payment: FEATURE FROZEN

2026-08-16. Core `feat/hosted-testnet-facilitator`, web `main`.

The bounded demo-payment path is frozen. It works, it is documented, it survives
restart, and it is bounded by construction. Nothing further is planned for it.

## Frozen surface

| Thing | Value |
| --- | --- |
| Route | `POST /api/live/demo-payment` on x402seek.xyz, one bounded demo-payment proxy |
| Upstream | `x402seek-demo-buyer-testnet`, private network, no public domain |
| Resource | `https://demo-api.testnet.x402seek.xyz/summarize`, one, pinned |
| Payee | `GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK`, one, pinned |
| Asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, pinned |
| Amount | `10000` base units, exact, not a ceiling |
| Network / scheme | `stellar:testnet` / `exact`, locked |
| Caller input | `requestId` and `text` only; anything else is a 400 |
| Per visitor | 3 per hour, enforced at the proxy on the real address |
| Global | 5 per minute at the buyer |
| Daily | 150 payments and 0.15 USDC per UTC calendar day |
| Concurrency | 1, with an 8 second wait for the slot |
| Balance floor | 0.5 USDC, checked before signing |

## What "frozen" forbids

Without a new, explicit phase:

- no wallet integration, SEP-43 or otherwise
- no additional sellers or resources
- no generalising the payment route
- no raising any budget or limit
- no arbitrary x402 payments
- no redesign of the flow

## Why it can be frozen

Every control was verified against the deployed system rather than argued from
the code:

- the signing boundary is enforced twice, and the second layer is an
  `x402Client` policy the stock client applies before building a payment
- eleven payment-shaped fields are refused by name, in production
- the spend ledger survived a restart with its day totals and request rows
  intact, and the UTC day rolled at midnight without a rolling window
- idempotency was proven in production: the same `requestId` returned the stored
  result and no second balance movement
- an uncertain settlement stays committed and is never retried
- readiness now asks every condition a payment depends on, not just the budget
- the demo buyer has no public domain
- the browser never receives the key, the token, or a raw IP
- with `DEMO_ENABLED=false` in production, the rest of x402Seek kept working

## Known and accepted

**Metrics counters are in-memory and reset on restart.** The ledger is what
persists, and it is what the budget is enforced from. A counter that said "zero
settled" after a redeploy while the ledger said three would be confusing, so
`/internal/metrics` describes this process and the ledger fields describe the
day. Not worth a database.

**Two settlements happened that were not the canonical one.** Both are
reconciled in `HOSTED-E-07`: one through the public button twelve minutes after
the canonical payment, and one spent by an Option D test whose detection loop
was posting a payable body. Neither is a control failure; the second is a
lesson about probing with an invalid body.

**Attribution is coarse by design.** The ledger stores a sixteen-character hash
of an address bucket, never an address. Two visitors behind the same IPv6 /64
are one visitor to these controls, which is the intended trade.

## Next

Return to the RFP technical roadmap. Option A, a user-controlled SEP-43 wallet,
remains viable and unimplemented: the architecture note records that
`ClientStellarSigner` is a plain interface, so the signer could be swapped
without touching the invariants. That is a new phase, not a continuation of this
one.
