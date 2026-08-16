# Deployment, provenance and secrets

## Repositories

| Repo | Branch | Commit under review |
| --- | --- | --- |
| `facilitador-stellar` (core) | `feat/hosted-testnet-facilitator` | `5e8f740` |
| `x402seek-web` | `main` | `64cfa78` |

pnpm workspaces, `pnpm-lock.yaml` committed, `packageManager` pinned to
`pnpm@10.5.2`. Multi-stage Docker builds from the repository root so the
workspace manifests are visible to the install layer.

## Deployment provenance: PASS

Every deployed service reports the commit and branch it was built from. Queried
from the Railway API on 2026-08-16:

| Service | Status | Commit | Branch |
| --- | --- | --- | --- |
| `x402seek-preview` | SUCCESS | `64cfa78` | `main` |
| `x402seek-facilitator-testnet` | SUCCESS | `5e8f740` | `feat/hosted-testnet-facilitator` |
| `x402seek-demo-seller-testnet` | SUCCESS | `5e8f740` | `feat/hosted-testnet-facilitator` |
| `x402seek-demo-buyer-testnet` | SUCCESS | `5e8f740` | `feat/hosted-testnet-facilitator` |

All four match the commits above. **No deployed artifact has an unestablished
source commit.**

Deployment triggers pin the branch explicitly. This matters: an earlier
deployment in this project built `main` when the work was on a feature branch,
which is why the trigger is pinned rather than left to default.

The build is not bit-for-bit reproducible: Docker layers pull from a package
registry at build time. Provenance here means "this image was built from this
commit by this platform", not "this image can be rebuilt byte-identically".
Stated rather than implied.

## Runtime

| Service | Public | Port | Volume | Runtime user | trustProxy |
| --- | --- | --- | --- | --- | --- |
| `x402seek-preview` | `x402seek.xyz` | platform | none | node | **2** |
| facilitator | `facilitator.testnet.x402seek.xyz` | 4402 | `/data` | node, via `setpriv` | **2** |
| demo seller | `demo-api.testnet.x402seek.xyz` | 4420 | none | node | default |
| demo buyer | **none** | 4430 | `/data` | node, via `setpriv` | **false**, correctly |

Containers with a volume start as root, take ownership of the mount, then
`exec setpriv` to drop to `node`. `setpriv` replaces the process rather than
forking, so PID 1 semantics survive and SIGTERM still reaches Node, which is what
lets the ledger close cleanly. Verified during deployment: PID 1 runs as uid 1000.

The demo buyer listens on `::` rather than `0.0.0.0`, because Railway's private
network is IPv6-only and an IPv4-only listener is reachable from nowhere.

`trustProxy = 2` on the two public Fastify services is measured, not assumed. See
`FINDINGS-2026-08-16.md` SR-01 for the measurement and why 1, 3 and `true` are
all wrong.

## Secrets, by name

Values are never printed, logged, committed or returned. Every secret lives in
the Railway variable store of exactly one service.

| Name | Service | Purpose | Rotation impact | Blast radius | Public half derivable | In logs | Redaction tested |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SIGNER_SECRET_KEYS` | facilitator | sign and submit settlements, sponsor fees | settlement stops until updated | the facilitator's XLM; hostile submission | yes, the `G…` address is public | never | yes, `redact()` |
| `DEMO_BUYER_SECRET` | demo buyer | sign the one demo payment | the demo stops | its USDC float, currently 4.996 | yes, `GBCDHGGF…` | never | yes |
| `METRICS_TOKEN` | facilitator | guard `/internal/metrics` | metrics unreadable | read-only operational detail | n/a | never | yes |
| `METRICS_TOKEN` | demo buyer | same | same | same | n/a | never | yes |

**No shared token exists between x402seek-web and the demo buyer.** The transport
is Railway's private network and the buyer has no public domain, so there is
nothing for a token to add. That is a deliberate choice recorded in
`../hosted/demo-buyer-implementation-plan.md` §13: topology rather than a
credential someone has to remember to rotate.

**x402seek-web holds no secret at all.** It is the only public entry point and it
cannot sign anything.

`redact()` in each config module names every secret field explicitly rather than
filtering by pattern, so a field added later is opaque by default instead of
leaking because nobody updated a regular expression.

The demo buyer's key was generated in memory during provisioning and sent once to
the variable store. It has never been on disk, in a file, or in any output.

## Configuration that is security-relevant

| Variable | Service | Why it matters |
| --- | --- | --- |
| `DEMO_ENABLED` | demo buyer | the kill switch for the only visitor-triggered spend |
| `BALANCE_FLOOR_UNITS` | demo buyer | refuse before signing below 0.5 USDC |
| `TRUST_PROXY` | facilitator | 2; without it every caller shares one rate-limit bucket |
| `STELLAR_NETWORK` | all | testnet, and `assertNetworkLock()` refuses anything else |
| `DATA_DIR` / `CATALOG_PATH` | buyer / facilitator | the volume the budget and ownership state live on |
| `DEMO_BUYER_URL` | web | overridable for local development only; defaults to the private-network name |

## Dependency supply chain

`scripts/audit-licenses.mts` walks the runtime workspaces, including
`apps/demo-buyer`, which is the one service holding a signing key. Result: zero
copyleft, zero unclassified. Run in CI and before every release commit.

No dependency was added for domain verification, the spend ledger, rate limiting
or timing-safe comparison: `node:https`, `node:dns`, `node:crypto` and
`better-sqlite3` were already in the graph.
