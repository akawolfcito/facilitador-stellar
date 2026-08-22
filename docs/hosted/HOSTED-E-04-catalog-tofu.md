# HOSTED-E-04 — Automatic cataloging and the ownership binding

**Claim.** The paid resource entered the hosted catalog because a payment
settled, with no registration step and no manual insertion.

Before the settlement in [HOSTED-E-02](./HOSTED-E-02-settlement.md), the hosted
catalog was empty — `"catalog":0` in `/health`. Afterwards, without any other
action:

`GET https://facilitator.testnet.x402seek.xyz/discovery/resources`

```
items          1
resource       https://demo-api.testnet.x402seek.xyz/summarize
serviceName    Text Summarizer
payTo          GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK
ownerPayTo     GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK
ownershipBinding  tofu
network        stellar:testnet
scheme         exact
asset          CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
amount         10000
lastSettlementTx  cbd40ab0afff1a92773f58994d43a326d44be33b0c836c12cb1760db4b4f8752
```

There is no registration endpoint to have used. Cataloging happens in the
facilitator's `onAfterSettle` hook, on a settlement result that is already
final, so a listing cannot exist without a payment behind it — and the listing
carries that payment's hash as provenance.

## The canonical URL is configuration, not inference

The seller advertises `PUBLIC_BASE_URL` explicitly rather than letting the
middleware derive the origin from the request. Behind a proxy the derived value
would be the internal address, and the facilitator keys its catalog on exactly
this string. A wrong value would not merely produce an unreachable listing: it
would bind ownership to a canonical key nobody intended. The seller refuses to
boot without it.

## Why the binding needs persistent storage

`ownershipBinding: "tofu"` means trust on first use: the canonical key is bound
to the `payTo` observed at first settlement, and later writes from a different
recipient are rejected with `OWNERSHIP_CONFLICT`.

That binding lives in the SQLite catalog. On an ephemeral filesystem it would be
discarded on every redeploy, and the loss is not cosmetic — after it, a
different `payTo` could claim a key that was already bound. The Railway volume
at `/data` exists for this reason, and [HOSTED-E-06](./HOSTED-E-06-restart.md)
is where the binding is shown surviving a restart.

x402 proves who received a payment. It proves nothing about who controls a URL,
and every listing says so on its face.
