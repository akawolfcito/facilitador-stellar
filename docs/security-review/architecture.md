# Architecture and trust boundaries

The deployed system, drawn for security rather than for a pitch.

## Diagram

```
                          ┌──────────────────────────────────────── TB-1
   internet visitor       │  hostile. supplies a query string and, at most,
        │                 │  500 characters of plain text.
        ▼
   Railway edge  ─────────┤  TB-2  measured: two x-forwarded-for entries.
        │                 │  [0] real visitor, [1] internal hop, varies per
        │                 │  request. client-supplied entries discarded.
        ▼                 │  trustProxy = 2 resolves [0].
 ┌──────────────────┐     │
 │  x402seek-web    │ PUBLIC · no secret · no persistent state
 │  x402seek.xyz    │ derives clientKey = sha256(bucket(visitor))[0..16]
 └──┬────────────┬──┘
    │            │
    │ GET        │ POST /api/live/demo-payment      ← the only route that spends
    │ read-only  │ forwards { requestId?, text?, clientKey }
    │            │
    │            ▼ ──────────────────────────────── TB-3  Railway private network
    │      ┌──────────────────┐                     no public domain, one peer
    │      │  demo buyer      │ PRIVATE · holds DEMO_BUYER_SECRET
    │      │  :4430           │ volume /data → spend ledger (SQLite)
    │      └────────┬─────────┘ trustProxy = false, deliberately
    │               │
    │               │ GET 402, then GET with payment  ── TB-4  public internet
    │               ▼
    │      ┌──────────────────┐
    │      │  demo seller     │ PUBLIC · no secret · receives payment
    │      │  demo-api…       │ serves /.well-known/x402
    │      └────────┬─────────┘
    │               │ POST /verify, /settle           ── TB-5
    │               ▼
    └─────► ┌──────────────────┐
            │  facilitator     │ PUBLIC · holds SIGNER_SECRET_KEYS
            │  facilitator…    │ volume /data → catalog (SQLite) + embeddings
            │                  │ trustProxy = 2
            └───┬──────────┬───┘
                │          │
                │          └──► domain verifier ──── TB-6  arbitrary HTTPS origins
                │                                    SSRF boundary lives here
                ▼
        ┌──────────────────┐
        │ Stellar testnet  │ ── TB-7  Horizon + Soroban RPC, third party
        │ Soroban RPC      │
        └──────────────────┘
```

## Components

| Component | Public | Secret | Persistent state | Can spend | Attacker-controlled input |
| --- | --- | --- | --- | --- | --- |
| `x402seek-web` | yes, `x402seek.xyz` | **none** | none | no, but **triggers** a spend | query string, 500 chars of text, HTTP headers |
| facilitator | yes | `SIGNER_SECRET_KEYS` | `/data` catalog + embeddings | **yes**, submits and sponsors | full x402 payloads from any seller |
| demo seller | yes | none | none | no, receives only | query string |
| demo buyer | **no** | `DEMO_BUYER_SECRET` | `/data` spend ledger | **yes**, signs payments | two fields, via the web only |
| catalog SQLite | no | — | ownership, listings, verification | no | seller-supplied discovery metadata |
| search index | no | — | embeddings, derived | no | listing text |
| domain verifier | no | — | writes verification rows | no | **an arbitrary HTTPS origin's response** |
| Railway private net | — | — | — | — | reachable only from inside the project |
| Stellar testnet / RPC | third party | — | the chain | — | trusted for availability, not for truth |
| canonical testnet USDC | third party | — | — | — | `CBIELTK6…`, pinned |

## Trust boundaries

**TB-1 — internet visitor → x402seek-web.** Nothing crosses that is
authenticated. The visitor supplies a query and up to 500 characters of plain
text. Validated: length, type, control characters, and an allowlist of exactly
two body properties. A malicious visitor gets the same service as an honest one,
because there is nothing here to escalate to.

**TB-2 — Railway edge → x402seek-web.** The visitor's identity does not exist
until this hop is resolved. `trustProxy = 2` is measured, not assumed: Railway
sends two forwarded entries, the first is the real client, the second an internal
address that changes per request, and client-supplied entries are discarded.
Fastify counts hops back from the socket, so a value a caller prepends is never
reached. If Railway changes its forwarding shape this number becomes wrong
silently, in the direction of one shared bucket. See `FINDINGS-2026-08-16.md`
SR-01 for what that looked like when it was wrong.

**Rate limiting on this system is per-visitor only because of TB-2.** Any
description of it that omits the trusted-hop resolution is describing something
that was not true a day ago.

**TB-3 — x402seek-web → demo buyer.** Railway's private network. The buyer has
no public domain, so this is the only path to it, and `demo-buyer.testnet…` does
not resolve from outside. The buyer therefore trusts exactly one peer, and
`trustProxy: false` there is correct rather than an oversight: with one peer,
trusting a forwarded header would be the bug. `clientKey` crosses and is trusted
for rate-limit bucketing only; a forged one selects a different queue and
nothing more.

*If x402seek-web is malicious:* it can trigger demo payments at the demo's own
fixed terms, up to the daily ceiling. It cannot change the payee, amount, asset,
network or resource, because none of those exist in the request.

**TB-4 — demo buyer → demo seller.** The public internet. The seller's live 402
is the authority for terms, and the buyer validates it twice: once pre-flight,
once as an `x402Client` policy applied immediately before signing.

*If the seller is malicious:* it can change its terms, and the buyer refuses to
sign. It cannot cause a payment to a different payee.

**TB-5 — seller → facilitator.** The seller calls `/verify` and `/settle`. Note
the direction: the **buyer never talks to the facilitator**, which is why the
demo buyer holds no facilitator credential and knows no facilitator URL.

*If the seller is malicious:* it submits payloads the facilitator validates
independently. Rate-limited per caller boundary, and the facilitator refuses to
be the payer or a signer in any client-supplied auth entry.

**TB-6 — domain verifier → arbitrary HTTPS origin.** The most hostile boundary
in the system: a URL a stranger chose, fetched by a host that holds a signing
key. HTTPS and port 443 only, every resolved address checked, the checked address
pinned into the connection, zero redirects followed, 5 s, 64 KB streamed,
identity encoding, JSON only.

*If the origin is malicious:* it can lie about who owns a listing, which is what
`domain-mismatch` exists to surface. It cannot reach an internal service and
cannot slow us down past 5 seconds.

**TB-7 — facilitator → Stellar RPC and Horizon.** Third-party infrastructure,
trusted for availability and never for truth: settlement outcomes are read back
from the chain, which is the discipline E-06a forced.

*If the RPC is malicious or buggy:* simulation and submission fail or lie.
Balances and transactions are verifiable independently by anyone, which is how
every piece of hosted evidence in this repository was produced.

**TB-8 — operator → Railway.** Secrets are set through the Railway API and live
only in the variable store of the one service that needs them. This boundary has
no technical control beyond Railway account security, and it is the boundary
where both recorded incidents happened. Operator error is treated as a first-class
failure class in `threat-model.md`, not as an afterthought.
