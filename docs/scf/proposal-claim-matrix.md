# Proposal claim matrix

The anti-overclaim gate. Every quantitative or interoperability claim in
`proposal.md` and `reviewer-one-pager.md` appears here with its evidence and its
caveat. If a row says **NO** under "Can say?", the claim must not appear in
either document.

Reviewed 2026-08-13 against `evidence-log.md`.

| # | Proposal claim | Evidence | Artifact / command | Status | Can say? | Caveat |
|---|---|---|---|---|---|---|
| 1 | The upstream reference Bazaar search matches the whole query as one lowercase substring | E-01 | `examples/typescript/facilitator/advanced/bazaar.ts:87-108` @ `c8247c4` | verified | **YES** | Must name the pinned revision; upstream may change |
| 2 | That reference scores 0.0% nDCG@10 on 36 of 52 answerable queries | E-01 | `pnpm eval:retrieval` · `artifacts/retrieval-eval/latest.json` | measured | **YES** | Only on our synthetic benchmark; say so |
| 3 | Held-out nDCG@10: baseline 22.6%, BM25 83.0%, dense 95.3%, RRF 93.5% | E-02, E-03 | same | measured | **YES** | Always with "on our held-out synthetic benchmark" |
| 4 | 95.3% is production accuracy | — | — | **false** | **NO** | Corpus and labels are author-written |
| 5 | Our search is the best available | — | — | unsupported | **NO** | No comparison against other facilitators was run |
| 6 | RRF hybrid underperformed dense and was not shipped | E-03 | `artifacts/retrieval-eval/latest.json` | measured | **YES** | Corpus-specific; state that |
| 7 | Dense retrieval cannot abstain; BM25 can | E-04 | `pnpm eval:retrieval`, negatives line | measured | **YES** | 4 negative queries only |
| 8 | Abstention threshold 0.22, calibrated on the dev split only | E-14 | `pnpm calibrate` | measured | **YES** | 2 dev negatives; call it conservative, not calibrated |
| 9 | Abstention: 96.2% coverage, 3/4 negatives rejected, 25% FP rate | E-14 | same | measured | **YES** | Sample far too small; distributions overlap |
| 10 | Our threshold cleanly separates relevant from irrelevant | — | — | **false** | **NO** | Held-out FP scores 0.2362 above a real query at 0.2091 |
| 11 | `/supported` is byte-identical to the x402.org conformance baseline | E-05 | live curl, both endpoints | verified | **YES** | Observed 2026-08-11 |
| 12 | An unmodified stock x402 client completes a real testnet payment | E-06 | `pnpm --filter …e2e-stellar e2e` | verified on chain | **YES** | — |
| 13 | Upstream x402 e2e suite: 9/9 payments, 5/5 discovery, exit 0 | E-18 | `e2e-harness/run-upstream-e2e.sh` · `artifacts/e2e/upstream-e2e-results.json` | verified | **YES** | Testnet only; name the pinned commit |
| 14 | No client or protocol package was patched | E-18 | adapter is config-only in `e2e-harness/proxy/` | verified | **YES** | Two throwaway credentials for untested families are config |
| 15 | The suite passes on both networks | — | — | **false** | **NO** | Pubnet has never been run |
| 16 | Express, Fastify, Hono, Next and MCP all pass with axios and fetch | E-20 | `artifacts/e2e/upstream-e2e-results.json` | verified | **YES** | Must disclose the isolated Hono+fetch residual |
| 17 | Hono+fetch is a confirmed upstream bug | — | — | unsupported | **NO** | BOUNDED; root cause unknown; nothing filed |
| 18 | Hono+fetch fails ~25% in isolation; controls exclude our facilitator, the client and `@x402/hono` | E-20 | `e2e-harness/measure-hono-fetch.sh`, `measure-fastify-fetch.sh`, `hono-repro` | measured | **YES** | 12 harness runs; 60 in-process passes |
| 19 | Nine payments settled in canonical testnet USDC | E-19 | nine hashes in E-19 | verified on chain | **YES** | — |
| 20 | Buyer spent 0.0000000 XLM; facilitator paid 0.0206757 XLM in fees | E-19 | `artifacts/e2e/balances-{before,after}-green.json` | verified on chain | **YES** | — |
| 21 | Automatic cataloging with zero registration calls | E-09, E-12 | `artifacts/e2e/stellar-testnet-bazaar-catalog.json` (`registrationCallsMade: 0`) | verified | **YES** | — |
| 22 | Catalog survives a full facilitator restart | E-09, E-16 | restart step in the e2e run | verified | **YES** | Restarted on a different port to rule out socket reuse |
| 23 | Six paid resources cataloged, zero direct DB inserts | E-12 | `artifacts/e2e/stellar-testnet-bazaar-search.json` | verified | **YES** | — |
| 24 | Search p50 3.3 ms / p95 4.4 ms | E-12 | same | measured | **YES** | Six listings; says nothing about 10⁴ |
| 25 | Hard filters run before ranking; wrong-network returns zero, not a demotion | E-15 | live run + `packages/search/test` | verified | **YES** | — |
| 26 | An agent discovered an MCP tool from intent alone and paid 0.001 USDC | E-22, E-23 | `artifacts/e2e/mcp-discovery-pay-call.json`, tx `f92a6aec…` | verified on chain | **YES** | Localhost tool server; not a public deployment |
| 27 | The live 402 overrides stale catalog terms | E-24 | same run: `PAYMENT_REQUIREMENTS_CHANGED`, `PRICE_EXCEEDS_LIMIT` | verified | **YES** | — |
| 28 | Pay-and-invoke is atomic | — | — | **false** | **NO** | No atomicity in x402; failure carries a `paid` block |
| 29 | URL ownership is proven | — | — | **false** | **NO** | TOFU only; disclosed on every listing |
| 30 | A different payment recipient cannot overwrite a listing | E-11 | `packages/catalog/test/catalog.test.ts` | verified | **YES** | Within the TOFU model; first mover can still squat |
| 31 | 244 resolved packages, 238 runtime, zero forbidden/unknown/review | E-26 | `pnpm audit:licenses` · `artifacts/compliance/licenses.json` | measured | **YES** | Scope is the runtime workspaces; say so |
| 32 | All software in the project is permissively licensed | — | — | overbroad | **NO** | Claim is scoped to the resolved runtime graph |
| 33 | No OpenZeppelin or relayer package anywhere in the graph | E-28 | audit `openzeppelinMatches: []` | verified | **YES** | — |
| 34 | The audit found and removed an LGPL dependency (sharp → libvips) | E-27 | commit `331e9bd`; before/after audit output | verified | **YES** | — |
| 35 | The embedder swap was behaviourally neutral | E-27 | identical cosine probe; unchanged held-out nDCG@10 | verified | **YES** | — |
| 36 | Model artifacts are Apache-2.0, verified at source and hashed | E-27 | HF model page; three SHA-256 hashes | verified | **YES** | `onnxruntime-node` ships no LICENSE file; MIT rests on metadata + repo |
| 37 | Licence compliance is enforced in CI | E-29 | `.github/workflows/ci.yml` | in place | **YES** | Workflow committed; not yet observed on a live PR |
| 38 | MCP resource keys follow `(resource.url, toolName)` | E-17 | unit tests + live catalog row | verified | **YES** | — |
| 39 | The Bazaar spec has no field for an MCP server's address | E-22 spec-gap note | `McpDiscoveryInfo.transport` type | verified | **YES** | Present as an interop finding, not a standard |
| 40 | Our `mcp://host:port/...` form is a standard | — | — | **false** | **NO** | Practical workaround; must be labelled as such |
| 41 | We contributed to upstream x402 | — | — | **false** | **NO** | Nothing filed; #3098/#3121/#3125 are other teams' |
| 42 | `upto` is implemented | — | — | **false** | **NO** | Not started; tranche 2 |
| 43 | Production ready on mainnet | — | — | **false** | **NO** | No pubnet run; no security review |
| 44 | 167 tests passing, typecheck clean | — | `pnpm -r test`, `pnpm -r typecheck` | verified | **YES** | — |
| 45 | Nobody else has built this / first ever | — | — | unsupported | **NO** | Nine other repositories target this RFP (kill-or-go §14) |

## Rows that changed the drafts

Claims 4, 5, 10, 15, 17, 28, 29, 32, 40, 41, 42, 43 and 45 were each either
never written or removed during drafting. The two that were hardest to give up:

- **"production accuracy 95.3%"** — every mention now carries "on our held-out
  synthetic benchmark", and the caveat paragraph sits immediately under the
  results table rather than in a footnote.
- **"first Stellar Bazaar"** — nine other repositories are chasing this RFP.
  The proposal competes on measured evidence, not on primacy.
