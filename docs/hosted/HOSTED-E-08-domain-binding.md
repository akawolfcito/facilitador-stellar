# HOSTED-E-08 — `.well-known/x402` domain binding

2026-08-16. Core `f22bbcf`, web `6d5b307`.
SCF implementation and proposal freeze remains `762c6e6`; `docs/scf/` untouched.

The hosted catalog moved a listing from trust-on-first-use to domain-verified,
then refused a real contradiction, then recovered. No payment was made at any
point.

## What this proves, and what it does not

**Domain control proof.** The controller of the resource's HTTPS origin declares
that this resource may be catalogued against this `payTo` on this network.

It is **not** wallet ownership proof, not wallet authentication, not seller
authenticity, and not payment validity. Nothing in the document is signed by the
`payTo` key, so an origin can name an address it does not hold. The live 402
remains the payment authority. Those sentences are load-bearing and appear in the
type, the verifier, the UI tooltip and here in the same words.

## The schema is ours

`/.well-known/x402` with `version: 1` and `kind: "resource-ownership"` is an
**x402Seek implementation convention**, not an x402 standard.

Checked upstream at `x402-foundation/x402` `167a828e` on 2026-08-16: no merged
`.well-known/x402` exists. Two open proposals touch the path and both shaped the
design.

- **#2979** (open, 2026-08-10) proposes `/.well-known/x402` as a *facilitator*
  manifest, with a `kind` discriminator.
- **#2646** (draft, "DO NOT MERGE") proposes `/.well-known/x402.json` as a
  per-origin resource manifest.

Neither covers ownership authorisation. Rather than claim the path outright, this
document carries a `kind` of its own and the reader ignores anything it does not
recognise, so a host serving #2979's manifest yields `RESOURCE_NOT_DECLARED`
rather than a false match. A test asserts exactly that.

## Authoritative origin

The resource's own origin, exactly. No walk to a parent domain, no apex
fallback, no redirects followed, HTTPS only, port 443 only.

```
resource   https://demo-api.testnet.x402seek.xyz/summarize
lookup     https://demo-api.testnet.x402seek.xyz/.well-known/x402
```

MCP resources have no HTTPS origin and stay `tofu`. Stated as a limitation.

## The document, as served

`HTTP/2 200`, `content-type: application/json; charset=utf-8`,
`cache-control: public, max-age=300`.

```json
{
  "version": 1,
  "kind": "resource-ownership",
  "resources": [
    {
      "resource": "https://demo-api.testnet.x402seek.xyz/summarize",
      "payTo": "GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK",
      "network": "stellar:testnet"
    }
  ]
}
```

## Acceptance

Read from the hosted facilitator's `/discovery/resources`, and from the catalog
database inside the container.

| Step | Document declares | Catalog state | Payment plane |
| --- | --- | --- | --- |
| Before | correct `payTo` | `tofu` | 402, unchanged |
| **Positive** | correct `payTo` | **`domain-verified`** | 402, unchanged |
| **Negative** | a different `payTo` | **`domain-mismatch`** | 402, unchanged |
| **Restore** | correct `payTo` | **`domain-verified`** | 402, unchanged |

Each transition happened on the **first** discovery read after the TTL was
cleared. No payment was made to trigger any of them, and the demo buyer's USDC
balance was 4.9970000 before and after the whole exercise.

**During the mismatch window the 402 kept quoting the real payee.** Only the
origin's claim moved; `config.payTo` still governed the payment. Verified while
the mismatch was live: the seller answered `402` and the header decoded to
`GD45744YX7ELZEGGCV2ISXUHXA6LBDJR6THTTMP2EZ5JXMTE5K63XBRK`, not the address the
document was declaring.

The negative case is the one that matters. A verification feature is not
demonstrated by verifying something; it is demonstrated by refusing a real
contradiction, which is why it was run against the live deployment rather than
only in tests.

## Public UI

```
Text Summarizer
  Domain verified          (tooltip: domain control, not wallet proof)
  Payable
  Price      0.001 USDC (testnet)
  Settles on Stellar Testnet
```

`Ownership verified` was retired as a label. It was defensible while
trust-on-first-use was the only binding; it stopped being defensible once
`domain-verified` gave that phrase a stronger meaning in the same list. TOFU now
reads `Ownership: first use`, and `domain-mismatch` uses the refusal styling.

## The defect this milestone found

Verification ran, the row was written, the TTL was set, and the result was
`WELL_KNOWN_INVALID` against a document that was valid and being served
correctly. The catalog stayed `tofu` and nothing looked broken.

The cause was the custom DNS `lookup` used to pin the validated address against
rebinding. Node calls a lookup in two shapes: with `options.all` set it wants an
array of `{address, family}`; otherwise it wants `(err, address, family)`
positionally. Ours answered only the second, and the first produced
`Invalid IP address: undefined` from inside `net.connect`. Not a type error,
because Node's `LookupFunction` type does not express the distinction.

Found by the hosted acceptance, which is what a hosted acceptance is for. Fixed
in `66d1d69`, with `pinnedLookup` named and tested against all three call shapes
on v4 and v6.

## Controls active

SSRF: HTTPS only, port 443 only, DNS resolved and every returned address checked
against loopback, RFC1918, link-local including the metadata address, CGNAT,
unspecified, IPv6 unique-local and link-local, and IPv4-mapped forms of all of
them. The validated address is pinned into the connection. Zero redirects
followed. Five second timeout, 64 KB streamed cap, identity encoding only,
`application/json` required.

Fourteen address cases are asserted, and each asserts that **no request was
attempted**, not that one failed. A mutation removing the address check fails all
fourteen.

Failure semantics: a closed set of ten reasons. No upstream error string is ever
persisted or returned.

Silence is not denial: a 404, a timeout, malformed JSON, or a document that never
mentions the resource all leave the binding alone. Only a document naming a
different payee or network is a contradiction.

## Regression

Nothing else moved. Live discovery answers, abstention refuses at 0.026828
against a 0.22 threshold, the live 402 reads, the recorded evidence stands, and
the frozen browser demo payment still refuses every payment-shaped field with a
400 and spent nothing.

Verification is enrichment after catalog insertion and is never awaited on the
settlement path. A payment cannot fail because a seller's web server is down.
