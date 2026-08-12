# Catalog Ownership Model

**The question this document answers:** what evidence allows this facilitator to
conclude that seller X is authorized to create or update canonical resource Y?

Written before the implementation, because the answer constrains the schema.

---

## 1. The short answer

**None, for URL ownership.** x402 does not prove that the recipient of a payment
controls the URL the payment was made against. Anything this facilitator claims
beyond payment-recipient authenticity would be a claim the protocol does not
support.

What we do instead: bind each canonical key to the payment recipient observed at
first successful settlement, and refuse writes from any other recipient
thereafter. Trust on first use, with the trust anchor being an on-chain fact
rather than a client assertion.

## 2. Two things that are easy to conflate

| | Payment recipient authenticity | Resource URL ownership |
|---|---|---|
| **Claim** | Value provably moved to address `payTo` on network N for asset A | The party at `payTo` controls `https://host/path` |
| **Evidence** | A Soroban auth entry signed by the buyer authorizing exactly this contract, amount and destination, submitted by us, included in a ledger, confirmed by RPC | **None** |
| **Who can forge it** | Nobody. Tampering fails signature verification; the ledger is the record | Any client, freely |
| **Strength** | Cryptographic + on-chain finality | Zero |

The asymmetry has a structural cause. In x402 v2 the resource block travels
**through the client**: the seller puts it in the 402, the client copies it into
the `PaymentPayload`, and the facilitator reads it there. The facilitator never
contacts the resource URL and receives no signature over it. So `resource.url`
arrives attacker-controlled, exactly as `specs/extensions/bazaar.md` and RFP
§3.2 warn.

`payTo` is different. It does not come from the client's copy of the resource
block — it comes from the `PaymentRequirements` the facilitator validated and
that Soroban enforced when the transfer executed. After settlement it is an
on-chain fact.

## 3. The rule

```
canonicalKey  := HTTP → normalize(origin + (routeTemplate ?? pathname))
                 MCP  → normalize(resource.url) + "#tool=" + toolName

ownerPayTo    := paymentRequirements.payTo      // validated, on-chain enforced
                                                 // NEVER from discovery metadata

write(canonicalKey, listing):
  if no row for canonicalKey:
      insert, bind owner := ownerPayTo                       → success
  else if row.ownerPayTo == ownerPayTo:
      update in place, owner unchanged                       → success
  else:
      reject                                                 → OWNERSHIP_CONFLICT
```

Three properties follow, and each is a test:

1. **No settlement, no write.** The hook that catalogs runs only after a
   settlement the facilitator itself performed and confirmed. A verify alone
   writes nothing.
2. **Terms come from the payment, not the metadata.** `payTo`, `network`,
   `scheme`, `asset` and amount are copied from the validated
   `PaymentRequirements`. Discovery metadata contributes only descriptive
   fields — `serviceName`, `description`, `tags`, input/output schemas — and
   every one of those passes through upstream sanitisation first.
3. **Discovery failure never fails a payment.** Cataloging happens after
   settlement has already succeeded and its result is already fixed. A rejected
   listing, a validation error, or a dead database changes the `SettleResponse`
   in no way; it changes only the `EXTENSION-RESPONSES` header.

## 4. Attacks

Throughout: **A** is the attacker, **B** the legitimate seller of
`https://b.example/api`.

### 4.1 A pays themselves and claims B's URL

A stands up a resource server, emits a 402 whose `resource.url` is
`https://b.example/api` and whose `payTo` is A's own address, and pays it. The
extension is well-formed. Settlement succeeds — A really did pay A.

**If B has never been cataloged, A wins the key.** This is a genuine squat and
the model does not prevent it. What it bounds:

- The listing records `ownerPayTo = A`, which is visible in every discovery
  response. A cannot appear as B.
- **Catalog payment terms are advisory, never authoritative.** A conformant
  buyer discovers a resource, then requests it and pays against the 402 that the
  *live URL* returns. Hitting `https://b.example/api` yields B's 402 with B's
  `payTo`. So A cannot capture B's revenue this way — A can pollute metadata and
  waste an agent's round trip, not redirect payment.
- B can detect it (the listing is public) and, once domain binding exists
  (§6), displace it.

The residual harm is metadata pollution and denial of listing. It is real. It is
the reason §6 is a committed roadmap item and not a "future work" throwaway.

### 4.2 A copies B's metadata verbatim

A replays B's `serviceName`, `description` and schemas under A's own `payTo`,
against A's own URL. This is not an attack on B's listing — it creates a
*separate* listing under A's canonical key. It is impersonation-by-similarity,
which no ownership rule addresses; it is a ranking and reputation problem.
Recorded here so it is not mistaken for something the ownership rule solves.

If A copies B's metadata against **B's URL**, §4.1 applies: rejected if B
registered first, squat if not.

### 4.3 A tries to change B's price

Rejected twice over. First, A's settlement carries A's `payTo`, so the write
fails the ownership check with `OWNERSHIP_CONFLICT`. Second, even for the
rightful owner, price is not writable from metadata — it is read from the
`PaymentRequirements` that were actually settled. Changing the advertised price
requires actually charging the new price.

### 4.4 A races B for first registration

TOFU is race-vulnerable by construction, and this is the model's weakest point.
Whoever settles first binds the key. There is no fix inside the protocol as it
stands: with no proof of URL control, "first" is the only tiebreaker that does
not require trusting a client claim.

Bounded by the same reasoning as §4.1 — the live 402 governs actual payment —
and closed properly by §6.

### 4.5 A replays an old valid payload

Two independent layers stop this.

- **Payment layer.** A Soroban auth entry is bound by
  `signatureExpirationLedger`, roughly 12 ledgers (~60 s), and the ledger
  rejects a re-submitted authorization. A replayed payload does not settle
  again, so it never reaches the catalog.
- **Catalog layer.** Writes are keyed on `canonicalKey`, a single row per
  resource, so a duplicated `onAfterSettle` callback cannot fan out into
  duplicate listings. The row also stores the settling transaction hash; a
  callback carrying a hash already recorded is a no-op that leaves
  `firstSeenAt` and `lastSeenAt` untouched.

### 4.6 A crafts routeTemplate encoding to collide with B

`routeTemplate` is client-controlled and becomes part of the canonical key, so
it is the direct path to key collision. Defences, in order:

1. **Upstream `isValidRouteTemplate`** (`@x402/extensions/bazaar`) requires a
   leading `/`, restricts the character set, and — critically —
   **percent-decodes before checking** for `..` and `://`, so `%2e%2e%2f` is
   caught rather than smuggled through. We call it; we do not reimplement it.
2. **Key normalisation.** Before the key is stored we lowercase scheme and host,
   drop a default port, and collapse a trailing slash. Two spellings of the same
   resource therefore reach the *same* row — where the ownership check applies —
   rather than two rows that quietly shadow each other.
3. **Reject, do not repair.** Anything that fails validation is soft-rejected
   with `INVALID_ROUTE_TEMPLATE`. We never "clean up" a hostile template into
   something storable; a normalisation that silently rewrites attacker input is
   how collisions get reintroduced.

## 5. What we will and will not claim

**Will:** the address in `payTo` provably received the stated amount of the
stated asset on the stated network, and every subsequent update to this listing
came from that same address.

**Will not:** that the listing's owner controls the resource URL; that the
service behaves as its metadata describes; that the metadata is truthful; that
the advertised price is what the endpoint will actually charge.

Discovery responses should carry this distinction rather than bury it, so a
consuming agent treats catalog terms as a hint and the live 402 as the contract.

## 6. Closing the gap

Ranked by cost against strength. None is implemented yet; the first is the one
worth doing.

1. **Domain binding via a well-known document.** The seller publishes
   `https://host/.well-known/x402` listing the `payTo` addresses authorized to
   catalog resources under that origin. The facilitator fetches it out of band —
   never on the settlement hot path, with an allowlisted scheme, no redirects
   and private CIDRs denied — and upgrades the listing from `tofu` to
   `domain-verified`. Cheap, standard, and it converts §4.1 and §4.4 from
   "unpreventable" to "detectable and correctable".
2. **Signed seller assertion.** The seller signs `(origin, payTo, expiry)` with
   the `payTo` key and puts it in the extension. Proves the key holder asserts
   the origin, but still not that they control it — strictly weaker than (1)
   while adding wire surface.
3. **Ownership provenance in the response.** Expose the binding strength on
   every listing so buyers can filter. Trivial, and a precondition for (1) being
   useful.

Until (1) ships, every listing this facilitator serves is `tofu`, and the
discovery response says so.
