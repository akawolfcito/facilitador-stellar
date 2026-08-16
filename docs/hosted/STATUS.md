# x402Seek: current posture

2026-08-16. Core `feat/hosted-testnet-facilitator`, web `main`.
SCF implementation and proposal freeze remains `762c6e6`; everything below is
later work and changes no frozen artifact.

## x402Seek is LIVE TESTNET

Not production. Not mainnet ready. Not production ready. Those three phrases are
banned from this document and from the site, and the reason is plain: this runs
on Stellar testnet with testnet USDC, has had no third-party security review,
and has never been asked to carry traffic.

## Proven

Each of these has been exercised against the hosted deployment and, where money
moved, verified against the chain rather than against an HTTP status.

- natural-language discovery over a semantic index
- abstention: refusing to recommend anything when nothing clears 0.22 cosine
- live 402 inspection, decoded from the seller's current header
- exact USDC settlement on Stellar testnet
- browser-triggered demo payment (`HOSTED-E-07`)
- facilitator fee sponsorship: the buyer's XLM delta is exactly zero
- automatic Bazaar cataloging, driven by settlement
- persistent search index and catalog across restart
- restart-safe demo spend ledger, reserve-before-signing
- idempotent demo payment trigger, verified in production

## Not yet

- Stellar pubnet
- the `upto` scheme
- contract accounts
- third-party security review
- `.well-known/x402` domain binding
- user-controlled wallet payment (option A in the architecture note)

## Services

| Service | Public | Holds a key |
| --- | --- | --- |
| `x402seek-preview` (the site) | yes, `x402seek.xyz` | no |
| `x402seek-facilitator-testnet` | yes | yes, the facilitator signer |
| `x402seek-demo-seller-testnet` | yes | no, a seller receives |
| `x402seek-demo-buyer-testnet` | **no**, private network only | yes, the demo buyer |

The demo buyer has no public domain. A stranger cannot call it directly, and
that is a property of the topology rather than a rule someone enforces.

## The demo payment, in one paragraph

A visitor clicks one button. x402Seek's own testnet demo buyer reads the
seller's live 402, checks it is the one payable demo at both the validation and
the signing boundary, reserves against a UTC daily budget, signs, and retries.
The visitor pays nothing and the page says so before the button and again after
it. Everything about the payment is a server-side constant: the network, the
scheme, the asset, the payee, the amount and the resource. The request shape has
no payment field, so there is nothing for a caller to influence.

## When the demo cannot run

Budget spent, buyer below its floor, demo switched off, rate limited, seller
unavailable, facilitator unavailable, or live terms changed: the button refuses
with a reason and the rest of x402Seek is untouched. Verified in production with
`DEMO_ENABLED=false`: live discovery answered, abstention refused at 0.026828
against 0.22, the live 402 read, and the recorded evidence stood.

The browser payment is additive. It has never been a dependency of x402Seek and
must not become one.

## Evidence

- `HOSTED-E-01`…`HOSTED-E-06`: hosted facilitator, seller, settlement, cataloging, restart
- `HOSTED-E-07`: the first browser-triggered settlement, and the defects it exposed
- `demo-buyer-implementation-plan.md`: what was approved before any of it was built
- `browser-payment-architecture.md`: the four options and why C was chosen
