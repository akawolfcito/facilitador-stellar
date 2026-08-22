# Security invariants

What must always hold, with the code that enforces it, the test that pins it and
the hosted evidence that shows it happening. An invariant with no test is
labelled as such rather than asserted.

Paths are repo-relative. Core = `facilitador-stellar`, web = `x402seek-web`.

## Payment

| # | Invariant | Code | Test | Evidence |
| --- | --- | --- | --- | --- |
| P-1 | Catalog metadata is advisory; the live 402 is authoritative | `apps/demo-buyer/src/pay.ts` reads the seller's header and never the catalog | `test/pay.test.ts` "takes them from the header, not from a catalog" | HOSTED-E-07 |
| P-2 | The demo buyer can sign only the canonical demo | `apps/demo-buyer/src/invariants.ts`, enforced twice: `validateLiveTerms` pre-flight and `demoPaymentPolicy` as an `x402Client` policy | `test/invariants.test.ts`, every bad option refused by **both** | HOSTED-E-07 |
| P-3 | The caller controls no payment term | `ALLOWED_BODY_KEYS` in `apps/demo-buyer/src/app.ts`; unknown property is a 400, not an ignored field | 12 fields by name in `test/app.test.ts`; 12 more at the web hop in `test/demo-payment.test.ts` | production sweep, all 400 |
| P-4 | Amounts are compared as integers, never as strings | `isDemoTerms` uses `BigInt` | `test/invariants.test.ts` "compares amounts as numbers" | — |
| P-5 | An ambiguous settlement is never retried | `apps/demo-buyer/src/app.ts` marks `uncertain`, keeps the reservation, returns 502 | `test/app.test.ts` "keeps the budget and never retries" | HOSTED-E-07, one `uncertain` row |
| P-6 | Reserve before signing; release only before signing | `apps/demo-buyer/src/ledger.ts` | `test/ledger.test.ts`, five cases | HOSTED-E-07 ledger |
| P-7 | The daily ceiling survives restart | SQLite on a volume, one transaction per reservation | `test/ledger.test.ts` "survives a restart" | HOSTED-E-07 restart section |
| P-8 | **An operator probe must not be payable** — SEC-OPS-01 | no code enforces this; it is enforced by *which request the operator sends* | the shape tests above prove the safe probes are refused before `pay` is called | FINDINGS SR-01 remediation, and two incidents |

**P-8 is the weakest invariant here and it is stated that way on purpose.** It is
the only one in this document with no mechanism behind it. Every other row can be
broken only by changing code; this one can be broken by typing the wrong thing at
three in the morning, and has been, twice. The mitigation is that every economic
path documents a probe that *is* refused before signing, and those refusals are
tested. See `reviewer-runbook.md`.

## Proxy and identity

| # | Invariant | Code | Test | Evidence |
| --- | --- | --- | --- | --- |
| I-1 | A public caller's identity is derived only after the trusted-hop resolution | `trustProxy: 2` in `src/server.ts` (web), measured not assumed | `test/demo-payment.test.ts` drives `x-forwarded-for`, not `remoteAddress` | FINDINGS SR-01 |
| I-2 | A prepended forwarded value cannot select another visitor's bucket | hop counting from the socket; `2` never reaches a prepended entry | "cannot be made to select another visitor's bucket" | measured table in SR-01 |
| I-3 | The browser cannot supply its own `clientKey` | rejected by the body allowlist at both hops | web and buyer suites | production, `clientKey` → 400 |
| I-4 | The demo buyer does not trust forwarded headers | `trustProxy: false` in `apps/demo-buyer/src/app.ts`, correct because it has one peer | — | architecture TB-3 |
| I-5 | Rate limits apply to the real caller boundary | web limiter per visitor, buyer limiter per `clientKey`, facilitator `TRUST_PROXY=2` | web suite | production: laptop exhausted 3, a Railway container passed |

## Facilitator

| # | Invariant | Code | Test | Evidence |
| --- | --- | --- | --- | --- |
| F-1 | The facilitator is never the payer | upstream `@x402/stellar` verify, plus our config lock | upstream suite | E-06a |
| F-2 | The facilitator never appears as a signer in client auth entries | upstream verify | upstream suite | E-06a |
| F-3 | The buyer's XLM delta is zero under fee sponsorship | `ExactStellarScheme` sponsorship | — | HOSTED-E-07: buyer XLM delta exactly 0, facilitator −0.0022973 matching `fee_charged` to the stroop |
| F-4 | Settlement is submitted by our facilitator, not another | verified by reading `source_account` from chain | — | HOSTED-E-07 |
| F-5 | Settle concurrency and rate are bounded | `apps/facilitator/src/limits.ts` | facilitator suite | — |
| F-6 | The network is locked to testnet | `assertNetworkLock()` / `DEPLOYMENT_NETWORK_LOCK` | facilitator suite | — |

## Catalog

| # | Invariant | Code | Test | Evidence |
| --- | --- | --- | --- | --- |
| C-1 | A different `payTo` cannot overwrite a listing | `OWNERSHIP_CONFLICT` in `packages/catalog/src/store.ts` | catalog suite | E-11 |
| C-2 | `domain-verified` outranks `tofu`; `domain-mismatch` outranks both | `strongerBinding()` | `test/ownership.test.ts` precedence group | HOSTED-E-08 |
| C-3 | A settlement write cannot demote a verified listing | same, and every settlement arrives as `tofu` | "a later settlement cannot demote a verified listing" | HOSTED-E-08 |
| C-4 | An explicit contradiction is visible, never hidden | `domain-mismatch` state and refusal styling in the UI | web suite | **HOSTED-E-08 negative acceptance** |
| C-5 | Silence is not denial | `isContradiction()`; 404, timeout, malformed and not-declared all leave the binding alone | four cases in the ownership suite | HOSTED-E-08 |
| C-6 | Ownership verification never affects settlement | enrichment after insertion, never awaited | — | HOSTED-E-08: the 402 kept quoting the real payee throughout the mismatch |

## SSRF

| # | Invariant | Code | Test | Evidence |
| --- | --- | --- | --- | --- |
| S-1 | No private, loopback, link-local, CGNAT or unique-local address is contacted | `isForbiddenAddress` in `packages/catalog/src/ownership/verifier.ts` | 14 address cases, each asserting **no request was attempted** | — |
| S-2 | The checked address is the connected address | `pinnedLookup`, both call shapes | "answers a pinned lookup in both shapes node uses" | the bug this fixed is in HOSTED-E-08 |
| S-3 | Zero redirects are followed | 3xx → `REDIRECT_REFUSED` | four status codes | — |
| S-4 | HTTPS and port 443 only | checked before DNS is even asked | two cases, asserting `resolve` was not called | — |
| S-5 | The body is capped while streaming | 64 KB, declared and streamed | two cases | — |
| S-6 | No upstream error text is persisted or returned | closed reason set of ten | "keeps upstream text out of what it returns" | — |

## Secrets

| # | Invariant | Code | Test | Evidence |
| --- | --- | --- | --- | --- |
| K-1 | The browser receives no private key | no secret is ever sent to the client | web suite asserts no `S…` strkey in `app.js` | production check |
| K-2 | x402seek-web holds no key at all | it has no secret variables | — | `deployment-and-secrets.md` |
| K-3 | The buyer and facilitator secrets are different, in different services | separate Railway services | — | `deployment-and-secrets.md` |
| K-4 | Metrics tokens are compared in constant time | `timingSafeEqual` in both services | nine wrong shapes in the buyer suite | FINDINGS SR-02 |
| K-5 | A secret never appears in a log record | `redact()` names each secret field explicitly | "appears in no log record" | — |
| K-6 | No raw address is stored or reported | buckets hashed to 16 hex characters before storage | "stores a hashed bucket, never an address" | — |
