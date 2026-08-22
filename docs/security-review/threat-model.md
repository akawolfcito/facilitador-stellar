# Threat model

Attacker classes, economic paths, and threats with severity and current control.
Invariant identifiers refer to `security-invariants.md`.

## Attacker classes

| | Class | What they get for free |
| --- | --- | --- |
| A | Anonymous internet user | The public surface: the site, the facilitator, the seller. Cannot reach the demo buyer |
| B | Malicious seller or resource | Everything a seller submits: discovery metadata, 402 terms, and the ability to change them between reads |
| C | Malicious `.well-known` origin | Full control of a response our verifier fetches |
| D | Compromised browser | The visitor's own session. There is nothing here to steal: no key, no wallet, no funds |
| E | Compromised `x402seek-web` | Can trigger demo payments at the demo's fixed terms. Holds no secret |
| F | Compromised demo buyer | Its own float and its signing key |
| G | Compromised facilitator | The signer, and therefore fee sponsorship and submission |
| H | Malicious or buggy RPC | Simulation and submission results, and the ability to lie about them |
| I | Railway credential compromise | Everything. No technical control beyond account security |
| J | **Operator error** | Whatever the operator can type. **Two recorded incidents; treated as first-class** |

Class J is not a courtesy inclusion. It is the only class that has actually
caused an unintended spend on this system, twice, and both times through a
mechanism no attacker was needed for.

## Economic side-effect paths

Every path capable of moving value, with the field the rest of this project kept
forgetting: **how to check it without spending.**

### E-1 — Demo buyer payment

| | |
| --- | --- |
| Trigger | `POST /api/live/demo-payment` on x402seek.xyz |
| Signer | `DEMO_BUYER_SECRET`, demo buyer service |
| Maximum authority | exactly 10000 base units, to one `payTo`, one asset, one resource, one network. Not a ceiling: an exact match |
| Rate limit | 3/hour per visitor (web), 5/min global, 1 concurrent |
| Budget | 150 payments **and** 0.15 USDC per UTC day |
| Persistent accounting | SQLite on `/data`, reserve-before-signing, survives restart |
| Idempotency | `requestId` 10 min, plus a 30 s per-bucket guard |
| Replay | Soroban auth nonce and expiry; a replayed authorisation fails on chain |
| Kill switch | `DEMO_ENABLED=false`, ~30 s to propagate |
| Monitoring | `/internal/metrics`, private; the ledger is the record |
| **Safe non-spending probe** | `POST` with `{"nope":1}` → **400**, refused by the body allowlist before the limiter and before signing. Verified in production. Also `GET /ready` and `GET /health` on the buyer, from inside the private network |

### E-2 — Facilitator fee sponsorship

| | |
| --- | --- |
| Trigger | any settlement the facilitator accepts |
| Signer | `SIGNER_SECRET_KEYS` |
| Maximum authority | ~0.0022973 XLM per settlement, measured; bounded by `maxTransactionFeeStroops`, default 50000 |
| Rate limit | settle 10/min, verify 60/min, per caller boundary (`TRUST_PROXY=2`) |
| Budget | **none beyond the balance.** ~20 XLM is the whole ceiling |
| Persistent accounting | metrics count settlements and observed fees; there is no persistent XLM budget |
| Kill switch | stop the Railway service, or rotate the signer |
| **Safe non-spending probe** | `GET /health`, `GET /supported`, `GET /discovery/resources`. A malformed `POST /settle` → **400**, verified in production |

**Noted, not a finding on testnet:** E-2 is the only economic path with no
persistent budget. Its ceiling is the account balance. That is acceptable while
XLM is free and is a `pubnet-readiness.md` precondition, not a defect today.

### E-3 — Settlement submission

| | |
| --- | --- |
| Trigger | `POST /settle` from a seller |
| Signer | facilitator, as transaction source only. It is never the payer (F-1) |
| Maximum authority | whatever the buyer signed, and nothing more: auth entries bind the arguments |
| Rate limit | 10/min; concurrency capped at 4 in flight |
| Replay | the chain rejects a replayed auth entry |
| Kill switch | stop the service |
| **Safe non-spending probe** | as E-2 |

**All three paths have a verified non-spending probe.** That is the property
SEC-OPS-01 exists to make checkable.

## Threats

| ID | Component | Attacker | Attack | Impact | Control | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | demo payment | A | Drain the float by repeated calls | Demo unavailable | 3/h per visitor, 5/min global, 150/day, 0.15 USDC/day, all persistent | LOW | mitigated |
| T-02 | facilitator | A/B | Drain XLM through settlements | Settlement stops for everyone | Rate limit, fee ceiling; **no persistent budget** | MEDIUM | accepted on testnet, pubnet precondition |
| T-03 | demo payment | A | Double click causes two payments | Double spend of the float | `requestId` window plus a 30 s bucket guard; a reserved row is `DEMO_IN_FLIGHT` | LOW | mitigated, tested |
| T-04 | settlement | A/B | Replay a signed authorisation | Double settlement | Soroban nonce and expiry, on chain | LOW | mitigated by protocol |
| T-05 | demo buyer | B | Malformed or missing 402 | Refusal | Fails closed, `LIVE_TERMS_CHANGED`; nothing signed | LOW | mitigated |
| T-06 | demo buyer | B | Change terms between the two reads | Sign the wrong terms | The policy is applied at the signing boundary, so the second read is filtered too (P-2) | LOW | mitigated, the reason two layers exist |
| T-07 | demo payment | A/E | Inject a payment destination | Funds to an attacker | No payment field exists in the request; 12 refused by name at each hop | LOW | mitigated, tested |
| T-08 | domain verifier | C | SSRF to an internal service | Reach a private address | HTTPS/443, every resolved address checked, no request attempted on refusal | LOW | mitigated, 14 cases |
| T-09 | domain verifier | C | DNS rebinding between check and connect | Same | `pinnedLookup` connects to the checked address | LOW | mitigated, and this is where a real bug was found |
| T-10 | catalog | C | Publish a document claiming another payee | A listing labelled wrongly | `domain-mismatch`, visible, never silent | LOW | mitigated, demonstrated live |
| T-11 | catalog | B | Squat an unregistered resource URL | Metadata pollution | TOFU binding, `OWNERSHIP_CONFLICT`, and domain binding where published | MEDIUM | partially mitigated: most resources have no declaration |
| T-12 | catalog | C | Let a verification go stale and rely on it | A label describes the past | 24 h TTL, 7-day grace, then demotion with a logged transition | LOW | mitigated |
| T-13 | demo buyer | A | Discover and call the private service | Bypass the web's limits | No public domain; does not resolve | LOW | mitigated by topology |
| T-14 | any | A | Read a secret from a public surface | Key theft | No secret reaches the browser or the web service; asserted in tests and in production | LOW | mitigated |
| T-15 | logs | I | Read a secret from a log | Key theft | `redact()` names each field; tested | LOW | mitigated |
| T-16 | demo payment | A | Oversized or malicious text | Resource exhaustion, injection | 2 KB body, 500 chars, control characters refused, never fetched, never rendered | LOW | mitigated |
| T-17 | demo buyer | — | Restart during settlement | Double spend on recovery | Reserve-before-signing; a crash leaves the spend counted | LOW | mitigated, tested |
| T-18 | catalog / ledger | — | Volume unavailable or SQLite corrupt | Budget stops being enforced | WAL, `synchronous = FULL`; **`/ready` reports the ledger, but a corrupt ledger fails closed only because reservations throw** | MEDIUM | partially mitigated |
| T-19 | facilitator | H | RPC outage or lies | Settlement fails or misreports | Outcomes read back from the chain; simulation must succeed first | LOW | mitigated |
| T-20 | seller | — | Compromised seller | Bad terms, bad metadata | Terms validated twice; metadata sanitised; ownership bound to `payTo` | LOW | mitigated |
| T-21 | facilitator | G | Compromised signer | Fee drain, hostile submission | Nothing beyond rotation and shutdown. **The highest-value asset with the fewest controls** | HIGH | accepted on testnet; the primary reason for an external audit |
| T-22 | operations | **J** | Probe an economic surface with a payable request | Unintended spend | SEC-OPS-01, safe probes documented and verified per path | MEDIUM | mitigated by procedure only, no mechanism |
| T-23 | proxy | A | Spoof a forwarded address to select another visitor's bucket | Cross-visitor disclosure | `trustProxy: 2`, measured; a prepended entry is never reached | LOW | mitigated, was SR-01 |

### Severity counts

CRITICAL 0 · HIGH 1 · MEDIUM 5 · LOW 17 · INFORMATIONAL 0.

**Unmitigated HIGH or CRITICAL: 0.** T-21 is accepted rather than unmitigated:
its controls are rotation and shutdown, its exposure today is ~20 XLM of testnet
fees, and it is named as the first thing an external audit should look at.

### Closed historical findings

**SR-01** (MEDIUM) and **SR-02** (INFORMATIONAL), both CLOSED. See
`FINDINGS-2026-08-16.md`. They are not active threats and are listed here only so
a reviewer does not rediscover them and wonder whether they were noticed.
