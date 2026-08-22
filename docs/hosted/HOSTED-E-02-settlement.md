# HOSTED-E-02 — Canonical hosted settlement

**Claim.** A buyer paid a public resource through the hosted facilitator, on
Stellar testnet, and received the paid response.

**Transaction.**
[`cbd40ab0afff1a92773f58994d43a326d44be33b0c836c12cb1760db4b4f8752`](https://stellar.expert/explorer/testnet/tx/cbd40ab0afff1a92773f58994d43a326d44be33b0c836c12cb1760db4b4f8752)

**Command.** `SELLER_URL=… FACILITATOR_URL=… BUYER_SECRET=… tsx apps/e2e-stellar/src/hosted-client.ts`

## The flow, as executed

1. Unpaid `GET https://demo-api.testnet.x402seek.xyz/summarize?text=…` → **402**
2. Terms read from the live `payment-required` header — not from any catalog
3. Buyer signs a Soroban auth entry for exactly those terms
4. Seller calls the hosted facilitator's `/verify`, then `/settle`
5. Facilitator submits to Stellar testnet
6. Paid retry → **HTTP 200**

```json
{"summary":"The quick brown fox jumps over the lazy… (12 words)"}
```

## Live terms, verified before signing

| | |
|---|---|
| network | `stellar:testnet` |
| scheme | `exact` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (canonical testnet USDC) |
| amount | `10000` = 0.0010000 |
| payTo | `GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK` |
| resource | `https://demo-api.testnet.x402seek.xyz/summarize` |

The client fails closed on any mismatch and refuses outright if the 402
references `x402.org`.

## Which facilitator actually settled it

Read from the chain, not from anyone's success flag:

```
source_account  GDX6H6PL2DYMYW5UUZ6GGUD7UNCCHO6HNQMQDGQM4AMVP3LDGUZ2ZEMQ
successful      true
fee_charged     22973 stroops
```

The source account is the **hosted facilitator's own signer**. That is the point
of recording it: a facilitator URL can be misconfigured and a whole payment flow
will still appear to work while settling somewhere else entirely. This project
shipped exactly that bug once — a fully green run settled by the public
x402.org facilitator (E-06a) — and the transaction's source account was the only
thing that gave it away. It is checked here for the same reason.

## Participants

| Role | Public address |
|---|---|
| Buyer | `GA2DVFND5DMIN3WO2UH5WXJSDVSZQMLV625CWEPVEIF3C3EEU65RKOA3` |
| Seller | `GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK` |
| Facilitator | `GDX6H6PL2DYMYW5UUZ6GGUD7UNCCHO6HNQMQDGQM4AMVP3LDGUZ2ZEMQ` |

One payment. Not a load test, not a benchmark.
