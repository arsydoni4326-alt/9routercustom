#!/usr/bin/env bash
#
# test-health.sh — Phase 1.1 baseline test-health gate.
#
# Runs the vitest suite (from tests/) and checks the failures against the
# canonical no-regression baseline (tests/__baseline__/verify-no-regression.mjs).
#
# Exit codes:
#   0 — suite ran and no regression (every failure is in known-fails.txt)
#   1 — regression detected (a previously-green test now fails)
#   2 — precondition/usage error
#
# Lightweight: uses only node + jq + whatever vitest tests/ already has.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS_DIR="$ROOT/tests"
GATE="$ROOT/tests/__baseline__/verify-no-regression.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

RAW="$WORK/results.json"
NORMALIZED="$WORK/normalized.json"

echo "[test-health] root:      $ROOT"
echo "[test-health] tests dir: $TESTS_DIR"
echo "[test-health] gate:      $GATE"

# 1. Run the suite. Real-provider tests are skipped unless credentials exist.
#    Failing tests are expected here — the gate is the authority, not vitest's
#    exit code — so we must not let `set -e` abort before gating.
cd "$TESTS_DIR"
if ! npx vitest run --reporter=json --outputFile="$RAW" \
    --exclude '**/*.real.test.js'; then
  echo "[test-health] suite has failing tests (see gate verdict below)"
fi

# 2. Raw results summary.
jq '{passed: ([.testResults[].assertionResults[] | select(.status == "passed")] | length),
     failed: ([.testResults[].assertionResults[] | select(.status == "failed")] | length),
     skipped: ([.testResults[].assertionResults[] | select(.status == "skipped")] | length)}' "$RAW"

# 3. Normalize test file paths to the container-style /app/... shape the gate
#    expects. verify-no-regression.mjs builds keys as `f.name.split("/app/")[1]
#    :: fullName`, and the committed known-fails.txt keys are `tests/...` as seen
#    from a `/app` root. On a checkout the paths are absolute (/home/.../9router/
#    tests/...), so rewrite the repo root to /app (dots are escaped for the regex).
jq --arg root "$ROOT" \
  '.testResults |= map(.name |= sub("^" + ($root | gsub("\\."; "\\.")); "/app"))' \
  "$RAW" > "$NORMALIZED"

# 4. Canonical gate — its exit code becomes ours.
node "$GATE" "$NORMALIZED"
</content>
<task_progress>
- [x] Read TESTING.md baseline procedure
- [x] Read ROADMAP Phase 1.1 scope
- [x] Verify baseline artifacts exist
- [x] Read canonical gate (verify-no-regression.mjs)
- [x] Read known-fails.txt catalog (format + which tests allowed to fail)
- [x] Create scripts/test-health.sh
- [ ] Run smoke suite green
- [ ] Update docs (session.md, TESTING.md, ROADMAP)
</task_progress>
</｜｜DSML｜｜>