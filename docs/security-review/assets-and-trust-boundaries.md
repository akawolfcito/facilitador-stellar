# Assets

What is worth protecting, and what it would cost to lose it. Boundaries are in
`architecture.md`; this is the inventory they exist to protect.

C, I, A are confidentiality, integrity, availability. Economic impact is stated
in what it can actually cost today, on testnet, and what the same thing would
cost on pubnet, because the second number is the one that changes the design.

| # | Asset | C | I | A | Economic impact |
| --- | --- | --- | --- | --- | --- |
| 1 | **Facilitator signer** (`SIGNER_SECRET_KEYS`) | **critical** | critical | high | Today: the facilitator's ~20 XLM of fee budget. On pubnet: every fee it would ever sponsor, unbounded until noticed. The highest-value secret in the system |
| 2 | **Demo buyer secret** (`DEMO_BUYER_SECRET`) | high | high | medium | Its float, currently 4.996 USDC. Bounded by the balance, not by the daily ceiling: a stolen key ignores our ledger |
| 3 | **Demo buyer USDC float** | — | high | medium | 4.996 USDC. Refills are manual, so exhaustion is an outage of the demo, not of x402Seek |
| 4 | **Facilitator XLM balance** | — | high | **high** | ~20 XLM. Drained means no settlement at all: fee sponsorship is what makes buyers not need XLM, so this is a single point of availability failure |
| 5 | **Seller `payTo`** | — | high | — | Public by design. Integrity matters because the catalog binds listings to it; confidentiality does not apply |
| 6 | **Catalog ownership state** | — | **high** | medium | No direct money. A squatted or overwritten listing sends discovery traffic to the wrong resource, and on pubnet that becomes a path to real money |
| 7 | **Domain verification state** | — | high | low | Derived, re-fetchable, 24 h TTL. Corrupting it downgrades a label; it cannot move funds |
| 8 | **Spend ledger** | low | **critical** | high | The only thing standing between an abused endpoint and an unbounded spend. Losing integrity means the daily ceiling stops existing |
| 9 | **Railway secrets and account** | **critical** | critical | critical | Reaches assets 1 and 2 and every service. No technical control beyond account security |
| 10 | **Metrics tokens** | medium | low | low | Read-only operational detail. Both endpoints are private; the buyer's has no public domain at all |
| 11 | **Frozen evidence integrity** | — | **high** | low | `docs/scf/` at `762c6e6` and `HOSTED-E-*`. Not money, but it is the proposal's entire claim. Corrupting it is the reputational equivalent of losing the float |
| 12 | **Search index** | — | low | medium | Derived state. Deleting it costs CPU and nothing else, which is a property the catalog design deliberately preserves |

## Notes an auditor should not have to derive

**Asset 1 dominates.** Every other secret is bounded by a balance or a ceiling.
The facilitator signer is bounded by whatever it is funded with, and on pubnet by
whatever it would be funded with. Any review time budget should be spent here
first.

**Asset 8 is the control, not the record.** The spend ledger is not accounting
for reporting; it is the mechanism that enforces 150 payments and 0.15 USDC per
UTC day, reserve-before-signing, across restarts. Its integrity is the reason an
abused demo endpoint costs 0.15 USDC a day rather than a float.

**Asset 2's blast radius is not the ceiling.** The daily budget binds requests
that arrive through our service. A stolen key spends directly on chain and the
ledger never sees it. This is why the float is small and why refills are manual.

**Assets 6 and 11 have no economic impact today and both would on pubnet.** They
are listed at their eventual weight rather than their current one, because the
purpose of this document is to be read before a pubnet decision, not after.
