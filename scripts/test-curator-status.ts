/**
 * Test script for Phase 1 Curator Operations SDK.
 *
 * Reads the curator vault status and checks if the test wallet is the curator.
 *
 * Run:
 *   npx tsx scripts/test-curator-status.ts
 */

import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import {
  getCuratorVaultStatus,
  getPendingActions,
  isCurator,
} from '../src/viem/index.js'

const VAULT    = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const CURATOR  = '0xc5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2' as const

const publicClient = createPublicClient({
  chain: base,
  transport: http(),
})

async function main() {
  console.log('══ Curator Status Test ══════════════════════════════════')
  console.log(`Vault:   ${VAULT}`)
  console.log(`Wallet:  ${CURATOR}`)
  console.log()

  // --- getCuratorVaultStatus ---
  console.log('Fetching CuratorVaultStatus...')
  const status = await getCuratorVaultStatus(publicClient, VAULT)

  console.log('\n── CuratorVaultStatus ───────────────────────────────────')
  console.log(`  curator:            ${status.curator}`)
  console.log(`  timeLockPeriod:     ${status.timeLockPeriod}s`)
  console.log(`  maxSlippagePercent: ${status.maxSlippagePercent} bps (${Number(status.maxSlippagePercent) / 100}%)`)
  console.log(`  currentNonce:       ${status.currentNonce}`)
  console.log(`  availableAssets:    ${status.availableAssets.length === 0 ? '(none)' : status.availableAssets.join(', ')}`)
  console.log(`  lzAdapter:          ${status.lzAdapter}`)
  console.log(`  paused:             ${status.paused}`)

  // --- isCurator ---
  console.log('\nChecking isCurator...')
  const curatorCheck = await isCurator(publicClient, VAULT, CURATOR)
  console.log(`\n── isCurator(${CURATOR}) ───`)
  console.log(`  result: ${curatorCheck}`)

  // --- getPendingActions (nonce 0, informational) ---
  const nonce = status.currentNonce
  if (nonce > 0n) {
    console.log(`\nFetching getPendingActions(nonce=${nonce - 1n})...`)
    try {
      const pending = await getPendingActions(publicClient, VAULT, nonce - 1n)
      console.log('\n── PendingAction ────────────────────────────────────────')
      console.log(`  nonce:        ${pending.nonce}`)
      console.log(`  actionsData:  [${pending.actionsData.length} action(s)]`)
      console.log(`  pendingUntil: ${pending.pendingUntil} (${pending.pendingUntil === 0n ? 'empty' : new Date(Number(pending.pendingUntil) * 1000).toISOString()})`)
      console.log(`  isExecutable: ${pending.isExecutable}`)
    } catch (err) {
      console.log(`  (no pending actions at nonce ${nonce - 1n} or already executed)`)
    }
  } else {
    console.log('\nNo actions submitted yet (nonce=0). Skipping getPendingActions.')
  }

  console.log('\n══ Done ════════════════════════════════════════════════')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
