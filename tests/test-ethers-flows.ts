/**
 * MoreVaults SDK — ethers.js v6 Integration Tests
 *
 * Mirrors test-flows.ts but uses ethers.js v6 instead of viem.
 *
 * Requires a running Anvil node with DeployLocalE2E.s.sol already broadcast:
 *   anvil &
 *   forge script scripts/DeployLocalE2E.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 *   npx tsx test-ethers-flows.ts
 *
 * Covered:
 *   D1  depositSimple
 *   D2  depositMultiAsset
 *   R1  redeemShares
 *   R2  withdrawAssets
 *   R3  requestRedeem (no timelock)
 *   R4  requestRedeem + timelock
 *   D4  depositAsync  (simulated LZ callback)
 *   D5  mintAsync     (simulated LZ callback)
 *   R5  redeemAsync   (simulated LZ callback)
 */

import { JsonRpcProvider, Wallet, Contract, parseUnits, ZeroAddress, type BlockTag } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── SDK flows (ethers) ──────────────────────────────────────────────────────
import {
  depositSimple,
  depositMultiAsset,
  depositAsync,
  mintAsync,
} from "../src/ethers/depositFlows.js";
import {
  redeemShares,
  withdrawAssets,
  requestRedeem,
  getWithdrawalRequest,
  redeemAsync,
} from "../src/ethers/redeemFlows.js";
import { quoteLzFee } from "../src/ethers/utils.js";

// ── Load addresses written by DeployLocalE2E.s.sol ─────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const addresses = JSON.parse(
  readFileSync(join(__dir, "addresses.json"), "utf8")
) as {
  hubVault: string;
  escrow: string;
  underlying: string;
  weth: string;
  ccManager: string;
  factory: string;
  shareOFT: string;
  composer: string;
  oracleRegistry: string;
};

// ── Anvil well-known accounts ──────────────────────────────────────────────
const OWNER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const USER_PK  = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

// ── Anvil-specific wallet ──────────────────────────────────────────────────
// ethers.js v6 caches eth_getTransactionCount results per block number.
// In Anvil automine mode, the provider's internal block-number cache may not
// have updated yet when we call getNonce() immediately after tx.wait(), so
// both "pending" and "latest" return a stale 0. Using a raw provider.send()
// bypasses the provider cache entirely and gets the true on-chain nonce.
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
const provider   = new JsonRpcProvider("http://127.0.0.1:8545");
const ownerWallet = new AnvilWallet(OWNER_PK, provider);
const userWallet  = new AnvilWallet(USER_PK,  provider);
const OWNER_ADDR = ownerWallet.address;
const USER_ADDR  = userWallet.address;

// ── Typed addresses ────────────────────────────────────────────────────────
const VAULT      = addresses.hubVault;
const ESCROW     = addresses.escrow;
const UNDERLYING = addresses.underlying;
const WETH       = addresses.weth;
const CC_MANAGER = addresses.ccManager;
const FACTORY    = addresses.factory;

// LZ EIDs used in DeployLocalE2E (must match)
const HUB_EID   = 30332;
const SPOKE_EID  = 30110;
const FAKE_SPOKE = "0x5afe5afE5afE5afE5afE5aFe5aFe5Afe5Afe5AfE";

const vaultAddrs = { vault: VAULT, escrow: ESCROW };

// ── Minimal ABIs for test helpers (not in the public SDK) ─────────────────
const MOCK_ERC20_ABI = [
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
] as const;

const ADMIN_CONFIG_ABI = [
  "function setCrossChainAccountingManager(address manager)",
  "function updateWithdrawalQueueStatus(bool status)",
  "function setWithdrawalTimelock(uint64 timelock)",
  "function addAvailableAsset(address asset)",
  "function enableAssetToDeposit(address asset)",
] as const;

const ADMIN_BRIDGE_ABI = [
  "function updateAccountingInfoForRequest(bytes32 guid, uint256 spokeUsdValue, bool success)",
  "function executeRequest(bytes32 guid)",
] as const;

// VaultsFactoryHarnessV2.exposed_addSpoke — no access control (test harness only)
const FACTORY_HARNESS_ABI = [
  "function exposed_addSpoke(uint32 hubEid, address hubVault, uint32 spokeEid, address spokeVault)",
] as const;

const QUERY_CONFIG_ABI = [
  "function isAssetAvailable(address asset) view returns (bool)",
  "function isAssetDepositable(address asset) view returns (bool)",
  "function getCrossChainAccountingManager() view returns (address)",
] as const;

const BALANCE_ABI = [
  "function balanceOf(address account) view returns (uint256)",
] as const;

// ── Test framework ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${e.message ?? e}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// ── Snapshot / revert helpers ─────────────────────────────────────────────

async function snapshot(): Promise<string> {
  return provider.send("evm_snapshot", []);
}

async function revert(id: string): Promise<void> {
  await provider.send("evm_revert", [id]);
}

// ── Test helpers ──────────────────────────────────────────────────────────

/** Mint mock tokens to an address (owner calls MockERC20.mint) */
async function mintUnderlying(to: string, amount: bigint) {
  const token = new Contract(UNDERLYING, MOCK_ERC20_ABI, ownerWallet);
  const tx = await token.mint(to, amount);
  await tx.wait();
}

async function mintWeth(to: string, amount: bigint) {
  const token = new Contract(WETH, MOCK_ERC20_ABI, ownerWallet);
  const tx = await token.mint(to, amount);
  await tx.wait();
}

/**
 * Execute a contract write while impersonating `as`.
 * Uses Anvil impersonation — no private key needed.
 */
async function writeAs(
  as: string,
  address: string,
  abi: readonly string[],
  functionName: string,
  args: unknown[]
): Promise<void> {
  // Set balance so impersonated account has gas
  await provider.send("anvil_setBalance", [as, "0xDE0B6B3A7640000"]);
  await provider.send("anvil_impersonateAccount", [as]);

  const signer = await provider.getSigner(as);
  const contract = new Contract(address, abi, signer);
  const tx = await contract[functionName](...args);
  await tx.wait();

  await provider.send("anvil_stopImpersonatingAccount", [as]);
  // Reset ETH balance to 0 — the vault's ETH is counted as WETH in totalAssets() via selfbalance()
  await provider.send("anvil_setBalance", [as, "0x0"]);
}

/**
 * One-time setup: set the cross-chain accounting manager on the vault.
 * Requires msg.sender == vault (diamond self-call), so we impersonate.
 */
async function setupCCManager() {
  await writeAs(VAULT, VAULT, ADMIN_CONFIG_ABI, "setCrossChainAccountingManager", [CC_MANAGER]);
}

/**
 * Register a fake spoke so the vault appears cross-chain — required before
 * any async flow (D4/D5/R5). VaultsFactoryHarnessV2.exposed_addSpoke has no ACL.
 */
async function registerFakeSpoke() {
  const factory = new Contract(FACTORY, FACTORY_HARNESS_ABI, ownerWallet);
  const tx = await factory.exposed_addSpoke(HUB_EID, VAULT, SPOKE_EID, FAKE_SPOKE);
  await tx.wait();
}

/**
 * Simulate the LZ Read callback that resolves an async request.
 * In production this is called by LzAdapter; here we call it as ccManager.
 */
async function simulateLzCallback(guid: string, spokeUsdValue: bigint = 0n) {
  await provider.send("anvil_setBalance", [CC_MANAGER, "0xDE0B6B3A7640000"]);
  await provider.send("anvil_impersonateAccount", [CC_MANAGER]);

  const ccManagerSigner = await provider.getSigner(CC_MANAGER);
  const bridge = new Contract(VAULT, ADMIN_BRIDGE_ABI, ccManagerSigner);

  let tx = await bridge.updateAccountingInfoForRequest(guid, spokeUsdValue, true);
  await tx.wait();

  tx = await bridge.executeRequest(guid);
  await tx.wait();

  await provider.send("anvil_stopImpersonatingAccount", [CC_MANAGER]);
}

// ════════════════════════════════════════════════════════════════════════════
//  ONE-TIME SETUP
// ════════════════════════════════════════════════════════════════════════════

async function oneTimeSetup() {
  // Set ccManager (needed for async flows D4/D5/R5) — idempotent (just overwrites)
  await setupCCManager();

  const queryConfig = new Contract(VAULT, QUERY_CONFIG_ABI, provider);

  // Register weth as available + depositable asset (needed for D2 multi-asset)
  // Guard against re-running on a warm Anvil (AssetAlreadyAvailable error)
  const wethAvailable: boolean = await queryConfig.isAssetAvailable(WETH);
  if (!wethAvailable) {
    const factory = new Contract(VAULT, ADMIN_CONFIG_ABI, ownerWallet);
    const tx = await factory.addAvailableAsset(WETH);
    await tx.wait();
  }

  const wethDepositable: boolean = await queryConfig.isAssetDepositable(WETH);
  if (!wethDepositable) {
    // enableAssetToDeposit requires validateDiamond — must impersonate vault (self-call)
    await writeAs(VAULT, VAULT, ADMIN_CONFIG_ABI, "enableAssetToDeposit", [WETH]);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  TESTS
// ════════════════════════════════════════════════════════════════════════════

async function runDepositTests() {
  console.log("\n── D1: depositSimple ──────────────────────────────────────────");

  let snap = await snapshot();
  await test("mints shares proportional to assets deposited", async () => {
    const assets = parseUnits("100", 18);
    await mintUnderlying(USER_ADDR, assets);

    const { shares, receipt } = await depositSimple(userWallet, vaultAddrs, assets, USER_ADDR);

    assert(shares > 0n, `shares must be > 0, got ${shares}`);
    assert(receipt !== null, "receipt must not be null");

    const vaultContract = new Contract(VAULT, BALANCE_ABI, provider);
    const balance: bigint = await vaultContract.balanceOf(USER_ADDR);
    assert(balance === shares, `vault share balance ${balance} != returned shares ${shares}`);
  });
  await revert(snap);

  console.log("\n── D2: depositMultiAsset ──────────────────────────────────────");

  snap = await snapshot();
  await test("deposits USDC + WETH and receives shares", async () => {
    const usdcAmt = parseUnits("100", 18);
    const wethAmt = parseUnits("0.05", 18);
    await mintUnderlying(USER_ADDR, usdcAmt);
    await mintWeth(USER_ADDR, wethAmt);

    const { shares } = await depositMultiAsset(
      userWallet,
      vaultAddrs,
      [UNDERLYING, WETH],
      [usdcAmt, wethAmt],
      USER_ADDR,
      0n // minShares — no slippage protection for test
    );

    assert(shares > 0n, `shares must be > 0, got ${shares}`);
    // With 100 USDC ($100) + 0.05 WETH ($100), expect ~200 shares
    assert(shares >= parseUnits("150", 18), `expected >= 150 shares, got ${shares}`);
  });
  await revert(snap);
}

async function runRedeemTests() {
  console.log("\n── R1: redeemShares ───────────────────────────────────────────");

  let snap = await snapshot();
  await test("burns shares and returns underlying", async () => {
    const assets = parseUnits("100", 18);
    await mintUnderlying(USER_ADDR, assets);
    const { shares } = await depositSimple(userWallet, vaultAddrs, assets, USER_ADDR);

    const tokenContract = new Contract(UNDERLYING, MOCK_ERC20_ABI, provider);
    const underlyingBefore: bigint = await tokenContract.balanceOf(USER_ADDR);

    const { assets: assetsOut } = await redeemShares(
      userWallet,
      vaultAddrs,
      shares,
      USER_ADDR,
      USER_ADDR
    );

    const underlyingAfter: bigint = await tokenContract.balanceOf(USER_ADDR);
    assert(assetsOut > 0n, "assets out must be > 0");
    assert(underlyingAfter > underlyingBefore, "underlying balance must increase after redeem");
  });
  await revert(snap);

  console.log("\n── R2: withdrawAssets ─────────────────────────────────────────");

  snap = await snapshot();
  await test("burns exact shares to withdraw requested assets", async () => {
    const depositAmt = parseUnits("200", 18);
    await mintUnderlying(USER_ADDR, depositAmt);
    await depositSimple(userWallet, vaultAddrs, depositAmt, USER_ADDR);

    const withdrawAmt = parseUnits("100", 18);
    const { assets } = await withdrawAssets(
      userWallet,
      vaultAddrs,
      withdrawAmt,
      USER_ADDR,
      USER_ADDR
    );

    assert(assets === withdrawAmt, `assets ${assets} != requested ${withdrawAmt}`);
  });
  await revert(snap);

  console.log("\n── R3: requestRedeem (no timelock) ────────────────────────────");

  snap = await snapshot();
  await test("queues shares then redeems immediately", async () => {
    // Enable withdrawal queue (msg.sender must == vault)
    await writeAs(VAULT, VAULT, ADMIN_CONFIG_ABI, "updateWithdrawalQueueStatus", [true]);

    const assets = parseUnits("100", 18);
    await mintUnderlying(USER_ADDR, assets);
    const { shares } = await depositSimple(userWallet, vaultAddrs, assets, USER_ADDR);

    await requestRedeem(userWallet, vaultAddrs, shares, USER_ADDR);

    const req = await getWithdrawalRequest(provider, VAULT, USER_ADDR);
    assert(req !== null, "withdrawal request should exist");
    assert(req!.shares === shares, `queued shares ${req!.shares} != ${shares}`);

    // Redeem immediately (no timelock set)
    const { assets: assetsOut } = await redeemShares(
      userWallet,
      vaultAddrs,
      shares,
      USER_ADDR,
      USER_ADDR
    );
    assert(assetsOut > 0n, "assets out must be > 0");
  });
  await revert(snap);

  console.log("\n── R4: requestRedeem + timelock ───────────────────────────────");

  snap = await snapshot();
  await test("blocks redeem before timelock expires, allows after", async () => {
    await writeAs(VAULT, VAULT, ADMIN_CONFIG_ABI, "updateWithdrawalQueueStatus", [true]);
    await writeAs(VAULT, VAULT, ADMIN_CONFIG_ABI, "setWithdrawalTimelock", [BigInt(3600)]); // 1 hour

    const assets = parseUnits("100", 18);
    await mintUnderlying(USER_ADDR, assets);
    const { shares } = await depositSimple(userWallet, vaultAddrs, assets, USER_ADDR);

    await requestRedeem(userWallet, vaultAddrs, shares, USER_ADDR);

    // Should revert before timelock
    let reverted = false;
    try {
      await redeemShares(userWallet, vaultAddrs, shares, USER_ADDR, USER_ADDR);
    } catch {
      reverted = true;
    }
    assert(reverted, "redeem should revert before timelock expires");

    // Advance time past timelock
    await provider.send("evm_increaseTime", [3601]);
    await provider.send("evm_mine", []);

    // Should succeed now
    const { assets: assetsOut } = await redeemShares(
      userWallet,
      vaultAddrs,
      shares,
      USER_ADDR,
      USER_ADDR
    );
    assert(assetsOut > 0n, "assets out must be > 0 after timelock");
  });
  await revert(snap);
}

async function runAsyncTests() {
  console.log("\n── D4: depositAsync ───────────────────────────────────────────");

  let snap = await snapshot();
  await test("locks assets in escrow, mints shares after simulated callback", async () => {
    // Register a fake spoke so the vault is seen as cross-chain (required for async flows).
    await registerFakeSpoke();

    const assets = parseUnits("100", 18);
    await mintUnderlying(USER_ADDR, assets);

    const lzFee = await quoteLzFee(provider, VAULT);
    const { guid } = await depositAsync(userWallet, vaultAddrs, assets, USER_ADDR, lzFee);

    // Shares not yet minted
    const vaultContract = new Contract(VAULT, BALANCE_ABI, provider);
    const sharesBefore: bigint = await vaultContract.balanceOf(USER_ADDR);
    assert(sharesBefore === 0n, "shares should be 0 before callback");

    // Simulate LZ Read response (spoke has $0 — all assets are on hub)
    await simulateLzCallback(guid, 0n);

    const sharesAfter: bigint = await vaultContract.balanceOf(USER_ADDR);
    assert(sharesAfter > 0n, `shares must be > 0 after callback, got ${sharesAfter}`);
  });
  await revert(snap);

  console.log("\n── D5: mintAsync ──────────────────────────────────────────────");

  snap = await snapshot();
  await test("mints exact shares by spending up to maxAssets", async () => {
    await registerFakeSpoke();

    const maxAssets  = parseUnits("200", 18); // give budget
    const wantShares = parseUnits("100", 18); // ask for this many shares
    await mintUnderlying(USER_ADDR, maxAssets);

    const lzFee = await quoteLzFee(provider, VAULT);
    const { guid } = await mintAsync(
      userWallet,
      vaultAddrs,
      wantShares,
      maxAssets,
      USER_ADDR,
      lzFee
    );

    await simulateLzCallback(guid, 0n);

    const vaultContract = new Contract(VAULT, BALANCE_ABI, provider);
    const sharesAfter: bigint = await vaultContract.balanceOf(USER_ADDR);
    assert(sharesAfter > 0n, `shares must be > 0 after mint, got ${sharesAfter}`);
  });
  await revert(snap);

  console.log("\n── R5: redeemAsync ────────────────────────────────────────────");

  snap = await snapshot();
  await test("locks shares in escrow, returns assets after simulated callback", async () => {
    // Step 1: sync deposit while vault is still local (no spoke) to acquire shares
    const initialDeposit = parseUnits("200", 18);
    await mintUnderlying(USER_ADDR, initialDeposit);
    const { shares } = await depositSimple(userWallet, vaultAddrs, initialDeposit, USER_ADDR);
    assert(shares > 0n, "setup: shares must be > 0");

    // Step 2: register the fake spoke (makes vault cross-chain, enables async redeem)
    await registerFakeSpoke();

    const tokenContract = new Contract(UNDERLYING, MOCK_ERC20_ABI, provider);
    const underlyingBefore: bigint = await tokenContract.balanceOf(USER_ADDR);

    const lzFee = await quoteLzFee(provider, VAULT);
    const { guid } = await redeemAsync(
      userWallet,
      vaultAddrs,
      shares,
      USER_ADDR,
      USER_ADDR,
      lzFee
    );

    // Assets not yet returned
    const underlyingMid: bigint = await tokenContract.balanceOf(USER_ADDR);
    assert(underlyingMid === underlyingBefore, "underlying must not change before callback");

    await simulateLzCallback(guid, 0n);

    const underlyingAfter: bigint = await tokenContract.balanceOf(USER_ADDR);
    assert(underlyingAfter > underlyingBefore, "underlying must increase after async redeem callback");
  });
  await revert(snap);
}

// ════════════════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("MoreVaults SDK ethers.js v6 Integration Tests");
  console.log("=============================================");
  console.log(`Hub vault:  ${VAULT}`);
  console.log(`Underlying: ${UNDERLYING}`);
  console.log(`ccManager:  ${CC_MANAGER}`);

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

  // One-time setup (persistent — sets ccManager and registers weth)
  console.log("\n[setup] configuring vault...");
  await oneTimeSetup();
  console.log("[setup] done");

  await runDepositTests();
  await runRedeemTests();
  await runAsyncTests();

  console.log(`\n=============================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
