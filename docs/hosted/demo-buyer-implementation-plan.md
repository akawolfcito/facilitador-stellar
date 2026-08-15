# Demo buyer: implementation plan

**Status: plan only. Nothing here is implemented.**
Date: 2026-08-15. Written against `feat/hosted-testnet-facilitator` @ `6f65876`.
Approved architecture: option C of `browser-payment-architecture.md`.

The thing being built is **not** an endpoint that pays x402. It is a button that
runs exactly one demo and nothing else. Every decision below follows from that
sentence, and any change that widens it invalidates the risk analysis.

Option D stays the permanent floor. When the budget is spent, the balance is
below the floor, or the demo buyer is switched off, x402Seek is still whole:
live discovery answers, abstention still refuses, the live 402 is still
readable, the recorded evidence is still there. The button is an addition to
that, never a dependency of it.

---

## 1. What the codebase already gives us

Four facts, read out of the code, that shape the design.

**The buyer never calls the facilitator.** In `hosted-client.ts` it is the
*seller* that calls `/verify` and `/settle`; the buyer reads a 402, signs, and
retries with a payment header. The demo buyer therefore needs no facilitator
credentials and no facilitator URL beyond what the seller already uses. Its
blast radius shrinks accordingly.

**The signing boundary can be locked, not just checked.** `x402Client` accepts
`policies`, a list of filters applied to the `accepts` array before anything is
signed. `apps/mcp-discovery/src/tools.ts` already uses one to enforce a price
ceiling, and calls it defence in depth in as many words. This is the strongest
control available here: a policy that filters `accepts` down to the single
option matching every invariant means the stock client *cannot* sign anything
else, even if a pre-flight check elsewhere has a bug. If the filter returns
empty, the client refuses on its own.

**`better-sqlite3` is already in the runtime licence graph**, via
`packages/catalog`. The spend ledger adds no dependency.

**`apps/facilitator/src/limits.ts` and `metrics.ts` are the patterns to copy**:
fixed-window limiter, `clientBucket()` with IPv6 collapsed to a /64,
`InflightLimiter`, closed reason set, `ALERT_GUIDANCE`. Copy the shapes; do not
import across app boundaries.

## 2. Service

`apps/demo-buyer/` in the core repo. Its own Railway service, its own secret,
its own volume. It shares nothing with the facilitator signer, the seller
identity, or x402seek-web's runtime.

```
apps/demo-buyer/
  src/config.ts        env parsing, network lock, invariant constants
  src/invariants.ts    the one payable thing, and the policy that enforces it
  src/ledger.ts        SQLite spend ledger and idempotency records
  src/limits.ts        per-IP and global fixed-window limiter, inflight cap
  src/metrics.ts       counters, reason set, alert guidance
  src/pay.ts           live 402 read, validation, sign, retry, receipt decode
  src/app.ts           Fastify: POST /demo-payment, GET /health, GET /ready
  src/index.ts         entry point, signal handling
  Dockerfile           copied from apps/demo-seller, plus the setpriv entrypoint
  docker-entrypoint.sh volume ownership, privilege drop
  railway.toml
  test/*.test.ts
```

## 3. API

### `POST /demo-payment`

Request body, at most 2 KB:

```json
{ "requestId": "8f14e45f-ceea-467a-9e4f-9a1b2c3d4e5f", "text": "optional, <= 500 chars" }
```

`requestId` is a client-generated UUIDv4 used only for idempotency. `text` is
the product input the demo resource takes; it is plain text, length-capped,
never interpreted as a URL, never rendered as HTML, and passed to exactly one
hard-coded resource. Both fields are optional; omitting `text` uses a fixed
default sentence.

**There is no other input.** No `payTo`, `amount`, `asset`, `network`,
`facilitator`, `resource`, `seller`, `terms`, `buyer`, or signing material. Any
unknown property in the body is a 400, not a silently ignored field, so a future
regression that starts reading one fails loudly.

Success, `200`:

```json
{
  "status": "settled",
  "payer": "x402seek-demo-buyer",
  "amount": "10000",
  "amountDisplay": "0.001 USDC",
  "network": "stellar:testnet",
  "transaction": "cbd40ab0…",
  "explorer": "https://stellar.expert/explorer/testnet/tx/cbd40ab0…",
  "seller": { "status": 200, "summary": "the quick brown fox jumped over the lazy… (9 words)" },
  "budget": { "remainingToday": 148 }
}
```

Failures return `{ "status": "refused", "reason": "<CLOSED_SET>", "detail": "<safe text>" }`
with the status codes in §9. `detail` is written by us, never an upstream error
string passed through.

### `GET /health`, `GET /ready`

Same split the seller now uses. `/health` is liveness and stays 200. `/ready`
is 503 until the buyer account is funded above the floor, the ledger is open,
and the seller's live 402 has validated at least once.

### `GET /internal/metrics`

Token-guarded, exactly as the facilitator does it. Never public.

## 4. Live 402 validation

Two layers, and the second is the one that matters.

**Layer 1, pre-flight.** `GET https://demo-api.testnet.x402seek.xyz/summarize`
unpaid, decode the base64 `payment-required` header, and require *all* of:

| Field | Required value |
| --- | --- |
| `network` | `stellar:testnet` |
| `scheme` | `exact` |
| `asset` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| `payTo` | `GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK` |
| `amount` | exactly `10000` for the current demo; `> 10000` is always refused |
| resource host | `demo-api.testnet.x402seek.xyz` |
| resource path | `/summarize` |
| scheme of URL | `https` |

Any mismatch stops before signing, spends nothing, and returns
`LIVE_TERMS_CHANGED`. The catalog is never consulted for any of this.

**Layer 2, the signing policy.** The same predicate is installed as an
`x402Client` policy, so `wrapFetchWithPayment` re-reading the 402 cannot end up
signing different terms than the ones layer 1 approved. If the seller's terms
change between the two reads, the policy filters `accepts` to empty and the
client refuses. This closes the race that layer 1 alone would leave open, and it
is why validation is not merely a check.

`amount` is compared as `BigInt`, never as a number or a string.

## 5. Budgets

Chosen for a reviewer demo, not for public traffic. The payment itself is
worthless testnet USDC; what is actually being conserved is the facilitator's
sponsored XLM (~0.0022973 XLM per settlement, measured) and the demo buyer's
float, which a human has to top up.

| Control | Value | Why this value |
| --- | --- | --- |
| Per-IP | **3 per hour**, per /64 | A reviewer wants one. Two spare covers a refusal they want to retry after reading the message. Three is not enough to script anything interesting. |
| Global | **5 per minute** | The facilitator's own settle limiter is 10/min. Staying at half of it means the demo can never be the reason a real settlement is throttled. |
| Daily count | **150 payments** | Comfortably more than a review window will ever use, and small enough that a full day of abuse is unremarkable. |
| Daily spend | **0.15 USDC** (1 500 000 base units) | The same bound expressed in money. Both are enforced; if the demo price ever changes, the spend cap still binds. |
| Buyer float | **5 USDC**, plus ~5 XLM for the account reserve | 33 days at the full daily cap, realistically months. Fees are sponsored, so the XLM is only to let the account exist. |
| Balance floor | **0.5 USDC** | Refuse below it and alert. Leaves three days of runway to top up rather than discovering it empty. |
| Concurrency | **1**, with an 8 s wait for the slot | One account, sequential Soroban auth entries. Concurrent signing invites nonce and sequence conflicts. A short wait keeps the common case pleasant; past it, 429. |

Exhausted budget returns **429** with `DEMO_BUDGET_EXHAUSTED`, before any
signing and before any call to the seller or facilitator.

## 6. Spend ledger

SQLite via `better-sqlite3` on a Railway volume at `/data`, the same shape and
the same `setpriv` entrypoint the facilitator already uses. Not a general
accounting system: two tables and no history beyond what the controls need.

```sql
CREATE TABLE IF NOT EXISTS day_spend (
  day             TEXT PRIMARY KEY,        -- UTC yyyy-mm-dd
  committed_units INTEGER NOT NULL DEFAULT 0,
  payments        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS requests (
  request_id   TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  ip_bucket    TEXT NOT NULL,              -- fingerprint, never the raw address
  status       TEXT NOT NULL,              -- reserved | settled | refused | uncertain
  amount_units INTEGER,
  tx_hash      TEXT,
  seller_status INTEGER
);
```

**Reserve, then commit.** The day's counter is incremented and the request row
written as `reserved` *before* anything is signed, inside one transaction. A
crash between signing and receipt therefore cannot cause an over-spend on
restart. A refusal that happens before signing releases the reservation. A
failure after signing keeps it, because the money may well be gone.

Rows are pruned after 48 hours; `day_spend` keeps 30 days for the metrics
endpoint and nothing longer.

## 7. Idempotency

Window: **10 minutes**, keyed on `requestId`.

- A `requestId` seen within the window returns the stored result verbatim and
  pays nothing.
- Outside the window a fresh payment is allowed, so a reviewer coming back an
  hour later is not permanently deduplicated.
- A missing or malformed `requestId` falls back to a per-IP-bucket guard: a
  second request from the same bucket within **30 seconds** returns the previous
  result rather than paying. This is what actually catches a double-click,
  because a double-click is exactly the case where the client may not have
  rotated its id.

## 8. Ambiguous settlement

If the paid retry throws, or the receipt decodes without a transaction hash,
after the payment was signed:

1. The reservation stays committed.
2. The row is marked `uncertain` with whatever partial evidence exists.
3. The response is **502** `SETTLEMENT_STATE_UNCERTAIN`.
4. **Nothing is retried automatically.** Not the settlement, not the paid
   request, not the signing.
5. The metric `demo_payment_uncertain` increments, and `ALERT_GUIDANCE` says a
   human should check Horizon for the buyer's recent operations before doing
   anything.

Automatic retry here is how one uncertain payment becomes two certain ones.

## 9. Failure states

Every one is a closed-set reason with copy we wrote. Raw upstream errors are
logged, never returned.

| Reason | HTTP | Visitor sees |
| --- | --- | --- |
| `DEMO_BUDGET_EXHAUSTED` | 429 | Today's demo budget is spent. Live discovery and the recorded evidence still work. |
| `RATE_LIMITED` | 429 | Too many demo payments from here. Try again shortly. |
| `DEMO_IN_FLIGHT` | 429 | Another demo payment is settling. Try again in a moment. |
| `LIVE_TERMS_CHANGED` | 409 | The seller's live terms are not the ones this demo is allowed to pay. Nothing was signed. |
| `SELLER_UNAVAILABLE` | 503 | The hosted seller did not answer. Nothing was signed. |
| `FACILITATOR_UNAVAILABLE` | 503 | Settlement could not be reached. Nothing was signed. |
| `SETTLEMENT_REJECTED` | 502 | The payment was refused on chain. Nothing was delivered. |
| `SETTLEMENT_STATE_UNCERTAIN` | 502 | The outcome is unconfirmed. This is being checked; no retry was made. |
| `BUYER_BALANCE_LOW` | 503 | The demo account needs topping up. |
| `DEMO_DISABLED` | 503 | Demo payments are off right now. |
| `INVALID_REQUEST` | 400 | Malformed request. |

Every one of these leaves the page in option D, which is a working product.

## 10. Buyer secret

A **fresh** testnet account, generated for this purpose. Not the facilitator
signer, not the buyer from the recorded evidence runs (`HOSTED-E-01…06`), not
any developer wallet. Reusing the evidence buyer would also corrupt the ledger
history that evidence depends on.

`DEMO_BUYER_SECRET` lives only in Railway's variables for this one service.
It is never logged, never returned, never in x402seek-web, never committed. The
service's `redact()` names each secret field explicitly, as
`apps/facilitator/src/config.ts` already does, so a new field is opaque by
default rather than leaked by omission. A test asserts the secret string appears
in no response body and no log record.

Only the **public** address is recorded, in an operator note outside the frozen
proposal artifacts.

## 11. Observability

`GET /internal/metrics`, token-guarded, never public. Counters:
requested, rate-limited, budget-rejected, live-402-validation-failed,
seller-unavailable, settle-failed, settled, uncertain. Gauges: USDC spent today,
payments today, buyer USDC balance, seconds since last successful settlement,
last transaction hash.

No user analytics. No raw IP anywhere — the limiter's `bucketFingerprint()`
already hashes buckets, and that is what the ledger stores.

## 12. Web proxy

`POST /api/live/demo-payment` in x402seek-web. **This is a bounded
demo-payment proxy, not a read-only route.** It causes an economic side effect
and its tests should say so.

- Calls one hard-coded upstream: the demo-buyer service. No caller-supplied URL,
  ever.
- Forwards only `requestId` and `text`, both re-validated on arrival. Nothing
  else crosses.
- Body limit 2 KB, request timeout 20 s.
- Its own per-IP limiter in front of the service's, so obvious abuse is
  refused before it costs an upstream hop.
- Holds no secret. If the transport needs a shared token (see §13), it lives in
  the web service's Railway variables and never reaches the browser.

This breaks the current invariant that x402seek-web registers only GET handlers,
and that test must change deliberately: assert that **exactly one** non-GET
route exists and that it is this one. A count, not a removal.

## 13. Deployment

New Railway service `x402seek-demo-buyer-testnet`, one instance, one small
volume at `/data`.

**Public domain: probably not needed, and preferably not created.** Railway's
private networking resolves `<service>.railway.internal` over IPv6 *within a
project*. If x402seek-web sits in the same Railway project as the facilitator
and the seller, the demo buyer needs no public hostname at all, which removes
the entire class of "someone found the service and called it directly".

**This is the one fact to confirm before writing code**, because it changes the
transport:

- Same project → private networking, no public domain, no shared token.
- Different projects → a public domain `demo-buyer.testnet.x402seek.xyz` plus a
  shared `X-Demo-Proxy-Token` required on every request, no CORS headers at all
  so a browser cannot call it directly, and the per-IP limiter treated as the
  real boundary rather than a convenience.

## 14. Security tests

Twenty-four, in six groups. All deterministic, all with stubbed upstreams.

**The caller controls nothing (7)** — a body supplying `payTo`, `amount`,
`asset`, `network`, `facilitator`, `resource`, or a buyer address is rejected as
`INVALID_REQUEST`, and in each case the value never reaches the signer.

**The live 402 is authority (5)** — mismatched amount, raised amount, wrong
`payTo`, wrong asset, and `stellar:pubnet` each block signing. Asserted at both
layers: the pre-flight refuses, *and* the signing policy filters `accepts` to
empty when handed the same bad terms directly.

**Budgets hold (4)** — per-IP limit, global limit, daily spend cap, and a ledger
that still refuses after the process is restarted with the same volume.

**Concurrency and idempotency (3)** — two simultaneous requests produce one
payment; a repeated `requestId` inside the window pays once and returns the
stored result; the same `requestId` after the window is allowed to pay again.

**Failure behaviour (3)** — an ambiguous settlement never auto-retries and
returns `SETTLEMENT_STATE_UNCERTAIN`; the balance floor refuses before signing;
no upstream error string appears in any response body.

**The secret stays put (2)** — it appears in no response and no log record; the
`/health`, `/ready` and metrics payloads are asserted against a snapshot that
cannot contain it.

## 15. Keeping option A open

The invariant predicate in `invariants.ts` takes decoded 402 terms and returns
whether they are the payable demo. It takes no signer and no secret. A future
"connect your own wallet" path consumes the same predicate against the same live
402, differing only in which `ClientStellarSigner` is handed to
`ExactStellarScheme`. Nothing in this plan makes that harder, and the shared
predicate makes it easier.

## 16. Estimates

**New files:** ~13 (9 source, 1 Dockerfile, 1 entrypoint, 1 railway.toml, plus
tests), 2 modified in x402seek-web, 1 modified test there.

**New dependencies: NONE.** `better-sqlite3`, `fastify`, `@x402/core`,
`@x402/fetch`, `@x402/stellar` and `@stellar/stellar-sdk` are all already in the
runtime graph. The licence gate should stay green without a new entry.

**New Railway resources:** one service, one volume, one secret, optionally one
domain (see §13).

**Risk: MEDIUM.** Not because any single piece is hard, but because it is the
first component in the system that can spend money in response to an anonymous
request. The controls are what make it tractable, and the two-layer signing
boundary is the one that carries the most weight.

**SCF freeze: unchanged.** `762c6e6` remains the implementation and proposal
freeze. **Proposal: unchanged.** Nothing here modifies a frozen artifact.

## 17. Open question for the user

One decision is not mine: whether the demo buyer's daily budget should reset at
UTC midnight or roll as a 24-hour window. UTC midnight is simpler to reason
about and easier to explain in the UI; a rolling window is fairer to a reviewer
who arrives just after someone exhausted it. The plan assumes UTC midnight
because it is the one an operator can predict.
