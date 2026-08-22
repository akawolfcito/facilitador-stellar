# Hosted testnet evidence

Post-submission evidence from operating the facilitator as a public service on
Stellar testnet.

## How this relates to `docs/scf/`

| | |
|---|---|
| **`docs/scf/`** | The frozen SCF submission. Evidence E-01 … E-29, tied to commit `762c6e60dee76f47283e38e1f6928429e95f4f84`. |
| **`docs/hosted/`** | This directory. Evidence HOSTED-E-01 … HOSTED-E-06, produced by running the thing in public afterwards. |

**Nothing here rewrites, renumbers or reinterprets a claim tied to `762c6e6`.**
The frozen evidence describes an implementation proven by local and upstream
runs; that description was accurate when written and remains accurate. This
directory records something the frozen evidence deliberately did *not* claim —
that the facilitator is operated as a public service — and it does so under
separate identifiers so the two can never be confused for each other.

The proposal states plainly that "the facilitator is not currently operated as a
public settlement service." That sentence was true at `762c6e6`. It is no longer
true, and **the proposal has not been edited to say otherwise**: changing a
frozen submission after the fact is exactly the thing this project's evidence
discipline exists to prevent. If the claim is ever updated, it will be updated
deliberately, with these E-numbers cited, and not as a side effect.

## What is here

| ID | Subject |
|---|---|
| [HOSTED-E-01](./HOSTED-E-01-deployment.md) | Public deployment, domains and TLS |
| [HOSTED-E-02](./HOSTED-E-02-settlement.md) | The canonical hosted settlement |
| [HOSTED-E-03](./HOSTED-E-03-balances.md) | Balance deltas and fee sponsorship |
| [HOSTED-E-04](./HOSTED-E-04-catalog-tofu.md) | Automatic cataloging and the ownership binding |
| [HOSTED-E-05](./HOSTED-E-05-search.md) | Semantic search over the hosted catalog |
| [HOSTED-E-06](./HOSTED-E-06-restart.md) | Persistence and rehydration across a restart |

## Scope, stated once

This is **LIVE TESTNET**. Not production, not mainnet, not mainnet-ready.

- `stellar:testnet` only. The deployment carries `DEPLOYMENT_NETWORK_LOCK=testnet`
  and refuses to start on any other network.
- `exact` only. `upto` is not implemented.
- Classic `G…` accounts only. Contract accounts (`__check_auth`) remain untested
  and upstream-gated, exactly as the frozen proposal discloses.
- One paid demo resource. This proves the loop, not a marketplace.
