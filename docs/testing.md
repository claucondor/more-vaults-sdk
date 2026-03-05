# Integration Tests

The `tests/` directory contains 4 TypeScript test suites that cover all 43 flows end-to-end against a local Anvil node. These tests use the same SDK functions that are exported for production use — no mocking of SDK internals.

## Test suites

| File | Library | Tests | Covers |
|------|---------|-------|--------|
| `test-flows.ts` | viem | 9 | D1, D2, R1, R2, R3, R4, D4, D5, R5 |
| `test-ethers-flows.ts` | ethers.js | 9 | D1, D2, R1, R2, R3, R4, D4, D5, R5 |
| `test-user-helpers.ts` | viem | 12 | getUserPosition, previewDeposit, canDeposit, getVaultMetadata |
| `test-ethers-user-helpers.ts` | ethers.js | 13 | getUserPosition, previewDeposit, canDeposit, getVaultMetadata, getWithdrawalTimelock |

## Prerequisites

- **Foundry** (forge + anvil): [install](https://getfoundry.sh/)
- **Node.js** ≥ 20
- Solidity dependencies (see below)

## Install Solidity dependencies

The `contracts/` directory contains the protocol source, mocks, and deploy script. The Foundry library dependencies are referenced as git submodules but not included in the repo.

```bash
cd contracts
git init
git submodule add https://github.com/foundry-rs/forge-std lib/forge-std
git submodule add https://github.com/openzeppelin/openzeppelin-contracts lib/openzeppelin-contracts
git submodule add https://github.com/openzeppelin/openzeppelin-contracts-upgradeable lib/openzeppelin-contracts-upgradeable
git submodule add https://github.com/vectorized/solady lib/solady
git submodule add https://github.com/LayerZero-Labs/LayerZero-v2 lib/LayerZero-v2
git submodule add https://github.com/layerzero-labs/devtools lib/devtools
git submodule add https://github.com/uniswap/v2-periphery lib/v2-periphery
git submodule add https://github.com/GNSPS/solidity-bytes-utils lib/solidity-bytes-utils
```

If you cloned this repo with `--recurse-submodules`, they're already there. Otherwise:

```bash
cd contracts && git submodule update --init --recursive
```

## Run all tests

From the repo root:

```bash
bash tests/run.sh
```

This will:
1. Install npm dependencies if needed
2. Start Anvil on port 8545
3. Build all Solidity contracts with Foundry
4. Deploy via `DeployLocalE2E.s.sol` and write `tests/addresses.json`
5. Run all 4 TypeScript test suites
6. Stop Anvil

Expected output:

```
[anvil] Starting Anvil...
[forge] Building contracts...
[forge] Deploying to Anvil...
[forge] Deployment complete.

[tsx] Running test-flows.ts...
  ✓ mints shares proportional to assets deposited
  ✓ deposits USDC + WETH and receives shares
  ✓ burns shares and returns underlying
  ...
Results: 9 passed, 0 failed

[tsx] Running test-ethers-flows.ts...
  ...
Results: 9 passed, 0 failed

[tsx] Running test-user-helpers.ts...
  ...
Results: 12 passed, 0 failed

[tsx] Running test-ethers-user-helpers.ts...
  ...
Results: 13 passed, 0 failed
```

## Run individual suites

```bash
# Start Anvil and deploy first
anvil --port 8545 --code-size-limit 30000 &
cd contracts && FOUNDRY_PROFILE=local_e2e forge script scripts/DeployLocalE2E.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast --disable-code-size-limit
cp contracts/addresses.json tests/addresses.json  # if not auto-copied

# Then run any suite
cd tests && npx tsx test-flows.ts
cd tests && npx tsx test-ethers-flows.ts
cd tests && npx tsx test-user-helpers.ts
cd tests && npx tsx test-ethers-user-helpers.ts
```

## What's mocked in tests vs mainnet

The tests use `MockERC20`, `MockOFT`, `MockOracleRegistry`, `MockCCManager`, and `MockEndpointV2` — none of these affect the SDK flows. The SDK calls the same functions as in production; only the contracts on the other end are simplified.

The async flows (D4, D5, R5) simulate the LayerZero callback by impersonating the `CCManager` address and calling `updateAccountingInfoForRequest` + `executeRequest` directly. This replaces the real ~1–5 min LZ round-trip.

| Component | In tests | In mainnet |
|-----------|----------|------------|
| Underlying token | MockERC20 (mintable) | Real USDC/token |
| Oracle | MockOracleRegistry | Chainlink / Pyth |
| LayerZero | MockEndpointV2 | Real LZ infrastructure |
| Cross-chain accounting | Simulated callback | ~1–5 min real LZ Read |
| LZ fees | Quoted from mock | Real native token fees |

## Adding new tests

Tests are plain TypeScript using a minimal `assert` + `test()` framework defined at the top of each file. No Jest or Vitest — this keeps the test runner zero-config.

```ts
await test('my new test', async () => {
  const result = await someSDKFunction(...)
  assert(result.shares > 0n, 'shares must be positive')
})
```

Use `snapshot()` / `revert()` (viem) or `provider.send('evm_snapshot', [])` (ethers) to isolate state between tests.
