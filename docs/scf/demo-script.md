# Demo script — 4 minutes

One idea to land: **payments are already machine-readable; discovery has to
become decision-grade.** Everything runs on testnet from a clean checkout. No
mainnet, no funds at risk.

## Before you start

```bash
nvm use && pnpm install
pnpm --filter @stellar-bazaar/e2e-stellar provision       # funds three testnet accounts
pnpm --filter @stellar-bazaar/e2e-stellar provision:usdc  # trustlines
```

Then fund the buyer with a little testnet USDC at
<https://faucet.circle.com> (Stellar testnet). The provision command prints the
address and tells you if the balance is zero.

Warm the model cache once so the demo does not pause on a download:

```bash
pnpm eval:retrieval > /dev/null
```

---

## 0:00 — The gap (30s, no terminal)

> Stellar already settles agent payments. `@x402/stellar` does `exact` on both
> networks, and a settlement costs a fraction of a cent.
>
> What an agent still cannot do is find what to pay for. And when the buyer is
> software with a wallet, a bad search result isn't a wasted click — it's a
> wasted payment.

## 0:30 — What the reference search does (45s)

```bash
pnpm eval:retrieval
```

Point at the per-category table for `baseline-includes`:

> This is the upstream reference Bazaar search, reproduced faithfully. It
> matches the whole query as one lowercase substring. `"weather"` works.
>
> *"what service can tell me whether it will rain tomorrow?"* returns nothing —
> zero point zero, on every natural-language, constraint, multi-intent and MCP
> query. Thirty-six of fifty-two.

Then the summary line:

> Held-out: 22.6% for the reference, 95.3% for dense retrieval.
>
> And the caveat, up front: this corpus and these labels are ours. That's a
> held-out synthetic score, not production accuracy. The number I'd defend is
> the *ordering* — the baseline's zeros are structural, not phrasing.

**Optional, 15s, if the room is technical:** point at `hybrid-rrf` at 93.5%.

> We expected fusion to win. It lost. We shipped dense and not the richer
> architecture, because the benchmark said so.

## 1:15 — An agent discovers, decides, and pays (2 min) — the centrepiece

```bash
pnpm --filter @stellar-bazaar/e2e-stellar mcp
```

Narrate against the output as it appears:

**`tool cataloged by a real payment`**
> The tool enters the catalog the only way anything can here: somebody paid for
> it. There is no registration endpoint.

**`agent discovers the tool by intent`**
> The agent was given a sentence and nothing else — *"I need something that can
> condense a long passage of text."* No URL, no tool name, no price. Discovery
> returns all of it, including the input schema.

**`ownership binding is visible → tofu`**
> x402 proves who *received* a payment. It proves nothing about who controls a
> URL. So every listing says so, out loud, on every result.

**`stale listing terms are rejected` / `price ceiling is enforced`**
> Before signing, the agent re-fetches the live 402 and compares it with what it
> discovered. **The live 402 is the contract; the catalog is advisory.** A drifted
> price aborts. A price above the caller's ceiling aborts. Nothing is signed.

**`pay and invoke` + the transaction hash**
> 0.001 USDC, canonical Stellar testnet USDC, settled.

Open the explorer on the printed hash:

> Real transaction. And notice what the buyer did *not* spend: zero XLM. The
> facilitator sponsors the fee, so an agent needs only the payment asset.

**`tool result returned`**
> Sentence in, paid tool out. No pre-existing integration between the two
> parties at any point.

## 3:15 — Conformance (45s)

```bash
cat artifacts/e2e/upstream-e2e-results.json | jq .summary .breakdowns.byServer
```

> This is the x402 repository's *own* end-to-end suite, pinned at commit
> `c8247c4`, run against our facilitator. Nine of nine Stellar payment scenarios,
> five of five Bazaar discovery checks. Express, Fastify, Hono, Next and MCP;
> axios and fetch. No client or protocol patch — our facilitator joins through
> the external-proxy directory upstream provides for exactly this.
>
> It also found two of our bugs: a discovery response stock clients couldn't
> parse, and a `routeTemplate` policy stricter than upstream that silently
> dropped a listing. Settlement was fine both times. That's why the RFP makes
> this an acceptance criterion instead of a claim.

## 4:00 — Close (15s)

> Not production-ready on mainnet, and we don't claim it is. No pubnet run, no
> security review, `upto` not started. What exists is a working, measured
> testnet implementation, and every number I showed traces to an evidence log
> with the command that regenerates it.

---

## If something goes wrong

| Symptom | Fix |
|---|---|
| MCP demo fails at the seed payment | Buyer is out of testnet USDC. Re-fund at faucet.circle.com and re-run `provision:usdc` to check the balance. |
| First run pauses ~30s | Model artifacts downloading. Run `pnpm eval:retrieval` once beforehand. |
| Port already in use | `lsof -ti:4402-4531 \| xargs kill -9` |
| `upstream-e2e-results.json` missing | `e2e-harness/run-upstream-e2e.sh` — first run clones and builds upstream and takes several minutes. |

**Fallback if the network is unusable:** every artifact under `artifacts/e2e/`
is a committed record of a real run, with transaction hashes that resolve on
stellar.expert. Walk those instead — the story survives without a live network.
