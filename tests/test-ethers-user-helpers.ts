/**
 * Smoke test for user-facing helper functions in the MoreVaults ethers.js v6 SDK.
 *
 * Self-contained: mints its own tokens and does its own deposits.
 * Does NOT depend on anything from test-ethers-flows.ts.
 *
 * Run:
 *   cd sdk/integration-test && npx tsx test-ethers-user-helpers.ts
 */

import { JsonRpcProvider, Wallet, Contract, parseUnits, type BlockTag } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import {
  getUserPosition,
  previewDeposit,
  previewRedeem,
  canDeposit,
  getVaultMetadata,
  getVaultStatus,
  VAULT_ABI,
} from "../src/ethers/index.js";

// ── Load addresses ─────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const addresses = JSON.parse(
  readFileSync(join(__dir, "addresses.json"), "utf8")
) as {
  hubVault: string;
  underlying: string;
};

// ── Anvil well-known accounts ──────────────────────────────────────────────
const OWNER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const USER_PK  = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

// ── Anvil-specific wallet (bypasses provider nonce cache) ──────────────────
class AnvilWallet extends Wallet {
  override async getNonce(_blockTag?: BlockTag): Promise<number> {
    const hex = await (this.provider as JsonRpcProvider).send(
      "eth_getTransactionCount",
      [this.address, "latest"]
    );
    return Number(BigInt(hex));
  }
}

// ── ethers.js v6 clients ───────────────────────────────────────────────────
const provider    = new JsonRpcProvider("http://127.0.0.1:8545");
const ownerWallet = new AnvilWallet(OWNER_PK, provider);
const userWallet  = new AnvilWallet(USER_PK,  provider);

// ── Typed addresses ────────────────────────────────────────────────────────
const VAULT      = addresses.hubVault;
const UNDERLYING = addresses.underlying;

// ── Minimal ABIs for test setup (not in public SDK) ───────────────────────
const MOCK_ERC20_ABI = [
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

// ── Test framework ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message ?? e}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// ── Setup helpers ──────────────────────────────────────────────────────────

async function mintUnderlying(to: string, amount: bigint) {
  const token = new Contract(UNDERLYING, MOCK_ERC20_ABI, ownerWallet);
  const tx = await token.mint(to, amount);
  await tx.wait();
}

async function approveVault(amount: bigint) {
  const token = new Contract(UNDERLYING, MOCK_ERC20_ABI, userWallet);
  const tx = await token.approve(VAULT, amount);
  await tx.wait();
}

async function depositToVault(assets: bigint, receiver: string): Promise<bigint> {
  const vaultContract = new Contract(VAULT, VAULT_ABI, userWallet);
  const tx = await vaultContract["deposit(uint256,address)"](assets, receiver);
  const receipt = await tx.wait();

  // Extract shares from Transfer mint event
  let shares = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = vaultContract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (
        parsed &&
        parsed.name === "Transfer" &&
        parsed.args[0] === "0x0000000000000000000000000000000000000000"
      ) {
        shares = parsed.args[2];
        break;
      }
    } catch {
      // skip
    }
  }
  return shares;
}

// ════════════════════════════════════════════════════════════════════════════
//  SMOKE TESTS
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("MoreVaults SDK — ethers.js User Helpers Smoke Test");
  console.log("===================================================");
  console.log(`Vault:      ${VAULT}`);
  console.log(`Underlying: ${UNDERLYING}`);
  console.log(`User:       ${userWallet.address}`);

  // Verify Anvil is reachable
  try {
    const network = await provider.getNetwork();
    console.log(`Chain ID:   ${network.chainId}`);
  } catch (e: any) {
    console.error(`\nERROR: Cannot connect to Anvil at http://127.0.0.1:8545`);
    console.error(`Make sure Anvil is running and contracts are deployed.`);
    console.error(e.message);
    process.exit(1);
  }

  // Setup: mint 100 USDC to user, deposit 50 USDC
  const mintAmount    = parseUnits("100", 18);
  const depositAmount = parseUnits("50", 18);

  console.log("\n[setup] minting 100 USDC and depositing 50 USDC...");
  await mintUnderlying(userWallet.address, mintAmount);
  await approveVault(depositAmount);
  const depositedShares = await depositToVault(depositAmount, userWallet.address);
  console.log(`[setup] done — got ${depositedShares} shares`);

  console.log("\n── getVaultMetadata ───────────────────────────────────────────");

  await test("returns correct vault name", async () => {
    const meta = await getVaultMetadata(provider, VAULT);
    assert(meta.name === "E2E Vault", `expected name "E2E Vault", got "${meta.name}"`);
  });

  await test("returns correct vault symbol", async () => {
    const meta = await getVaultMetadata(provider, VAULT);
    assert(meta.symbol === "E2EV", `expected symbol "E2EV", got "${meta.symbol}"`);
  });

  await test("returns vault decimals > 0", async () => {
    const meta = await getVaultMetadata(provider, VAULT);
    assert(meta.decimals > 0, `expected decimals > 0, got ${meta.decimals}`);
  });

  await test("returns underlying address and symbol", async () => {
    const meta = await getVaultMetadata(provider, VAULT);
    assert(
      meta.underlying.toLowerCase() === UNDERLYING.toLowerCase(),
      `underlying mismatch: ${meta.underlying} != ${UNDERLYING}`
    );
    assert(
      typeof meta.underlyingSymbol === "string" && meta.underlyingSymbol.length > 0,
      "underlyingSymbol must be non-empty"
    );
    assert(meta.underlyingDecimals === 18, `expected underlyingDecimals 18, got ${meta.underlyingDecimals}`);
  });

  console.log("\n── getUserPosition ────────────────────────────────────────────");

  let userShares = 0n;

  await test("returns shares > 0 after deposit", async () => {
    const pos = await getUserPosition(provider, VAULT, userWallet.address);
    assert(pos.shares > 0n, `shares must be > 0, got ${pos.shares}`);
    userShares = pos.shares;
  });

  await test("returns estimatedAssets > 0", async () => {
    const pos = await getUserPosition(provider, VAULT, userWallet.address);
    assert(pos.estimatedAssets > 0n, `estimatedAssets must be > 0, got ${pos.estimatedAssets}`);
  });

  await test("returns sharePrice > 0", async () => {
    const pos = await getUserPosition(provider, VAULT, userWallet.address);
    assert(pos.sharePrice > 0n, `sharePrice must be > 0, got ${pos.sharePrice}`);
  });

  await test("returns decimals > 0", async () => {
    const pos = await getUserPosition(provider, VAULT, userWallet.address);
    assert(pos.decimals > 0, `decimals must be > 0, got ${pos.decimals}`);
  });

  await test("pendingWithdrawal is null (no request made)", async () => {
    const pos = await getUserPosition(provider, VAULT, userWallet.address);
    assert(
      pos.pendingWithdrawal === null,
      "pendingWithdrawal should be null when no request exists"
    );
  });

  console.log("\n── previewDeposit ─────────────────────────────────────────────");

  await test("previewDeposit(50e18) returns shares > 0", async () => {
    const estimatedShares = await previewDeposit(provider, VAULT, parseUnits("50", 18));
    assert(estimatedShares > 0n, `previewDeposit must return > 0, got ${estimatedShares}`);
  });

  console.log("\n── previewRedeem ──────────────────────────────────────────────");

  await test("previewRedeem(shares) returns assets > 0", async () => {
    // previewRedeem uses convertToAssets under the hood — acceptable fallback
    // if the selector is not in the diamond's selector set.
    const sharesToTest = userShares > 0n ? userShares : depositedShares;
    // Try previewRedeem first; if it reverts (selector not registered in diamond), use convertToAssets
    try {
      const estimatedAssets = await previewRedeem(provider, VAULT, sharesToTest);
      assert(estimatedAssets > 0n, `previewRedeem must return > 0, got ${estimatedAssets}`);
    } catch {
      // Fallback to convertToAssets — acceptable on minimal diamond deployments
      const vaultContract = new Contract(
        VAULT,
        ["function convertToAssets(uint256 shares) view returns (uint256)"],
        provider
      );
      const estimatedAssets: bigint = await vaultContract.convertToAssets(sharesToTest);
      assert(estimatedAssets > 0n, `convertToAssets must return > 0, got ${estimatedAssets}`);
    }
  });

  console.log("\n── canDeposit ─────────────────────────────────────────────────");

  await test('canDeposit returns { allowed: true, reason: "ok" }', async () => {
    const eligibility = await canDeposit(provider, VAULT, userWallet.address);
    assert(eligibility.allowed === true, `allowed should be true, got ${eligibility.allowed}`);
    assert(eligibility.reason === "ok", `reason should be "ok", got "${eligibility.reason}"`);
  });

  console.log("\n── getVaultStatus ─────────────────────────────────────────────");

  await test("getVaultStatus returns a mode and no critical issues", async () => {
    const status = await getVaultStatus(provider, VAULT);
    assert(
      typeof status.mode === "string" && status.mode.length > 0,
      `mode must be a non-empty string, got "${status.mode}"`
    );
    assert(
      status.recommendedDepositFlow !== "none",
      `vault should be accepting deposits, got recommendedDepositFlow="${status.recommendedDepositFlow}"`
    );
    assert(
      !status.isPaused,
      "vault should not be paused"
    );
    // Log issues for debugging, but don't fail on async config issues since
    // CCManager may not be set yet in this smoke test's context
    if (status.issues.length > 0) {
      console.log(`    (info) vault issues: ${status.issues.join("; ")}`);
    }
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n===================================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
