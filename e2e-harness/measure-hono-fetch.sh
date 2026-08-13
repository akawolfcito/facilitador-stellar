#!/usr/bin/env bash
#
# Measure the hono + fetch combination instead of calling it a flake.
#
# It failed once with `SyntaxError: Unexpected end of JSON input` — an empty
# response body — while the same client passed against express, fastify and
# next, and the same server passed with axios. That is the shape of a flake, but
# "shape of" is not evidence. This runs the exact combination N times and
# reports a rate.
#
# Usage: e2e-harness/measure-hono-fetch.sh [runs]
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${X402_WORKDIR:-$ROOT/.x402-upstream}"
RUNS="${1:-20}"
LOGDIR="$ROOT/artifacts/e2e/hono-fetch-runs"
mkdir -p "$LOGDIR"

pass=0
fail=0
declare -a failures=()

echo "measuring typescript/http/hono + typescript/http/fetch over $RUNS runs"
echo

for i in $(seq 1 "$RUNS"); do
  out="$LOGDIR/run-$i.json"
  log="$LOGDIR/run-$i.log"

  set +e
  (cd "$WORK/e2e" && STELLAR_BAZAAR_ROOT="$ROOT" pnpm exec tsx test.ts \
    --facilitators=stellar-bazaar \
    --families=stellar \
    --schemes=exact \
    --extensions=bazaar \
    --servers=typescript/http/hono \
    --clients=typescript/http/fetch \
    --testnet \
    --output-json="$out" > "$log" 2>&1)
  set -e

  if [[ -f "$out" ]]; then
    passed=$(python3 -c "import json;print(json.load(open('$out'))['summary']['passed'])" 2>/dev/null || echo 0)
    failed=$(python3 -c "import json;print(json.load(open('$out'))['summary']['failed'])" 2>/dev/null || echo 1)
  else
    passed=0; failed=1
  fi

  if [[ "$failed" == "0" && "$passed" != "0" ]]; then
    pass=$((pass + 1))
    printf "  run %2d  PASS\n" "$i"
    rm -f "$log"
  else
    fail=$((fail + 1))
    failures+=("$i")
    printf "  run %2d  FAIL  (log kept: %s)\n" "$i" "$log"
    grep -oE "Unexpected end of JSON input|ECONNRESET|socket hang up|fetch failed" "$log" | sort -u | sed 's/^/          /' || true
  fi
done

echo
echo "  pass $pass / $((pass + fail))   fail $fail"
if [[ ${#failures[@]} -gt 0 ]]; then
  echo "  failing runs: ${failures[*]}"
  echo "  failure rate: $(python3 -c "print(f'{$fail/($pass+$fail)*100:.1f}%')")"
else
  echo "  failure rate: 0.0%"
fi
