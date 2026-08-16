# Reviewer runbook

Everything here is safe to run unless it carries a **⚠ SPENDS MONEY** banner.
Nothing below that banner is required to review this system.

Read this section before running anything:

> **SEC-OPS-01.** A health, readiness, propagation, rate-limit or kill-switch
> check against an economic service must use a request that cannot reach signing
> or settlement.
>
> This exists because the same operator mistake was made twice on this system:
> a loop polling for a state change used a payable body, and the first request
> paid before the state change arrived. Both incidents are recorded in
> `FINDINGS-2026-08-16.md`. No control failed either time, which is exactly why
> it needed a rule.

## Part 1 — Non-spending checks

These cannot move funds. Run them freely.

### 1.1 Liveness and readiness

```
curl -s https://x402seek.xyz/health
curl -s https://facilitator.testnet.x402seek.xyz/health
curl -s https://demo-api.testnet.x402seek.xyz/health
curl -s https://demo-api.testnet.x402seek.xyz/ready
```

Expect 200. The seller's `/health` reports `ready` and the facilitator's state;
`/ready` returns 503 when the facilitator has never answered, which is liveness
and readiness kept apart on purpose.

The demo buyer's `/health` and `/ready` are **not reachable from the internet**.
That is the control, not an omission. Confirm it:

```
curl -s -o /dev/null -w '%{http_code}\n' https://demo-buyer.testnet.x402seek.xyz/health
```

Expect a connection failure. The hostname does not resolve.

### 1.2 The safe probe for the payment endpoint

**This is the probe to use whenever you want to know whether the demo is up,
disabled, deployed or rate-limited.**

```
curl -s -X POST https://x402seek.xyz/api/live/demo-payment \
  -H 'content-type: application/json' -d '{"nope":1}'
```

Expect **400 `INVALID_REQUEST`**. An unknown property is refused by the body
allowlist before the rate limiter and long before anything is signed. Verified in
production.

Any of `{"payTo":"x"}`, `[1,2]`, `{"text":123}` behaves the same, and each also
demonstrates that a caller controls no payment term.

The equivalent for the facilitator:

```
curl -s -X POST https://facilitator.testnet.x402seek.xyz/settle \
  -H 'content-type: application/json' -d '{}'
```

Expect 400.

### 1.3 Discovery, and the abstention that matters

```
curl -s "https://x402seek.xyz/api/live/search?query=I%20need%20something%20that%20can%20condense%20a%20long%20passage%20of%20text"
curl -s "https://x402seek.xyz/api/live/search?query=book%20me%20a%20dentist%20appointment"
```

The first returns `Text Summarizer`. The second returns no resources and
`abstained.reason = BELOW_RELEVANCE_THRESHOLD`. Abstention is the product claim
worth checking, so also read the recorded number:

```
curl -s "https://x402seek.xyz/api/discovery/search?query=book%20me%20a%20dentist%20appointment"
```

`topScore` 0.026828 against a threshold of 0.22. Reproducible: the frozen catalog
and the same engine.

### 1.4 Live 402 inspection

```
R=$(curl -s https://x402seek.xyz/api/live/resources | jq -r '.items[0].resource')
curl -s "https://x402seek.xyz/api/live/inspect?resource=$(printf %s "$R" | jq -sRr @uri)"
```

Returns the seller's current terms, decoded from the `payment-required` header.
Nothing is paid to read this, and no `x-payment` header is ever sent.

Then confirm the proxy cannot be pointed elsewhere:

```
curl -s "https://x402seek.xyz/api/live/inspect?resource=https://evil.example/x"
```

Refused: the catalog is the allowlist.

### 1.5 Domain ownership

```
curl -s https://demo-api.testnet.x402seek.xyz/.well-known/x402
curl -s https://facilitator.testnet.x402seek.xyz/discovery/resources | jq '.items[0].ownershipBinding'
```

The document declares one resource, one `payTo`, one network. The listing reads
`domain-verified`.

The mismatch case cannot be reproduced from outside, because it requires changing
what the origin declares. It was demonstrated against the live deployment and is
recorded in `../hosted/HOSTED-E-08-domain-binding.md`: `domain-verified` →
`domain-mismatch` → `domain-verified`, with the 402 quoting the real payee
throughout. That negative case is the evidence worth reading; the positive one
alone would prove much less.

### 1.6 The caller controls no payment term

```
for f in payTo amount asset network resource facilitator buyer terms clientKey url; do
  printf "%-12s " "$f"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://x402seek.xyz/api/live/demo-payment \
    -H 'content-type: application/json' -d "{\"$f\":\"x\"}"
done
```

All 400. None of these reaches the demo buyer, let alone a signer.

### 1.7 No secret on any public surface

```
curl -s https://x402seek.xyz/app.js | grep -cE 'S[A-Z2-7]{55}|DEMO_BUYER_SECRET|METRICS_TOKEN'
```

Expect 0.

### 1.8 On-chain verification, using transactions that already exist

Do not create a payment to verify settlement. Three already exist:

| Transaction | What it shows |
| --- | --- |
| `1ef1a6bb8d6d8b2f6c1a003d73ed13594c683f38095d1b124bae8c3822ccc4f6` | the first browser-triggered settlement, HOSTED-E-07 |
| `cbd40ab0afff1a92773f58994d43a326d44be33b0c836c12cb1760db4b4f8752` | the hosted client settlement, HOSTED-E-02 |
| `4c1bd724e7f5edb757c7ec077f9984f6b7c31029e4f69d9355ef02500459cd2d` | the buyer's USDC trustline |

```
curl -s https://horizon-testnet.stellar.org/transactions/1ef1a6bb8d6d8b2f6c1a003d73ed13594c683f38095d1b124bae8c3822ccc4f6 \
  | jq '{successful, source_account, fee_charged}'
```

`source_account` is `GDX6H6PL…`, our facilitator: the check that proves *we*
settled it rather than someone else. `fee_charged` is 22973 stroops and matches
the facilitator's XLM delta to the stroop, while the buyer's XLM delta is exactly
zero. That triple is fee sponsorship, demonstrated rather than asserted.

### 1.9 Option D: the demo is additive

Everything in 1.3, 1.4 and 1.5 keeps working when the demo payment is
unavailable. Demonstrated in production with `DEMO_ENABLED=false` and recorded in
`../hosted/FREEZE-browser-demo-payment.md`. If you want to see the refusal, use
the probe in 1.2 rather than a payable body.

### 1.10 Rate-limit boundary

Sending four safe probes from 1.2 does **not** exercise the limiter, because a
malformed body is refused before it. That is deliberate: a broken client cannot
lock out a working one.

Observing the limit therefore requires either a payable request or the demo
switched off. The switched-off route is how it was verified here, and the result
is in SR-01's remediation: one machine exhausted its three and was refused, a
different source address went straight through.

---

## Part 2 — Economic checks

### ⚠ SPENDS MONEY

**Do not run these to check availability, deployment or configuration.** Use
Part 1. These exist only if you specifically want to observe a settlement, and
0.001 USDC of the demo float is consumed each time.

```
curl -s -X POST https://x402seek.xyz/api/live/demo-payment \
  -H 'content-type: application/json' \
  -d '{"requestId":"'"$(uuidgen)"'","text":"a reviewer ran the runbook"}'
```

Costs: 0.001 USDC from the demo buyer, ~0.0022973 XLM sponsored by the
facilitator. Bounded by 150 payments and 0.15 USDC per UTC day.

Before running it, consider that §1.8 already lets you verify a real settlement
end to end, on chain, for nothing.
