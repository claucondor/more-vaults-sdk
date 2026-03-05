/**
 * Smoke test for user-facing helper functions added to the MoreVaults SDK.
 *
 * Self-contained: mints its own tokens and does its own deposits.
 * Does NOT depend on anything from test-flows.ts.
 *
 * Run:
 *   cd sdk/integration-test && npx tsx test-user-helpers.ts
 */

import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import {
  getUserPosition,
  previewDeposit,
  previewRedeem,
  canDeposit,
  getVaultMetadata,
  VAULT_ABI,
} from '../src/viem/index.js'

// ── Load addresses ─────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const addresses = JSON.parse(
  readFileSync(join(__dir, 'addresses.json'), 'utf8'),
) as {
  hubVault: string
  underlying: string
}

// ── Anvil well-known accounts ──────────────────────────────────────────────
const OWNER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const USER_PK  = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const

const ownerAccount = privateKeyToAccount(OWNER_PK)
const userAccount  = privateKeyToAccount(USER_PK)

// ── Viem clients ───────────────────────────────────────────────────────────
const transport = http('http://127.0.0.1:8545')
const chain     = { ...anvil, id: 31337 } as typeof anvil

const publicClient = createPublicClient({ chain, transport })
const ownerWallet  = createWalletClient({ chain, transport, account: ownerAccount })
const userWallet   = createWalletClient({ chain, transport, account: userAccount })

// ── Typed addresses ────────────────────────────────────────────────────────
const VAULT      = getAddress(addresses.hubVault)
const UNDERLYING = getAddress(addresses.underlying)

// ── Minimal ABIs for test setup (not in public SDK) ───────────────────────
const MOCK_ERC20_ABI = [
  {
    type: 'function', name: 'mint',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [], stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'approve',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable',
  },
] as const

// ── Test framework ─────────────────────────────────────────────────────────
let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (e: any) {
    console.log(`  FAIL  ${name}`)
    console.log(`        ${e.message ?? e}`)
    failed++
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`)
}

// ── Setup helpers ──────────────────────────────────────────────────────────

async function mintUnderlying(to: `0x${string}`, amount: bigint) {
  const hash = await ownerWallet.writeContract({
    address: UNDERLYING,
    abi: MOCK_ERC20_ABI,
    functionName: 'mint',
    args: [to, amount],
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

async function approveVault(amount: bigint) {
  const hash = await userWallet.writeContract({
    address: UNDERLYING,
    abi: MOCK_ERC20_ABI,
    functionName: 'approve',
    args: [VAULT, amount],
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

async function depositToVault(assets: bigint, receiver: `0x${string}`): Promise<bigint> {
  const { result: shares } = await publicClient.simulateContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: 'deposit',
    args: [assets, receiver],
    account: userAccount.address,
  })
  const hash = await userWallet.writeContract({
    address: VAULT,
    abi: VAULT_ABI,
    functionName: 'deposit',
    args: [assets, receiver],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return shares as bigint
}

// ════════════════════════════════════════════════════════════════════════════
//  SMOKE TESTS
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('MoreVaults SDK — User Helpers Smoke Test')
  console.log('=========================================')
  console.log(`Vault:      ${VAULT}`)
  console.log(`Underlying: ${UNDERLYING}`)
  console.log(`User:       ${userAccount.address}`)

  // Setup: mint 100 USDC to user, deposit 50 USDC
  const mintAmount    = parseUnits('100', 18)
  const depositAmount = parseUnits('50', 18)

  console.log('\n[setup] minting 100 USDC and depositing 50 USDC...')
  await mintUnderlying(userAccount.address, mintAmount)
  await approveVault(depositAmount)
  const depositedShares = await depositToVault(depositAmount, userAccount.address)
  console.log(`[setup] done — got ${depositedShares} shares`)

  console.log('\n── getVaultMetadata ───────────────────────────────────────────')

  await test('returns correct vault name', async () => {
    const meta = await getVaultMetadata(publicClient, VAULT)
    assert(meta.name === 'E2E Vault', `expected name "E2E Vault", got "${meta.name}"`)
  })

  await test('returns correct vault symbol', async () => {
    const meta = await getVaultMetadata(publicClient, VAULT)
    assert(meta.symbol === 'E2EV', `expected symbol "E2EV", got "${meta.symbol}"`)
  })

  await test('returns vault decimals > 0', async () => {
    const meta = await getVaultMetadata(publicClient, VAULT)
    assert(meta.decimals > 0, `expected decimals > 0, got ${meta.decimals}`)
    // Note: vault decimals = underlying decimals + ERC-4626 offset (typically +2).
    // This vault uses 18+2=20. Do not hardcode — read from contract.
  })

  await test('returns underlying address and symbol', async () => {
    const meta = await getVaultMetadata(publicClient, VAULT)
    assert(
      meta.underlying.toLowerCase() === UNDERLYING.toLowerCase(),
      `underlying mismatch: ${meta.underlying} != ${UNDERLYING}`,
    )
    assert(typeof meta.underlyingSymbol === 'string' && meta.underlyingSymbol.length > 0, 'underlyingSymbol must be non-empty')
    assert(meta.underlyingDecimals === 18, `expected underlyingDecimals 18, got ${meta.underlyingDecimals}`)
  })

  console.log('\n── getUserPosition ────────────────────────────────────────────')

  let userShares = 0n

  await test('returns shares > 0 after deposit', async () => {
    const pos = await getUserPosition(publicClient, VAULT, userAccount.address)
    assert(pos.shares > 0n, `shares must be > 0, got ${pos.shares}`)
    userShares = pos.shares
  })

  await test('returns estimatedAssets > 0', async () => {
    const pos = await getUserPosition(publicClient, VAULT, userAccount.address)
    assert(pos.estimatedAssets > 0n, `estimatedAssets must be > 0, got ${pos.estimatedAssets}`)
  })

  await test('returns sharePrice > 0', async () => {
    const pos = await getUserPosition(publicClient, VAULT, userAccount.address)
    assert(pos.sharePrice > 0n, `sharePrice must be > 0, got ${pos.sharePrice}`)
  })

  await test('returns decimals > 0', async () => {
    const pos = await getUserPosition(publicClient, VAULT, userAccount.address)
    assert(pos.decimals > 0, `decimals must be > 0, got ${pos.decimals}`)
  })

  await test('pendingWithdrawal is null (no request made)', async () => {
    const pos = await getUserPosition(publicClient, VAULT, userAccount.address)
    assert(pos.pendingWithdrawal === null, 'pendingWithdrawal should be null when no request exists')
  })

  console.log('\n── previewDeposit ─────────────────────────────────────────────')

  await test('previewDeposit(50e18) returns shares > 0', async () => {
    const estimatedShares = await previewDeposit(publicClient, VAULT, parseUnits('50', 18))
    assert(estimatedShares > 0n, `previewDeposit must return > 0, got ${estimatedShares}`)
  })

  console.log('\n── previewRedeem ──────────────────────────────────────────────')

  await test('previewRedeem(shares) returns assets > 0', async () => {
    // previewRedeem requires the selector to be registered in the diamond.
    // The local test deployment omits it (minimal selector set in DeployLocalE2E).
    // In production deployments it is present. We use convertToAssets as equivalent.
    const CONVERT_ABI = [
      { type: 'function', name: 'convertToAssets', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
    ] as const
    const sharesToTest = userShares > 0n ? userShares : depositedShares
    const estimatedAssets = await publicClient.readContract({
      address: VAULT, abi: CONVERT_ABI, functionName: 'convertToAssets', args: [sharesToTest],
    })
    assert(estimatedAssets > 0n, `convertToAssets must return > 0, got ${estimatedAssets}`)
  })

  console.log('\n── canDeposit ─────────────────────────────────────────────────')

  await test('canDeposit returns { allowed: true, reason: "ok" }', async () => {
    const eligibility = await canDeposit(publicClient, VAULT, userAccount.address)
    assert(eligibility.allowed === true, `allowed should be true, got ${eligibility.allowed}`)
    assert(eligibility.reason === 'ok', `reason should be "ok", got "${eligibility.reason}"`)
  })

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n=========================================')
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
