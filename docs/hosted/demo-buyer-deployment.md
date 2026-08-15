# Demo buyer deployment

Date: 2026-08-15. Branch `feat/hosted-testnet-facilitator`.

**Not evidence.** This records what was provisioned and what is still missing.
`HOSTED-E-07` will be written after the first real browser-triggered settlement,
and not before, because there is nothing yet to record.

## Railway topology: PRIVATE

Verified rather than assumed. `railway list` returns one project,
`x402seek-preview`, and `railway status --json` from the web repository lists
three services inside it:

```
x402seek-preview
x402seek-facilitator-testnet
x402seek-demo-seller-testnet
```

The demo buyer was created as a fourth service in the same project, so Railway's
private network is available. Consequences, all of them good:

- no public domain for the demo buyer
- no `X-Demo-Proxy-Token`, and no token to rotate or leak
- no CORS, because no browser can reach it
- x402seek-web remains the only public entry point

Confirmed from outside: `https://demo-buyer.testnet.x402seek.xyz/health` does not
resolve. "A stranger cannot call it directly" is a property of the topology, not
a rule someone enforces.

## Provisioned

| Thing | Value |
| --- | --- |
| Service | `x402seek-demo-buyer-testnet` |
| Volume | mounted at `/data`, for the spend ledger |
| Branch | `feat/hosted-testnet-facilitator`, pinned by a deployment trigger |
| Internal address | `x402seek-demo-buyer-testnet.railway.internal:4430` |
| Buyer public address | `GBCDHGGFXEAD3CK5JMBQFTWRBH6P2XOSYPM22XTC3NKAUOWMQ7WEORIX` |
| XLM | funded by friendbot |
| USDC | **none yet** |

The buyer is a fresh account created for this service alone. It is not the
facilitator signer, not the buyer from the recorded evidence runs, and not any
developer wallet. The key was generated in memory, sent once to Railway's
variable store, and never written to disk, logged, or printed.

## What the chain already proves

The first live call through `https://x402seek.xyz/api/live/demo-payment`
returned `SETTLEMENT_STATE_UNCERTAIN`, which means the request reached the web
proxy, crossed the private network, reached the buyer, which read the seller's
live 402, validated it, signed, and failed on chain for want of funds. Every hop
works. Only the money is missing.

That first call also found a real defect. A fresh account funded by friendbot has
an XLM balance and no USDC entry at all, and the balance reader returned `null`
for that, which the floor check treats as "could not tell, carry on". So the one
buyer guaranteed to be unable to pay was the one the floor would have waved
through. Fixed in `f64d36e`: only a failure to reach Horizon is unknown, and an
account that answers with no USDC entry holds zero. The same call now returns
`BUYER_BALANCE_LOW` and signs nothing.

Two units of the day's budget were committed by those pre-fix attempts, which is
the reserve-before-signing rule working as intended. The budget resets at 00:00
UTC.

## What is blocked

**5 USDC of canonical testnet USDC**
(`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`) to
`GBCDHGGFXEAD3CK5JMBQFTWRBH6P2XOSYPM22XTC3NKAUOWMQ7WEORIX`.

There is no automated source for it from here. Friendbot issues XLM only, and
this repository holds no funded account it could transfer from. It needs either
Circle's testnet faucet or a transfer from an existing holder, both of which are
a person's action rather than a script's.

Until then the demo refuses with `BUYER_BALANCE_LOW` before signing, and
x402seek.xyz is otherwise unchanged: live discovery answers, abstention refuses
at 0.026828 against a 0.22 threshold, the live 402 reads, and the recorded
evidence stands. That is option D, and it was always the floor.

## After funding

1. One canonical payment through the public button.
2. Record live 402 terms, buyer and seller USDC before and after, buyer XLM
   delta, facilitator XLM delta if observable, transaction hash, seller
   response, and the ledger row.
3. Verify the on-chain identities from Horizon rather than from the HTTP
   response.
4. Write `HOSTED-E-07`.
