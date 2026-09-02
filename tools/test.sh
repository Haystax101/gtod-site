#!/usr/bin/env bash
# Run a TypeScript test file that imports Convex modules.
#
# Node's ESM resolver will not add a `.ts` extension, and Convex source uses
# extensionless imports (`from './tiers'`), so `node --experimental-strip-types`
# fails on any test that reaches into convex/. Bundling with esbuild resolves
# the whole graph first, which keeps the source convention intact and means a
# test exercises exactly the code that ships.
#
#   tools/test.sh tools/voice/budget.test.ts
#   tools/test.sh                              # runs every *.test.ts under tools/
set -euo pipefail
cd "$(dirname "$0")/.."

run_one() {
  local src="$1"
  local out
  out="$(mktemp -t gtodtest.XXXXXX.mjs)"
  # `process.env` reads at module load need a real object, hence platform=node.
  ./node_modules/.bin/esbuild "$src" --bundle --platform=node --format=esm \
    --log-level=warning --outfile="$out"
  node "$out"
  local code=$?
  rm -f "$out"
  return $code
}

if [ $# -gt 0 ]; then
  run_one "$1"
else
  status=0
  while IFS= read -r f; do
    echo "=============================================================="
    echo "$f"
    echo "=============================================================="
    run_one "$f" || status=1
  done < <(find tools -name '*.test.ts' | sort)
  exit $status
fi
