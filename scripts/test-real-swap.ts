/**
 * Real swap test: 0.15 USDC → WETH on the MoreVaults test vault (Base).
 *
 * This script performs an actual on-chain swap using the curator's private key.
 * The vault's USDC is swapped to WETH via Uniswap V3 SwapRouter02 (fee tier 500).
 *
 * Vault:    0x8f740aba022b3fcc934ab75c581c04b75e72aba6 (Base)
 * Curator:  0xc5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2
 *
 * Run:
 *   npx tsx scripts/test-real-swap.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import {
  buildUniswapV3Swap,
  buildCuratorBatch,
  ERC20_ABI,
  MULTICALL_ABI,
} from '../src/viem/index.js'

// ── Constants ────────────────────────────────────────────────────────────────

const VAULT   = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const CURATOR = '0xc5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2' as const
const PK      = '0xPRIVATE_KEY_REDACTED' as const
const RPC     = 'https://mainnet.base.org'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const // 6 decimals
const WETH = '0x4200000000000000000000000000000000000006' as const // 18 decimals

const AMOUNT_IN    = 150_000n    // 0.15 USDC (6 decimals)
const MIN_AMOUNT_OUT = 1n        // accept any WETH (set a real floor in production)

// ── Clients ───────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PK)

const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC),
})

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(RPC),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readBalance(token: `0x${string}`, decimals: number, label: string): Promise<bigint> {
  const raw = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [VAULT],
  })
  console.log(`  ${label}: ${formatUnits(raw, decimals)} (raw: ${raw})`)
  return raw
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══ Real Swap Test: USDC → WETH on Base ══════════════════════')
  console.log(`Vault:    ${VAULT}`)
  console.log(`Curator:  ${CURATOR}`)
  console.log(`Chain:    Base (8453)`)
  console.log(`Swap:     ${formatUnits(AMOUNT_IN, 6)} USDC → WETH (fee tier 500)`)
  console.log('')

  // ── Step 1: Read balances before ─────────────────────────────────────────

  console.log('── Before balances ─────────────────────────────────────────')
  const usdcBefore = await readBalance(USDC, 6,  'USDC')
  const wethBefore = await readBalance(WETH, 18, 'WETH')

  if (usdcBefore < AMOUNT_IN) {
    throw new Error(
      `Vault has insufficient USDC: ${formatUnits(usdcBefore, 6)} < ${formatUnits(AMOUNT_IN, 6)}`
    )
  }

  // ── Step 2: Build swap action ─────────────────────────────────────────────

  console.log('\n── Building swap action ────────────────────────────────────')
  const swapAction = buildUniswapV3Swap({
    chainId: 8453,
    tokenIn:       USDC,
    tokenOut:      WETH,
    fee:           500,       // 0.05% — USDC/WETH pool on Base
    amountIn:      AMOUNT_IN,
    minAmountOut:  MIN_AMOUNT_OUT,
    recipient:     VAULT,     // vault keeps the output
  })

  console.log(`  targetContract: ${swapAction.params.targetContract}`)
  console.log(`  tokenIn:        ${swapAction.params.tokenIn}`)
  console.log(`  tokenOut:       ${swapAction.params.tokenOut}`)
  console.log(`  maxAmountIn:    ${swapAction.params.maxAmountIn}`)
  console.log(`  minAmountOut:   ${swapAction.params.minAmountOut}`)
  console.log(`  calldata:       ${swapAction.params.swapCallData.slice(0, 42)}...`)

  // ── Step 3: Submit actions (timelock=0 → executes immediately) ────────────

  console.log('\n── Submitting curator actions ──────────────────────────────')
  const batch = buildCuratorBatch([swapAction])
  console.log(`  Batch size: ${batch.length} action(s)`)

  // Estimate gas first, then add a 50% buffer to prevent out-of-gas reverts.
  // Uniswap V3 swaps are gas-intensive (~1.6M gas) and viem's default estimate
  // can be too tight when the GenericDexFacet needs to do an internal approve.
  const estimatedGas = await publicClient.estimateContractGas({
    address: VAULT,
    abi: MULTICALL_ABI,
    functionName: 'submitActions',
    args: [batch],
    account: CURATOR,
  })
  const gasWithBuffer = estimatedGas * 150n / 100n
  console.log(`  Estimated gas: ${estimatedGas} → with 50% buffer: ${gasWithBuffer}`)

  // Simulate first (catches permission errors and bad selectors)
  await publicClient.simulateContract({
    address: VAULT,
    abi: MULTICALL_ABI,
    functionName: 'submitActions',
    args: [batch],
    account: CURATOR,
  })

  const txHash = await walletClient.writeContract({
    address: VAULT,
    abi: MULTICALL_ABI,
    functionName: 'submitActions',
    args: [batch],
    account,
    chain: base,
    gas: gasWithBuffer,
  })

  // Read nonce assigned to this batch (getCurrentNonce returns next nonce, subtract 1)
  const nextNonce = await publicClient.readContract({
    address: VAULT,
    abi: MULTICALL_ABI,
    functionName: 'getCurrentNonce',
  })
  const nonce = nextNonce - 1n

  console.log(`  TX Hash:    ${txHash}`)
  console.log(`  Nonce:      ${nonce}`)
  console.log('  Waiting for transaction receipt...')

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  console.log(`  Status:     ${receipt.status}`)
  console.log(`  Block:      ${receipt.blockNumber}`)
  console.log(`  Gas used:   ${receipt.gasUsed}`)

  if (receipt.status !== 'success') {
    throw new Error(`Transaction reverted! TX: ${txHash}`)
  }

  // ── Step 4: Read balances after ───────────────────────────────────────────

  // Brief pause to avoid 429 rate limit from public RPC after tx confirmation
  await new Promise((r) => setTimeout(r, 2000))

  console.log('\n── After balances ──────────────────────────────────────────')
  const usdcAfter = await readBalance(USDC, 6,  'USDC')
  const wethAfter = await readBalance(WETH, 18, 'WETH')

  // ── Step 5: Report ────────────────────────────────────────────────────────

  console.log('\n── Summary ─────────────────────────────────────────────────')
  const usdcSpent   = usdcBefore - usdcAfter
  const wethGained  = wethAfter - wethBefore

  console.log(`  USDC spent:    ${formatUnits(usdcSpent, 6)} USDC`)
  console.log(`  WETH received: ${formatUnits(wethGained, 18)} WETH`)

  if (usdcSpent === AMOUNT_IN && wethGained > 0n) {
    console.log('\n  SUCCESS — swap executed correctly!')
  } else if (usdcSpent === 0n && wethGained === 0n) {
    console.log('\n  WARNING — no balance change detected. TX may have been a no-op.')
  } else {
    console.log(`\n  UNEXPECTED result — USDC spent=${usdcSpent}, WETH gained=${wethGained}`)
  }

  console.log('══════════════════════════════════════════════════════════════')
}

main().catch((e) => {
  console.error('\nFATAL ERROR:', e instanceof Error ? e.message : String(e))
  if (e instanceof Error && e.stack) {
    console.error(e.stack.split('\n').slice(1, 5).join('\n'))
  }
  process.exit(1)
})
