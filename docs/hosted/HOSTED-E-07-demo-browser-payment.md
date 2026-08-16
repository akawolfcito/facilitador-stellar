# HOSTED-E-07 — browser-triggered demo payment

2026-08-15T22:59:51Z. Ledger 4162626.
Core `83133ef`, web `58a18fc`. SCF implementation and proposal freeze remains `762c6e6`.

The first x402 settlement on this project caused by clicking a button on
x402seek.xyz rather than by running a client from a terminal.

**The visitor did not pay.** x402Seek's own testnet demo buyer did, at a fixed
price, to a fixed seller, for a fixed resource, under a spend ceiling. The page
says so before the button and again after it.

## Live terms, validated before signing

Read from the seller's `payment-required` header at request time. The catalog
was not consulted.

| Field | Value |
| --- | --- |
| status | `402` |
| network | `stellar:testnet` |
| scheme | `exact` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| amount | `10000` base units |
| payTo | `GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK` |
| resource | `https://demo-api.testnet.x402seek.xyz/summarize` |

Checked twice against the same predicate: once pre-flight, and once as an
`x402Client` policy applied to `accepts` immediately before the payment was
built. The second is the one that matters, because `wrapFetchWithPayment`
re-reads the 402 itself.

## Settlement

Transaction
`1ef1a6bb8d6d8b2f6c1a003d73ed13594c683f38095d1b124bae8c3822ccc4f6`
· [Stellar Expert](https://stellar.expert/explorer/testnet/tx/1ef1a6bb8d6d8b2f6c1a003d73ed13594c683f38095d1b124bae8c3822ccc4f6)

Read from Horizon, not from the HTTP response:

- `successful: true`
- `source_account: GDX6H6PL2DYMYW5UUZ6GGUD7UNCCHO6HNQMQDGQM4AMVP3LDGUZ2ZEMQ` — our
  facilitator submitted it, which is the check E-06a exists to force
- `fee_charged: 22973` stroops (0.0022973 XLM)

## Balances, before and after

| Account | Address | USDC before | USDC after | Δ USDC | Δ XLM |
| --- | --- | --- | --- | --- | --- |
| Demo buyer | `GBCDHGGFXEAD3CK5JMBQFTWRBH6P2XOSYPM22XTC3NKAUOWMQ7WEORIX` | 5.0000000 | 4.9990000 | **−0.0010000** | **0.0000000** |
| Seller | `GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK` | 0.0010000 | 0.0020000 | **+0.0010000** | 0.0000000 |
| Facilitator | `GDX6H6PL2DYMYW5UUZ6GGUD7UNCCHO6HNQMQDGQM4AMVP3LDGUZ2ZEMQ` | 0 | 0 | 0 | **−0.0022973** |

The buyer's XLM delta is exactly zero. Fee sponsorship paid for the whole
transaction, and the facilitator's XLM delta matches `fee_charged` to the
stroop. A buyer holding no XLM at all could have made this payment.

## Seller response

`HTTP 200`

```json
{ "summary": "a reviewer clicked the button on x402seek.xyz and… (16 words)" }
```

The input was a sentence the caller supplied. It is the only thing a caller can
supply: plain text, 500 characters, passed as a query parameter to one pinned
resource. No payment field exists in the request shape.

## Ledger and limits, active during this payment

- `requestId dc659c81-c245-44bc-b8b9-f9ad003de5f3`, reserved before signing,
  committed after
- budget after this payment: **148 of 150** remaining for the UTC day
- daily ceilings: 150 payments **and** 0.15 USDC, whichever binds first, resetting
  at 00:00 UTC
- per-IP 3/hour on the /64, global 5/minute, concurrency 1
- balance floor 0.5 USDC, checked before signing

Two of the day's 150 were consumed earlier by pre-fix attempts that signed
against an unfunded account, which is the reserve-before-signing rule behaving
exactly as designed: it commits when the outcome is unknown rather than assuming
the money is safe.

**Idempotency, verified in production.** Replaying the same `requestId` returned
the stored result with `replayed: true` and the identical transaction hash, and
the buyer's balance did not move: still 4.9990000 after the replay.

## Two defects this milestone found

Both were found by running against real accounts rather than by reasoning about
them, and both are recorded because the second one is the sort that hides.

**No USDC trustline.** The buyer was created and funded with XLM by friendbot,
but a Stellar account cannot receive a classic asset without a trustline, so the
first funding attempt had nowhere to land. Created in
`4c1bd724e7f5edb757c7ec077f9984f6b7c31029e4f69d9355ef02500459cd2d`.

**The balance was read in the wrong representation.** The reader looked for the
asset by contract address. Canonical testnet USDC is a classic asset issued by
`GBBD47IF…`, and `CBIELTK6…` is the Stellar Asset Contract wrapping it: the 402
quotes the contract, the balance lives in the trustline behind it. Reading by
contract address returns nothing at all. What exposed it was querying the hosted
seller, an account that had been receiving USDC for days, and getting zero. With
that bug the balance floor would have refused every payment forever once the
buyer was funded. Fixed in `83133ef`.

## Every settlement this buyer has made

Reconciled against the ledger and the chain after a restart, because a record
that only mentions the payment I meant to make is not a record.

| When (UTC) | Status | Transaction | What it was |
| --- | --- | --- | --- |
| 2026-08-15T20:53:55 | `uncertain` | none | pre-fix probe, signed against an unfunded account |
| 2026-08-15T22:59:44 | `settled` | `1ef1a6bb8d6d…` | the canonical payment recorded above |
| 2026-08-15T23:11:39 | `settled` | `5456de18d29c…` | a second browser-triggered payment, twelve minutes later |
| 2026-08-16T02:40:46 | `settled` | `5dc0ab05cdbb…` | spent by my own Option D test, see below |

Buyer USDC: 5.0000000 funded, 4.9970000 now. Three settlements at 0.001 each.
Ledger: 3 payments and 30000 units on 2026-08-15, 1 payment and 10000 units on
2026-08-16. The day rolled at 00:00 UTC exactly as designed.

The second settlement was not initiated from this terminal. It came through the
public button while the deployment was live. Attribution is not possible from
the ledger, for the reason in the next section.

The fourth was mine and was avoidable. Switching `DEMO_ENABLED` to false takes
about thirty seconds to reach the container, and the loop I used to detect the
change was posting a *payable* body every ten seconds. The first one paid. An
invalid body would have told me the same thing for nothing. Recorded because a
test that quietly spends is exactly the kind of thing a spend ledger exists to
surface.

## The rate limit was limiting the wrong thing

Found by reading the ledger rather than by reasoning about it. All three
requests on 2026-08-15 carried the same bucket, from three different moments.

The demo buyer sits behind the web proxy on Railway's private network, so the
only peer it ever sees is that proxy. Every visitor arrived as the same address.
Two consequences:

- the per-IP limit of three an hour was a **global** three an hour on the whole
  site, which fails safe but is not the control that was described;
- the thirty second duplicate guard, which exists to catch a double click, could
  have handed one visitor **another visitor's receipt**: same bucket, recent row,
  replay.

The visitor's identity only exists at the proxy, so that is where it is derived
now, hashed to sixteen hex characters and passed down as `clientKey`. The proxy
enforces three an hour on the real address before the buyer is troubled; the
buyer uses the key as its bucket and falls back to the peer address without one.
`clientKey` selects a queue and nothing else, and is refused from a caller's
body, because a caller who can name their own bucket has no limit at all.

Fixed in core `dcb9e75` and web `d998705`.

## What this does not claim

One payment. Not traffic, not volume, not uptime, not a load test. The budget,
the rate limits and the concurrency cap were all active and none of them was
exercised near its ceiling.

Option D remains the floor. Verified with the buyer unfunded and again after:
live discovery answers, abstention refuses at 0.026828 against a 0.22 threshold,
the live 402 reads, and the recorded evidence stands whether or not the demo
buyer can pay.
