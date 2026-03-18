/**
 * Test script for curator bridge fee quoting.
 *
 * Reads the vault's lzAdapter address and quotes bridge fees for USDC
 * from Base to multiple destinations via stgUSDC OFT.
 *
 * NOTE: This script only QUOTES fees — no transactions are executed.
 *
 * Run:
 *   npx tsx scripts/test-curator-bridge.ts
 */

import { createPublicClient, createWalletClient, formatEther, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import {
  getCuratorVaultStatus,
  quoteCuratorBridgeFee,
  findBridgeRoute,
  LZ_EIDS,
  CHAIN_IDS,
} from '../src/viem/index.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const VAULT   = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const RPC_URL = 'https://mainnet.base.org'

// Curator wallet (read from private key — only used to derive address for refund)
const PRIVATE_KEY = '0xPRIVATE_KEY_REDACTED' as const

// Token constants on Base
const STG_USDC_OFT_BASE = '0x27a16dc786820B16E5c9028b75B99F6f604b5d26' as const
const USDC_BASE         = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const

// Test amount: 1 USDC (6 decimals)
const AMOUNT = 1_000_000n

// Destination EIDs to test
const DESTINATIONS = [
  { name: 'Ethereum', eid: LZ_EIDS.ethereum, chainId: CHAIN_IDS.ethereum },
  { name: 'Arbitrum', eid: LZ_EIDS.arbitrum, chainId: CHAIN_IDS.arbitrum },
  { name: 'Optimism', eid: LZ_EIDS.optimism, chainId: CHAIN_IDS.optimism },
] as const

// Placeholder spoke vault addresses — in production these come from vault topology.
// For fee quoting the exact dstVault only affects gas estimation marginally.
const PLACEHOLDER_DST_VAULT = '0x0000000000000000000000000000000000000001' as const

// ─── Clients ──────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY)

const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
})

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══ Curator Bridge Quote Test ════════════════════════════')
  console.log(`Vault:      ${VAULT}`)
  console.log(`Hub Chain:  Base (${CHAIN_IDS.base})`)
  console.log(`Curator:    ${account.address}`)
  console.log(`RPC:        ${RPC_URL}`)
  console.log()

  // ── Step 1: Get curator vault status ──────────────────────────────────────
  console.log('Fetching CuratorVaultStatus...')
  const status = await getCuratorVaultStatus(publicClient, VAULT)

  console.log('\n── Vault Status ─────────────────────────────────────────')
  console.log(`  lzAdapter:  ${status.lzAdapter}`)
  console.log(`  curator:    ${status.curator}`)
  console.log(`  paused:     ${status.paused}`)
  console.log()

  // ── Step 2: Find bridge route for USDC on Base ────────────────────────────
  console.log('Resolving stgUSDC bridge route from Base...')
  for (const dst of DESTINATIONS) {
    const route = findBridgeRoute(CHAIN_IDS.base, dst.chainId, USDC_BASE)
    if (route) {
      console.log(`  Base → ${dst.name}: ${route.symbol} | OFT src: ${route.oftSrc} | OFT dst: ${route.oftDst}`)
    } else {
      console.log(`  Base → ${dst.name}: (no route found)`)
    }
  }
  console.log()

  // ── Step 3: Quote bridge fees ─────────────────────────────────────────────
  console.log('Quoting bridge fees for 1 USDC (1000000) from Base...')
  console.log()

  for (const dst of DESTINATIONS) {
    const params = {
      oftToken: STG_USDC_OFT_BASE,
      dstEid: dst.eid,
      amount: AMOUNT,
      dstVault: PLACEHOLDER_DST_VAULT,
      refundAddress: account.address,
    }

    try {
      const fee = await quoteCuratorBridgeFee(publicClient, VAULT, params)
      console.log(`  Base → ${dst.name} (EID ${dst.eid}):`)
      console.log(`    Fee: ${formatEther(fee)} ETH (${fee} wei)`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`  Base → ${dst.name} (EID ${dst.eid}): ERROR — ${message}`)
    }
    console.log()
  }

  console.log('══ Done — no transactions were executed ════════════════')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
