# x402Seek Resource Ownership Convention v1: FROZEN

2026-08-16. Core `632cbfc`, web `6d5b307`. SCF freeze remains `762c6e6`.

**Feature: FROZEN.**
**Name: x402Seek Resource Ownership Convention v1.**
**Status: implemented, hosted, evidenced, experimental.**
**Standard status: an x402Seek-defined convention. Not an x402 upstream standard.**

## Frozen surface

| Thing | Value |
| --- | --- |
| Path | `/.well-known/x402`, on the resource's exact origin |
| Document | `{ version: 1, kind: "resource-ownership", resources: [{ resource, payTo, network }] }` |
| Matching | exact resource, exact `payTo`, exact `network`. No wildcards, no scheme, no asset, no document expiry |
| Origin rule | the resource's own origin. No parent walk, no apex fallback, no redirects followed, HTTPS only, port 443 only |
| States | `tofu`, `domain-verified`, `domain-mismatch`, with `domain-mismatch` outranking both |
| TTL | 24 h, stale-while-revalidate, lazy on read, no cron |
| Grace | 7 days of continuous non-answer before a verified binding degrades |
| Failure set | ten closed reasons, no upstream text persisted or returned |
| Integration | enrichment after catalog insertion, never awaited on the settlement path |

## What it proves

**Domain control proof.** The controller of the resource's HTTPS origin declares
that this resource may be catalogued against this `payTo` on this network.

Not wallet ownership proof. Not wallet authentication. Not seller authenticity.
Not payment validity. Nothing in the document is signed by the `payTo` key, so an
origin can name an address it does not hold. The live 402 remains the payment
authority.

## The compatibility caveat

This is the part not to overstate.

`kind: "resource-ownership"` protects **semantic interpretation**. A reader
expecting a different document at this path sees a `kind` it does not recognise
and skips ours, and ours skips theirs. That is real and it is tested.

It does **not** guarantee that the path `/.well-known/x402` stays available for
this purpose. If upstream assigns that location a canonical document shape, the
path is theirs, not ours, and `kind` will not change that.

Checked today against `x402-foundation/x402` at `167a828e`: no merged
`.well-known/x402` convention exists. Two open proposals claim the path or one
next to it, neither merged, both `REVIEW_REQUIRED`:

- **#2979** (OPEN, updated 2026-08-10) — `/.well-known/x402` as a *facilitator*
  manifest, with `x402Version` and a `kind` discriminator of its own.
- **#2646** (OPEN DRAFT, "DO NOT MERGE", updated 2026-07-03) —
  `/.well-known/x402.json` as a per-origin resource manifest.

Therefore:

- **schema v1 is frozen**
- **path compatibility is provisional**
- future upstream alignment may require migration
- any such migration touches discovery and catalog enrichment only, never
  settlement, because verification has never been on the payment path

Classification against #2979: **coexistence possible**. Both documents carry a
`kind`, both readers can skip what they do not own, and a host that is both a
seller and a facilitator would need one file with two kinds or a different path
for one of them. That is a merge conflict in someone's document root, not a
protocol break.

If migration is ever needed, the likely shape is: keep the schema, move the path
to something unambiguous such as `/.well-known/x402-ownership`, bump to v2, and
re-fetch. Every stored result is derived state with a 24 h TTL, so the migration
costs a re-verification pass and no data loss.

## Reopen conditions

Reopen only if:

- upstream merges a conflicting `.well-known` convention
- the x402 TSC requests alignment
- the RFP interpretation changes
- a security defect is discovered
- our path becomes incompatible with an adopted standard

Not for cosmetic work. Not for a new label. Not for another origin's convenience.

## HOSTED-E-08 verification

Audited against the record. It contains all of:

- domain control proof only, in those words, with the four things it does not
  prove named explicitly
- the correct document as served, with headers
- `tofu` → `domain-verified`
- `domain-verified` → `domain-mismatch`
- `domain-mismatch` → `domain-verified`
- payment plane unchanged throughout, including the decoded 402 during the
  mismatch window still quoting the real payee
- no payment required for any transition, with the demo buyer's balance
  identical before and after
- the schema identified as an x402Seek implementation convention
- upstream standard status described correctly, with both PR numbers and states

Nothing rewritten. The DNS pinning defect the acceptance exposed stays recorded
as it happened.

**HOSTED-E-08: PASS.**
