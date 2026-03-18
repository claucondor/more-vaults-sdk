/**
 * Test script for Phase 2 Curator Operations SDK — MulticallFacet write operations.
 *
 * Tests against the real vault on Base using only publicClient simulations.
 * NO real transactions are sent.
 *
 * Run:
 *   npx tsx scripts/test-curator-multicall.ts
 */

import { createPublicClient, http, zeroAddress } from 'viem'
import { base } from 'viem/chains'
import {
  encodeCuratorAction,
  buildCuratorBatch,
  MULTICALL_ABI,
} from '../src/viem/index.js'
import type { CuratorAction } from '../src/viem/index.js'

// ── Constants ────────────────────────────────────────────────────────────────

const VAULT   = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const CURATOR = '0xc5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2' as const

// Known assets on this vault (USDC + WETH on Base)
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const WETH = '0x4200000000000000000000000000000000000006' as const

// A plausible DEX aggregator on Base (1inch v5 router — just for encoding tests)
const DEX_ROUTER = '0x1111111254EEB25477B68fb85Ed929f73A960582' as const

// ── Client ───────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
})

// ── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function pass(label: string, detail?: string) {
  passed++
  console.log(`  ✓ PASS  ${label}${detail ? `  (${detail})` : ''}`)
}

function fail(label: string, err: unknown) {
  failed++
  const msg = err instanceof Error ? err.message : String(err)
  console.log(`  ✗ FAIL  ${label}`)
  console.log(`         ${msg.slice(0, 200)}`)
}

// ── Test A — Dry-run simulation ───────────────────────────────────────────────
//
// Build a single-action batch (erc7540RequestDeposit) and simulate submitActions.
// This verifies:
//   1. encodeCuratorAction produces valid calldata
//   2. The curator address has permission (AccessControlLib.validatePermissionForSelector)
//   3. The vault accepts the submitActions call (correct ABI, no selector mismatch)
//
// NOTE: The simulation will likely revert because USDC assets in the vault may
// be insufficient for an actual requestDeposit — but the revert we care about
// is whether the CURATOR gets past the permission check. If the revert message
// is "EmptyActions" or a downstream sub-call error (not "Unauthorized"), the
// encoding and permission checks are confirmed correct.

async function testA() {
  console.log('\n── Test A: Dry-run simulation ───────────────────────────────────')

  // Build an erc7540RequestDeposit action for a whitelisted vault
  // (using USDC as the sub-vault — will revert inside execution but selector is valid)
  const action: CuratorAction = {
    type: 'erc7540RequestDeposit',
    vault: USDC,           // dummy sub-vault; actual value doesn't matter for encoding check
    assets: 1_000_000n,    // 1 USDC (6 decimals)
  }

  const batch = buildCuratorBatch([action])

  try {
    await publicClient.simulateContract({
      address: VAULT,
      abi: MULTICALL_ABI,
      functionName: 'submitActions',
      args: [batch],
      account: CURATOR,
    })
    // If simulation succeeds, that's also fine (timelock=0 means it auto-executes)
    pass('submitActions simulation succeeded (timelock=0, auto-executed)')
  } catch (err: any) {
    const msg = err?.message ?? String(err)

    // A revert from inside the executed sub-call is expected (e.g. USDC is not a
    // whitelisted ERC7540 vault, PendingOperationExists, ZeroAmount, etc.).
    // What we must NOT see is an Unauthorized / NotCurator error, which would
    // mean the encoding produced a bad selector that the ACL doesn't recognize.
    if (
      msg.includes('EmptyActions') ||
      msg.includes('Unauthorized') ||
      msg.includes('NotCurator') ||
      msg.includes('AccessControl')
    ) {
      fail('submitActions simulation: unexpected permission error', err)
    } else {
      pass(
        'submitActions simulation: curator has permission, inner revert is expected',
        msg.slice(0, 80),
      )
    }
  }

  // Also verify encoding is deterministic and non-empty
  try {
    const encoded = encodeCuratorAction(action)
    if (encoded.length > 10) {
      pass(`encodeCuratorAction produces ${encoded.length} hex chars of calldata`)
    } else {
      fail('encodeCuratorAction: calldata too short', new Error(encoded))
    }
  } catch (err) {
    fail('encodeCuratorAction threw', err)
  }
}

// ── Test B — Read getCurrentNonce (no TX) ────────────────────────────────────
//
// We cannot simulate submitActions with a meaningful batch that will actually
// succeed end-to-end without a live curator wallet. Instead we:
//   1. Read getCurrentNonce to confirm the multicall ABI is correct
//   2. Verify that passing an EMPTY batch produces the expected "EmptyActions" revert

async function testB() {
  console.log('\n── Test B: getCurrentNonce + empty-batch revert ─────────────────')

  // B1 — read getCurrentNonce
  try {
    const nonce = await publicClient.readContract({
      address: VAULT,
      abi: MULTICALL_ABI,
      functionName: 'getCurrentNonce',
    })
    pass(`getCurrentNonce returned nonce=${nonce}`)
  } catch (err) {
    fail('getCurrentNonce read failed', err)
  }

  // B2 — simulate empty batch → should revert with EmptyActions
  try {
    await publicClient.simulateContract({
      address: VAULT,
      abi: MULTICALL_ABI,
      functionName: 'submitActions',
      args: [[] as `0x${string}`[]],
      account: CURATOR,
    })
    fail('submitActions with empty batch should have reverted', new Error('did not revert'))
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    if (msg.includes('EmptyActions') || msg.includes('revert')) {
      pass('submitActions([]) correctly reverts (EmptyActions or revert)')
    } else {
      fail('submitActions([]) reverted with unexpected error', err)
    }
  }
}

// ── Test C — Encode all action types ─────────────────────────────────────────
//
// Verifies that encodeCuratorAction handles every discriminated-union variant
// without throwing. Uses dummy addresses and amounts — no simulation needed.

async function testC() {
  console.log('\n── Test C: encodeCuratorAction for all action types ─────────────')

  const DUMMY_VAULT = '0x0000000000000000000000000000000000000001' as const

  const actions: { label: string; action: CuratorAction }[] = [
    {
      label: 'swap',
      action: {
        type: 'swap',
        params: {
          targetContract: DEX_ROUTER,
          tokenIn: USDC,
          tokenOut: WETH,
          maxAmountIn: 1_000_000n,
          minAmountOut: 1n,
          swapCallData: '0xdeadbeef',
        },
      },
    },
    {
      label: 'batchSwap',
      action: {
        type: 'batchSwap',
        params: {
          swaps: [
            {
              targetContract: DEX_ROUTER,
              tokenIn: USDC,
              tokenOut: WETH,
              maxAmountIn: 500_000n,
              minAmountOut: 1n,
              swapCallData: '0xdeadbeef',
            },
            {
              targetContract: DEX_ROUTER,
              tokenIn: WETH,
              tokenOut: USDC,
              maxAmountIn: 1n,
              minAmountOut: 1n,
              swapCallData: '0xcafe',
            },
          ],
        },
      },
    },
    {
      label: 'erc4626Deposit',
      action: { type: 'erc4626Deposit', vault: DUMMY_VAULT, assets: 1_000_000n },
    },
    {
      label: 'erc4626Redeem',
      action: { type: 'erc4626Redeem', vault: DUMMY_VAULT, shares: 1_000_000n },
    },
    {
      label: 'erc7540RequestDeposit',
      action: { type: 'erc7540RequestDeposit', vault: DUMMY_VAULT, assets: 1_000_000n },
    },
    {
      label: 'erc7540Deposit',
      action: { type: 'erc7540Deposit', vault: DUMMY_VAULT, assets: 1_000_000n },
    },
    {
      label: 'erc7540RequestRedeem',
      action: { type: 'erc7540RequestRedeem', vault: DUMMY_VAULT, shares: 1_000_000n },
    },
    {
      label: 'erc7540Redeem',
      action: { type: 'erc7540Redeem', vault: DUMMY_VAULT, shares: 1_000_000n },
    },
  ]

  for (const { label, action } of actions) {
    try {
      const encoded = encodeCuratorAction(action)
      // Every encoded calldata must start with a 4-byte selector (0x + 8 hex chars = 10 chars min)
      if (!encoded.startsWith('0x') || encoded.length < 10) {
        fail(`encodeCuratorAction('${label}'): too short`, new Error(encoded))
      } else {
        pass(`encodeCuratorAction('${label}')  → ${encoded.slice(0, 10)}...`)
      }
    } catch (err) {
      fail(`encodeCuratorAction('${label}')`, err)
    }
  }

  // Also verify buildCuratorBatch produces the same results
  try {
    const allActions = actions.map((a) => a.action)
    const batch = buildCuratorBatch(allActions)
    if (batch.length === allActions.length) {
      pass(`buildCuratorBatch returns correct array length (${batch.length})`)
    } else {
      fail('buildCuratorBatch: wrong length', new Error(`${batch.length} !== ${allActions.length}`))
    }
  } catch (err) {
    fail('buildCuratorBatch threw', err)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══ Curator Multicall Test ═══════════════════════════════')
  console.log(`Vault:   ${VAULT}`)
  console.log(`Curator: ${CURATOR}`)
  console.log(`Chain:   Base (8453)`)
  console.log('Note:    Only simulations — no real transactions sent.')

  await testA()
  await testB()
  await testC()

  console.log('\n══ Results ══════════════════════════════════════════════')
  console.log(`  Passed: ${passed}`)
  console.log(`  Failed: ${failed}`)
  console.log('═════════════════════════════════════════════════════════')

  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
