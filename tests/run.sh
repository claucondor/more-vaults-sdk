#!/usr/bin/env bash
# MoreVaults SDK — Local integration test runner
#
# Usage: bash tests/run.sh
#   from the repo root (more-vaults-sdk/)
#
# Prerequisites:
#   - Foundry (forge, anvil) installed
#   - Node.js >= 20 installed
#   - npm install done in repo root (npm install)
#   - Solidity deps installed: cd contracts && git submodule update --init --recursive

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="$ROOT/contracts"
TESTS_DIR="$ROOT/tests"
ANVIL_PORT=8545

# ── 1. Install TS dependencies if needed ────────────────────────────────────
if [ ! -d "$ROOT/node_modules" ]; then
  echo "[setup] Installing TypeScript dependencies..."
  (cd "$ROOT" && npm install --silent)
fi

# ── 2. Start Anvil ───────────────────────────────────────────────────────────
echo "[anvil] Starting Anvil on port $ANVIL_PORT..."
anvil --port "$ANVIL_PORT" --code-size-limit 30000 --silent &
ANVIL_PID=$!

sleep 1

# ── 3. Build contracts ───────────────────────────────────────────────────────
echo "[forge] Building contracts..."
(cd "$CONTRACTS_DIR" && forge build --silent)

# ── 4. Deploy via forge script ───────────────────────────────────────────────
echo "[forge] Deploying to Anvil..."
(cd "$CONTRACTS_DIR" && FOUNDRY_PROFILE=local_e2e forge script scripts/DeployLocalE2E.s.sol \
  --rpc-url "http://127.0.0.1:$ANVIL_PORT" \
  --broadcast \
  --disable-code-size-limit)

# Copy addresses.json to tests dir for TS tests
cp "$CONTRACTS_DIR/addresses.json" "$TESTS_DIR/addresses.json" 2>/dev/null || true

echo "[forge] Deployment complete."

# ── 5. Run TypeScript integration tests ─────────────────────────────────────
OVERALL_EXIT=0

run_suite() {
  local file="$1"
  echo ""
  echo "[tsx] Running $file..."
  (cd "$TESTS_DIR" && npx tsx "$file") || OVERALL_EXIT=1
}

run_suite test-flows.ts
run_suite test-ethers-flows.ts
run_suite test-user-helpers.ts
run_suite test-ethers-user-helpers.ts

# ── 6. Stop Anvil ────────────────────────────────────────────────────────────
echo "[anvil] Stopping Anvil (PID $ANVIL_PID)..."
kill "$ANVIL_PID" 2>/dev/null || true

exit $OVERALL_EXIT
