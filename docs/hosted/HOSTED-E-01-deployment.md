# HOSTED-E-01 — Public deployment on Stellar testnet

**Claim.** The facilitator and one paid resource are reachable on the public
internet over TLS, on `stellar:testnet`, from the hosted-testnet branch.

## Endpoints

| | |
|---|---|
| Facilitator | `https://facilitator.testnet.x402seek.xyz` |
| Demo seller | `https://demo-api.testnet.x402seek.xyz` |
| Paid resource | `https://demo-api.testnet.x402seek.xyz/summarize` |

Both domains are Railway custom domains with issued certificates
(`CERTIFICATE_STATUS_TYPE_VALID`); `curl` reports `ssl_verify_result: 0` against
each. DNS is a CNAME per host plus a `_railway-verify` TXT, all propagated.

## Facilitator response at deployment

```json
{"status":"ok","ready":true,
 "discovery":{"status":"ready","indexed":0},
 "network":"stellar:testnet",
 "rpcUrl":"https://soroban-testnet.stellar.org",
 "signers":1,"catalog":0,"settlements":{"inFlight":0}}
```

`/health`, `/ready`, `/supported` and `/discovery/resources` all answer 200.
`/internal/metrics` answers **404**: it is routed only when both
`ENABLE_INTERNAL_METRICS` and `METRICS_TOKEN` are set, and neither is.

## Operator identity

Hosted facilitator signer: `GDX6H6PL2DYMYW5UUZ6GGUD7UNCCHO6HNQMQDGQM4AMVP3LDGUZ2ZEMQ`

Created fresh for hosted operation and funded with **20 XLM**, deliberately.
Friendbot hands out a fixed and very large amount, which is the opposite of what
a key that spends on request should hold, so a throwaway treasury created this
account with a chosen starting balance. The evidence accounts from `762c6e6` are
untouched, which keeps the frozen evidence reproducible.

## Deployment

- Repository `akawolfcito/facilitador-stellar`, branch
  `feat/hosted-testnet-facilitator`
- Built from `apps/facilitator/Dockerfile`; the embedding model is baked in at
  build time so a container start never depends on the Hugging Face CDN
- Railway persistent volume mounted at **`/data`**, with
  `CATALOG_PATH=/data/catalog.db`
- Railway health check targets `/ready`, not `/health` — the process being alive
  and discovery being able to answer are different questions
- Runs as `node`. The container starts as root only to take ownership of the
  mounted volume, then replaces itself via `setpriv`; PID 1 runs as uid 1000

## Scope

**LIVE TESTNET.** Not production, not mainnet, not mainnet-ready.

`exact` only — `upto` is not implemented. Classic `G…` accounts only — contract
accounts remain untested and upstream-gated. `DEPLOYMENT_NETWORK_LOCK=testnet`
makes the process refuse to start on any other network.
