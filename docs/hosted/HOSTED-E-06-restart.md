# HOSTED-E-06 — Persistence and rehydration across a restart

**Claim.** A redeploy of the hosted facilitator loses neither the catalog, nor
the ownership binding, nor the ability to search — and needs no new payment and
no manual intervention to recover any of it.

## What was done

The facilitator service was redeployed on Railway, keeping the same `/data`
volume. Nothing else was touched: the seller was left running, no settlement was
made, and no maintenance command was issued.

`/ready` returned 502 while the container was replaced, then 200 within about
30 seconds.

## What survived

`GET /discovery/resources`, immediately after readiness:

```
items          1
resource       https://demo-api.testnet.x402seek.xyz/summarize
ownerPayTo     GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK
ownershipBinding  tofu
lastSettlementTx  cbd40ab0afff1a92773f58994d43a326d44be33b0c836c12cb1760db4b4f8752
```

`GET /discovery/search?query=I need something that can condense a long passage of text`:

```
abstained  no
top        Text Summarizer
```

`/health`: `{"ready":true,"discovery":{"status":"ready","indexed":1},"catalog":1}`

No new settlement. No manual `search.sync()`. No catalog insertion.

## Why both halves matter

This validates two separate things that only fail together in production.

**Persistent state.** The catalog and its trust-on-first-use binding live on the
mounted volume. On an ephemeral filesystem both would be gone, and a different
`payTo` could then claim the canonical key — an availability problem that is
also a security one.

**Boot rehydration.** The derived vector index is not persisted state; it is
rebuilt from the catalog at startup. Before this branch, nothing rebuilt it: the
production entry point constructed a `SearchEngine` and never synced it, so
every listing scored 0, and 0 is below the abstention threshold. A restarted
facilitator would have refused every query while insisting it was healthy —
until some unrelated payment happened to trigger a sync.

The restart evidence in the frozen submission (E-16) is genuine, but the
rehydration in it belongs to the E2E harness, which calls
`restarted.search.sync()` explicitly. Nothing in the application did. That gap
only becomes visible when the process is *operated* rather than tested, which is
what this evidence is for.
