#!/usr/bin/env bash
#
# Run the x402 repository's own e2e suite against our facilitator.
#
# RFP §3.6 makes this an acceptance criterion: "a passing run of the x402 repo's
# e2e suite for both networks". The point is that reviewers can point stock SDK
# code at the deliverable instead of reading a conformance claim, so nothing
# here patches a client or a protocol package. The only additions are:
#
#   - our adapter copied into e2e/facilitators/external-proxies/, which is the
#     directory upstream gitignores for exactly this purpose
#   - an e2e/.env with our testnet keys
#
# Usage:
#   e2e-harness/run-upstream-e2e.sh [--commit <sha>] [--verbose]
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${X402_WORKDIR:-$ROOT/.x402-upstream}"
# Pinned so a conformance claim names an exact upstream tree.
COMMIT="${X402_COMMIT:-c8247c4cd15f29498474404d94636e7dbb894e86}"
VERBOSE=""

# Default asset is whatever the upstream config says, which is USD -> testnet
# USDC. `--asset native` rewrites the Stellar route to price in the native XLM
# Stellar Asset Contract instead.
#
# That override exists for one reason: testnet USDC is minted only by Circle's
# faucet, which is interactive, so an unattended run cannot fund the buyer.
# Everything else about the run is identical — same client, same scheme, same
# facilitator, same settlement path — but a run using it is NOT a USDC
# conformance run and must not be reported as one.
ASSET="default"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) COMMIT="$2"; shift 2 ;;
    --asset) ASSET="$2"; shift 2 ;;
    --verbose) VERBOSE="-v"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$ROOT/apps/e2e-stellar/.env.e2e" ]]; then
  echo "apps/e2e-stellar/.env.e2e not found — run: pnpm --filter @stellar-bazaar/e2e-stellar provision" >&2
  exit 1
fi

# ---------------------------------------------------------------- upstream
if [[ ! -d "$WORK/.git" ]]; then
  echo "==> cloning x402 into $WORK"
  git clone --quiet https://github.com/x402-foundation/x402.git "$WORK"
fi
git -C "$WORK" fetch --quiet origin
git -C "$WORK" checkout --quiet "$COMMIT"
# `git checkout <sha>` carries local modifications across rather than discarding
# them, so a previous `--asset native` rewrite of mechanisms_stellar.json would
# silently persist into a run that did not ask for it. That happened: a run
# reported 9/9 "USDC" while the chain showed XLM moving and zero USDC delta.
# Restore tracked files explicitly.
git -C "$WORK" checkout --quiet --force "$COMMIT" -- .
echo "==> upstream x402 @ $(git -C "$WORK" rev-parse HEAD) (config restored)"

# ---------------------------------------------------------------- adapter
PROXY_DIR="$WORK/e2e/facilitators/external-proxies/stellar-bazaar"
mkdir -p "$PROXY_DIR"
cp "$ROOT/e2e-harness/proxy/test.config.json" "$PROXY_DIR/"
cp "$ROOT/e2e-harness/proxy/run.sh" "$PROXY_DIR/"
chmod +x "$PROXY_DIR/run.sh"
echo "==> adapter installed at e2e/facilitators/external-proxies/stellar-bazaar"

# ---------------------------------------------------------------- asset
# `git checkout` above restores the pristine config, so this rewrite is applied
# fresh each run and never accumulates.
if [[ "$ASSET" == "native" ]]; then
  NATIVE_SAC="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
  python3 - "$WORK/e2e/config/mechanisms_stellar.json" "$NATIVE_SAC" <<'PY'
import json, sys
path, sac = sys.argv[1], sys.argv[2]
with open(path) as fh:
    cfg = json.load(fh)
for route in cfg["routes"].values():
    route["price"] = {"asset": sac, "amount": "10000"}
with open(path, "w") as fh:
    json.dump(cfg, fh, indent=2)
    fh.write("\n")
PY
  echo "==> ⚠ asset override: native XLM SAC ($NATIVE_SAC), NOT a USDC conformance run"
fi

# ---------------------------------------------------------------- env
# Read our provisioned testnet accounts without echoing any secret.
get() { grep -E "^$1=" "$ROOT/apps/e2e-stellar/.env.e2e" | head -1 | cut -d= -f2-; }

BUYER_SECRET="$(get E2E_BUYER_SECRET)"
SELLER_ADDRESS="$(get E2E_SELLER_ADDRESS)"
FACILITATOR_SECRET="$(get E2E_FACILITATOR_SECRET)"
RPC_URL="$(get STELLAR_RPC_URL)"

# The stock e2e client builds an EVM account and an SVM signer unconditionally
# in `createE2EClient()` (clients/typescript/client.ts:89-92), before any
# protocol-family filtering, so a Stellar-only run still needs those two
# variables present or it dies with `privateKeyToAccount(undefined)`.
#
# These are deterministic throwaway values for families this run does not test.
# They are never funded and never sign anything that reaches a chain. Supplying
# them is configuration; it changes no client behaviour.
# The SVM value must be a real ed25519 keypair — solana's 64-byte secret is
# seed(32) || publicKey(32) and the halves have to correspond, so a run of
# constant bytes is rejected by @solana/keys before any test starts.
DUMMY_EVM_KEY="0x$(printf '11%.0s' {1..32})"
DUMMY_SVM_KEY="$(cd "$WORK/e2e" && node --input-type=module -e '
import { generateKeyPairSync } from "node:crypto";
import { base58 } from "@scure/base";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const secret = new Uint8Array(64);
secret.set(seed, 0); secret.set(pub, 32);
console.log(base58.encode(secret));
')"

umask 077
{
  echo "# generated by e2e-harness/run-upstream-e2e.sh — testnet only"
  echo "CLIENT_STELLAR_PRIVATE_KEY=$BUYER_SECRET"
  echo "SERVER_STELLAR_ADDRESS=$SELLER_ADDRESS"
  echo "FACILITATOR_STELLAR_PRIVATE_KEY=$FACILITATOR_SECRET"
  echo "STELLAR_TESTNET_RPC_URL=$RPC_URL"
  echo "STELLAR_BAZAAR_ROOT=$ROOT"
  echo "CLIENT_EVM_PRIVATE_KEY=$DUMMY_EVM_KEY"
  echo "CLIENT_SVM_PRIVATE_KEY=$DUMMY_SVM_KEY"
} > "$WORK/e2e/.env"
echo "==> wrote e2e/.env (7 keys, values not shown)"

# ---------------------------------------------------------------- install
# The e2e workspace links `../typescript/packages/*` with `workspace:*`, so the
# servers import `@x402/express` etc. from `dist/cjs` — which only exists after
# the upstream packages are built. Installing e2e alone leaves dangling symlinks
# and the server dies at startup with "Cannot find module .../dist/cjs/index.js".
if [[ ! -d "$WORK/typescript/node_modules" ]]; then
  echo "==> installing upstream typescript workspace (slow, first run only)"
  (cd "$WORK/typescript" && pnpm install --silent)
fi

if [[ ! -f "$WORK/typescript/packages/http/express/dist/cjs/index.js" ]]; then
  echo "==> building upstream typescript packages (slow, first run only)"
  (cd "$WORK/typescript" && pnpm build)
fi

if [[ ! -d "$WORK/e2e/node_modules" ]]; then
  echo "==> installing upstream e2e dependencies (slow, first run only)"
  (cd "$WORK/e2e" && pnpm install --silent)
fi

# The Next server runs in production mode (`next start`), so it needs a build
# first — upstream's own setup.sh does this via the component's build.sh, which
# a bare `pnpm install` skips. Without it the scenario fails with "Could not
# find a production build in the '.next' directory".
NEXT_DIR="$WORK/e2e/servers/typescript/http/next"
if [[ -d "$NEXT_DIR" && ! -d "$NEXT_DIR/.next" ]]; then
  echo "==> building upstream Next e2e server (slow, first run only)"
  (cd "$NEXT_DIR" && bash install.sh >/dev/null 2>&1 || true; bash build.sh)
fi

# ---------------------------------------------------------------- run
mkdir -p "$ROOT/artifacts/e2e"
OUT="$ROOT/artifacts/e2e/upstream-e2e-results.json"

echo "==> running upstream suite: stellar / exact / bazaar, facilitator=stellar-bazaar"
set +e
(cd "$WORK/e2e" && STELLAR_BAZAAR_ROOT="$ROOT" TRACE_SETTLE="${TRACE_SETTLE:-}" pnpm exec tsx test.ts \
  --facilitators=stellar-bazaar \
  --families=stellar \
  --schemes=exact \
  --extensions=bazaar \
  --testnet \
  ${SERVERS:+--servers=$SERVERS} \
  --output-json="$OUT" \
  $VERBOSE)
STATUS=$?
set -e

echo "==> exit status $STATUS"
[[ -f "$OUT" ]] && echo "==> results: $OUT"
exit $STATUS
