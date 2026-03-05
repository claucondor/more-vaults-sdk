/**
 * MoreVaults SDK — viem Integration Tests
 *
 * Requires a running Anvil node with DeployLocalE2E.s.sol already broadcast:
 *   anvil --disable-code-size-limit &
 *   forge script scripts/DeployLocalE2E.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --disable-code-size-limit
 *   npx tsx test-flows.ts
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

import {
  createPublicClient,
  createWalletClient,
  createTestClient,
  http,
  parseUnits,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// ── SDK flows (viem) ────────────────────────────────────────────────────────
import {
  depositSimple,
  depositMultiAsset,
  depositAsync,
  mintAsync,
} from '../src/viem/depositFlows.js'
import {
  redeemShares,
  withdrawAssets,
  requestRedeem,
  getWithdrawalRequest,
  redeemAsync,
} from '../src/viem/redeemFlows.js'
import { quoteLzFee } from '../src/viem/utils.js'

// ── Load addresses written by DeployLocalE2E.s.sol ─────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const addresses = JSON.parse(
  readFileSync(join(__dir, 'addresses.json'), 'utf8')
) as {
  hubVault: string
  escrow: string
  underlying: string
  weth: string
  ccManager: string
  factory: string
  shareOFT: string
  composer: string
  oracleRegistry: string
}

// ── Anvil well-known accounts ───────────────────────────────────────────────
const OWNER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const USER_PK  = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'

const ownerAccount = privateKeyToAccount(OWNER_PK)
const userAccount  = privateKeyToAccount(USER_PK)

// ── viem clients ────────────────────────────────────────────────────────────
const transport   = http('http://127.0.0.1:8545')
const chain       = { ...anvil, id: 31337 }
const publicClient = createPublicClient({ chain, transport })
const testClient   = createTestClient({ chain, transport, mode: 'anvil' })
const ownerWallet = createWalletClient({ account: ownerAccount, chain, transport })
const userWallet  = createWalletClient({ account: userAccount,  chain, transport })

// ── Typed addresses ────────────────────────────────────────────────────────
const VAULT      = addresses.hubVault      as `0x${string}`
const ESCROW     = addresses.escrow        as `0x${string}`
const UNDERLYING = addresses.underlying   as `0x${string}`
const WETH       = addresses.weth         as `0x${string}`
const CC_MANAGER = addresses.ccManager    as `0x${string}`
const FACTORY    = addresses.factory      as `0x${string}`

// LZ EIDs used in DeployLocalE2E (must match)
const HUB_EID   = 30332
const SPOKE_EID = 30110
const FAKE_SPOKE = '0x5afe5afE5afE5afE5afE5aFe5aFe5Afe5Afe5AfE' as `0x${string}`

const vaultAddrs = { vault: VAULT, escrow: ESCROW }

// ── Minimal ABIs for test helpers ──────────────────────────────────────────
const MOCK_ERC20_ABI = parseAbi([
  'function mint(address to, uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
])

const ADMIN_CONFIG_ABI = parseAbi([
  'function setCrossChainAccountingManager(address manager)',
  'function updateWithdrawalQueueStatus(bool status)',
  'function setWithdrawalTimelock(uint64 timelock)',
  'function addAvailableAsset(address asset)',
  'function enableAssetToDeposit(address asset)',
])

const ADMIN_BRIDGE_ABI = parseAbi([
  'function updateAccountingInfoForRequest(bytes32 guid, uint256 spokeUsdValue, bool success)',
  'function executeRequest(bytes32 guid)',
])

const FACTORY_HARNESS_ABI = parseAbi([
  'function exposed_addSpoke(uint32 hubEid, address hubVault, uint32 spokeEid, address spokeVault)',
])

const QUERY_CONFIG_ABI = parseAbi([
  'function isAssetAvailable(address asset) view returns (bool)',
  'function isAssetDepositable(address asset) view returns (bool)',
])

const VAULT_BALANCE_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
])

// ── Test framework ─────────────────────────────────────────────────────────
let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (e: any) {
    console.log(`  ✗ ${name}`)
    console.log(`      ${e.message ?? e}`)
    failed++
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`)
}

// ── Snapshot / revert helpers ─────────────────────────────────────────────

async function snapshot(): Promise<`0x${string}`> {
  return testClient.snapshot()
}

async function revert(id: `0x${string}`): Promise<void> {
  await testClient.revert({ id })
}

// ── Test helpers ──────────────────────────────────────────────────────────

async function mintUnderlying(to: `0x${string}`, amount: bigint) {
  await testClient.impersonateAccount({ address: ownerAccount.address })
  await testClient.setBalance({ address: ownerAccount.address, value: parseUnits('10', 18) })
  const hash = await ownerWallet.writeContract({
    address: UNDERLYING,
    abi: MOCK_ERC20_ABI,
    functionName: 'mint',
    args: [to, amount],
    chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  await testClient.stopImpersonatingAccount({ address: ownerAccount.address })
}

async function mintWeth(to: `0x${string}`, amount: bigint) {
  const hash = await ownerWallet.writeContract({
    address: WETH,
    abi: MOCK_ERC20_ABI,
    functionName: 'mint',
    args: [to, amount],
    chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

async function writeAs(
  as: `0x${string}`,
  address: `0x${string}`,
  abi: any,
  functionName: string,
  args: unknown[]
): Promise<void> {
  await testClient.setBalance({ address: as, value: parseUnits('10', 18) })
  await testClient.impersonateAccount({ address: as })
  const impWallet = createWalletClient({ account: as, chain, transport })
  const hash = await impWallet.writeContract({
    address,
    abi,
    functionName,
    args,
    chain,
  } as any)
  await publicClient.waitForTransactionReceipt({ hash })
  await testClient.stopImpersonatingAccount({ address: as })
  await testClient.setBalance({ address: as, value: 0n })
}

async function setupCCManager() {
  await writeAs(VAULT, VAULT, ADMIN_CONFIG_ABI, 'setCrossChainAccountingManager', [CC_MANAGER])
}

async function registerFakeSpoke() {
  const hash = await ownerWallet.writeContract({
    address: FACTORY,
    abi: FACTORY_HARNESS_ABI,
    functionName: 'exposed_addSpoke',
    args: [HUB_EID, VAULT, SPOKE_EID, FAKE_SPOKE],
    chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

async function simulateLzCallback(guid: `0x${string}`, spokeUsdValue: bigint = 0n) {
  await testClient.setBalance({ address: CC_MANAGER, value: parseUnits('10', 18) })
  await testClient.impersonateAccount({ address: CC_MANAGER })
  const ccWallet = createWalletClient({ account: CC_MANAGER, chain, transport })

  let hash = await ccWallet.writeContract({
    address: VAULT,
    abi: ADMIN_BRIDGE_ABI,
    functionName: 'updateAccountingInfoForRequest',
    args: [guid, spokeUsdValue, true],
    chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })

  hash = await ccWallet.writeContract({
    address: VAULT,
    abi: ADMIN_BRIDGE_ABI,
    functionName: 'executeRequest',
    args: [guid],
    chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })

  await testClient.stopImpersonatingAccount({ address: CC_MANAGER })
}

// ════════════════════════════════════════════════════════════════════════════
//  ONE-TIME SETUP
// ════════════════════════════════════════════════════════════════════════════

async function oneTimeSetup() {
  await setupCCManager()

  const wethAvailable = await publicClient.readContract({
    address: VAULT, abi: QUERY_CONFIG_ABI, functionName: 'isAssetAvailable', args: [WETH],
  })
  if (!wethAvailable) {
    const hash = await ownerWallet.writeContract({
      address: VAULT, abi: ADMIN_CONFIG_ABI, functionName: 'addAvailableAsset', args: [WETH], chain,
    })
    await publicClient.waitForTransactionReceipt({ hash })
  }

  const wethDepositable = await publicClient.readContract({
    address: VAULT, abi: QUERY_CONFIG_ABI, functionName: 'isAssetDepositable', args: [WETH],
  })
  if (!wethDepositable) {
    await writeAs(VAULT, VAULT, ADMIN_CONFIG_ABI, 'enableAssetToDeposit', [WETH])
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  TESTS
// ════════════════════════════════════════════════════════════════════════════

async function runDepositTests() {
  console.log('\n── D1: depositSimple ──────────────────────────────────────────')

  let snap = await snapshot()
  await test('mints shares proportional to assets deposited', async () => {
    const assets = parseUnits('100', 18)
    await mintUnderlying(userAccount.address, assets)

    const { shares } = await depositSimple(userWallet, publicClient, vaultAddrs, assets, userAccount.address)

    assert(shares > 0n, `shares must be > 0, got ${shares}`)

    const balance = await publicClient.readContract({
      address: VAULT, abi: VAULT_BALANCE_ABI, functionName: 'balanceOf', args: [userAccount.address],
    })
    assert(balance === shares, `vault share balance ${balance} != returned shares ${shares}`)
  })
  await revert(snap)

  console.log('\n── D2: depositMultiAsset ──────────────────────────────────────')

  snap = await snapshot()
  await test('deposits USDC + WETH and receives shares', async () => {
    const usdcAmt = parseUnits('100', 18)
    const wethAmt = parseUnits('0.05', 18)
    await mintUnderlying(userAccount.address, usdcAmt)
    await mintWeth(userAccount.address, wethAmt)

    const { shares } = await depositMultiAsset(
      userWallet, publicClient, vaultAddrs,
      [UNDERLYING, WETH], [usdcAmt, wethAmt],
      userAccount.address, 0n
    )

    assert(shares > 0n, `shares must be > 0, got ${shares}`)
    assert(shares >= parseUnits('150', 18), `expected >= 150 shares, got ${shares}`)
  })
  await revert(snap)
}

async function runRedeemTests() {
  console.log('\n── R1: redeemShares ───────────────────────────────────────────')

  let snap = await snapshot()
  await test('burns shares and returns underlying', async () => {
    const assets = parseUnits('100', 18)
    await mintUnderlying(userAccount.address, assets)
    const { shares } = await depositSimple(userWallet, publicClient, vaultAddrs, assets, userAccount.address)

    const underlyingBefore = await publicClient.readContract({
      address: UNDERLYING, abi: MOCK_ERC20_ABI, functionName: 'balanceOf', args: [userAccount.address],
    })

    const { assets: assetsOut } = await redeemShares(
      userWallet, publicClient, vaultAddrs, shares, userAccount.address, userAccount.address
    )

    const underlyingAfter = await publicClient.readContract({
      address: UNDERLYING, abi: MOCK_ERC20_ABI, functionName: 'balanceOf', args: [userAccount.address],
    })
    assert(assetsOut > 0n, 'assets out must be > 0')
    assert(underlyingAfter > underlyingBefore, 'underlying balance must increase after redeem')
  })
  await revert(snap)

  console.log('\n── R2: withdrawAssets ─────────────────────────────────────────')

  snap = await snapshot()
  await test('burns exact shares to withdraw requested assets', async () => {
    const depositAmt = parseUnits('200', 18)
    await mintUnderlying(userAccount.address, depositAmt)
    await depositSimple(userWallet, publicClient, vaultAddrs, depositAmt, userAccount.address)

    const withdrawAmt = parseUnits('100', 18)
    const { assets } = await withdrawAssets(
      userWallet, publicClient, vaultAddrs, withdrawAmt, userAccount.address, userAccount.address
    )

    assert(assets === withdrawAmt, `assets ${assets} != requested ${withdrawAmt}`)
  })
  await revert(snap)

  console.log('\n── R3: requestRedeem (no timelock) ────────────────────────────')

  snap = await snapshot()
  await test('queues shares then redeems immediately', async () => {
    await writeAs(VAULT, VAULT, ADMIN_CONFIG_ABI, 'updateWithdrawalQueueStatus', [true])

    const assets = parseUnits('100', 18)
    await mintUnderlying(userAccount.address, assets)
    const { shares } = await depositSimple(userWallet, publicClient, vaultAddrs, assets, userAccount.address)

    await requestRedeem(userWallet, publicClient, vaultAddrs, shares, userAccount.address)

    const req = await getWithdrawalRequest(publicClient, VAULT, userAccount.address)
    assert(req !== null, 'withdrawal request should exist')
    assert(req!.shares === shares, `queued shares ${req!.shares} != ${shares}`)

    const { assets: assetsOut } = await redeemShares(
      userWallet, publicClient, vaultAddrs, shares, userAccount.address, userAccount.address
    )
    assert(assetsOut > 0n, 'assets out must be > 0')
  })
  await revert(snap)

  console.log('\n── R4: requestRedeem + timelock ───────────────────────────────')

  snap = await snapshot()
  await test('blocks redeem before timelock expires, allows after', async () => {
    await writeAs(VAULT, VAULT, ADMIN_CONFIG_ABI, 'updateWithdrawalQueueStatus', [true])
    await writeAs(VAULT, VAULT, ADMIN_CONFIG_ABI, 'setWithdrawalTimelock', [BigInt(3600)])

    const assets = parseUnits('100', 18)
    await mintUnderlying(userAccount.address, assets)
    const { shares } = await depositSimple(userWallet, publicClient, vaultAddrs, assets, userAccount.address)

    await requestRedeem(userWallet, publicClient, vaultAddrs, shares, userAccount.address)

    let reverted = false
    try {
      await redeemShares(userWallet, publicClient, vaultAddrs, shares, userAccount.address, userAccount.address)
    } catch {
      reverted = true
    }
    assert(reverted, 'redeem should revert before timelock expires')

    await testClient.increaseTime({ seconds: 3601 })
    await testClient.mine({ blocks: 1 })

    const { assets: assetsOut } = await redeemShares(
      userWallet, publicClient, vaultAddrs, shares, userAccount.address, userAccount.address
    )
    assert(assetsOut > 0n, 'assets out must be > 0 after timelock')
  })
  await revert(snap)
}

async function runAsyncTests() {
  console.log('\n── D4: depositAsync ───────────────────────────────────────────')

  let snap = await snapshot()
  await test('locks assets in escrow, mints shares after simulated callback', async () => {
    await registerFakeSpoke()

    const assets = parseUnits('100', 18)
    await mintUnderlying(userAccount.address, assets)

    const lzFee = await quoteLzFee(publicClient, VAULT)
    const { guid } = await depositAsync(userWallet, publicClient, vaultAddrs, assets, userAccount.address, lzFee)

    const sharesBefore = await publicClient.readContract({
      address: VAULT, abi: VAULT_BALANCE_ABI, functionName: 'balanceOf', args: [userAccount.address],
    })
    assert(sharesBefore === 0n, 'shares should be 0 before callback')

    await simulateLzCallback(guid as `0x${string}`, 0n)

    const sharesAfter = await publicClient.readContract({
      address: VAULT, abi: VAULT_BALANCE_ABI, functionName: 'balanceOf', args: [userAccount.address],
    })
    assert(sharesAfter > 0n, `shares must be > 0 after callback, got ${sharesAfter}`)
  })
  await revert(snap)

  console.log('\n── D5: mintAsync ──────────────────────────────────────────────')

  snap = await snapshot()
  await test('mints exact shares by spending up to maxAssets', async () => {
    await registerFakeSpoke()

    const maxAssets  = parseUnits('200', 18)
    const wantShares = parseUnits('100', 18)
    await mintUnderlying(userAccount.address, maxAssets)

    const lzFee = await quoteLzFee(publicClient, VAULT)
    const { guid } = await mintAsync(
      userWallet, publicClient, vaultAddrs, wantShares, maxAssets, userAccount.address, lzFee
    )

    await simulateLzCallback(guid as `0x${string}`, 0n)

    const sharesAfter = await publicClient.readContract({
      address: VAULT, abi: VAULT_BALANCE_ABI, functionName: 'balanceOf', args: [userAccount.address],
    })
    assert(sharesAfter > 0n, `shares must be > 0 after mint, got ${sharesAfter}`)
  })
  await revert(snap)

  console.log('\n── R5: redeemAsync ────────────────────────────────────────────')

  snap = await snapshot()
  await test('locks shares in escrow, returns assets after simulated callback', async () => {
    const initialDeposit = parseUnits('200', 18)
    await mintUnderlying(userAccount.address, initialDeposit)
    const { shares } = await depositSimple(userWallet, publicClient, vaultAddrs, initialDeposit, userAccount.address)
    assert(shares > 0n, 'setup: shares must be > 0')

    await registerFakeSpoke()

    const underlyingBefore = await publicClient.readContract({
      address: UNDERLYING, abi: MOCK_ERC20_ABI, functionName: 'balanceOf', args: [userAccount.address],
    })

    const lzFee = await quoteLzFee(publicClient, VAULT)
    const { guid } = await redeemAsync(
      userWallet, publicClient, vaultAddrs, shares, userAccount.address, userAccount.address, lzFee
    )

    const underlyingMid = await publicClient.readContract({
      address: UNDERLYING, abi: MOCK_ERC20_ABI, functionName: 'balanceOf', args: [userAccount.address],
    })
    assert(underlyingMid === underlyingBefore, 'underlying must not change before callback')

    await simulateLzCallback(guid as `0x${string}`, 0n)

    const underlyingAfter = await publicClient.readContract({
      address: UNDERLYING, abi: MOCK_ERC20_ABI, functionName: 'balanceOf', args: [userAccount.address],
    })
    assert(underlyingAfter > underlyingBefore, 'underlying must increase after async redeem callback')
  })
  await revert(snap)
}

// ════════════════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('MoreVaults SDK viem Integration Tests')
  console.log('======================================')
  console.log(`Hub vault:  ${VAULT}`)
  console.log(`Underlying: ${UNDERLYING}`)
  console.log(`ccManager:  ${CC_MANAGER}`)

  try {
    const chainId = await publicClient.getChainId()
    console.log(`Chain ID:   ${chainId}`)
  } catch (e: any) {
    console.error(`\nERROR: Cannot connect to Anvil at http://127.0.0.1:8545`)
    console.error(e.message)
    process.exit(1)
  }

  console.log('\n[setup] configuring vault...')
  await oneTimeSetup()
  console.log('[setup] done')

  await runDepositTests()
  await runRedeemTests()
  await runAsyncTests()

  console.log(`\n======================================`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
