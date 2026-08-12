#!/usr/bin/env bash
# Launch our facilitator from inside OUR pnpm workspace.
#
# The upstream harness spawns this with cwd set to the copy of this directory
# inside the x402 repo, which knows nothing about our packages. Node resolves
# imports from the importing file's location, so `--dir` alone is not enough:
# the adapter has to run from its own workspace package, where
# @stellar-bazaar/facilitator is a real dependency.
set -euo pipefail

: "${STELLAR_BAZAAR_ROOT:?STELLAR_BAZAAR_ROOT must point at the stellar-bazaar repo}"

PROXY_DIR="$STELLAR_BAZAAR_ROOT/e2e-harness/proxy"
exec pnpm --dir "$PROXY_DIR" exec tsx "$PROXY_DIR/index.mts"
