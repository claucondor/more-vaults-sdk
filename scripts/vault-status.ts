/**
 * Fetch the full status of a MoreVaults vault.
 * Automatically discovers the hub chain and all spokes using the SDK.
 *
 * Run:
 *   npx tsx scripts/vault-status.ts
 */

import { formatUnits } from 'viem'
import {
  OMNI_FACTORY_ADDRESS,
  getVaultTopology,
  getVaultStatus,
  getVaultMetadata,
  CHAIN_IDS,
} from '../src/viem/index.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const

const ALL_CHAIN_IDS = Object.values(CHAIN_IDS)

async function findHubChain() {
  console.log('Discovering vault topology across all supported chains...\n')

  const results = await Promise.allSettled(
    ALL_CHAIN_IDS.map(async (chainId) => {
      const client = createChainClient(chainId)
      if (!client) return null
      const topo = await getVaultTopology(client, VAULT, OMNI_FACTORY_ADDRESS)
      return { chainId, client, topo }
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.topo.role === 'hub') {
      return r.value
    }
  }

  return null
}

function chainName(id: number): string {
  return Object.entries(CHAIN_IDS).find(([, v]) => v === id)?.[0] ?? `chain ${id}`
}

async function main() {
  console.log(`Vault: ${VAULT}\n`)

  const found = await findHubChain()

  if (!found) {
    console.error('Vault hub not found on any supported chain.')
    process.exit(1)
  }

  const { chainId: hubChainId, client: hubClient, topo } = found
  console.log(`Hub chain:    ${chainName(hubChainId)} (chainId=${hubChainId})`)
  console.log(`Spoke chains: ${topo.spokeChainIds.length > 0 ? topo.spokeChainIds.map(id => `${chainName(id)} (${id})`).join(', ') : 'none'}\n`)

  const [status, metadata] = await Promise.all([
    getVaultStatus(hubClient, VAULT),
    getVaultMetadata(hubClient, VAULT),
  ])

  const dec = metadata.decimals
  const underlyingDec = metadata.underlyingDecimals
  const sym = metadata.underlyingSymbol

  console.log('══ Metadata ════════════════════════════════════')
  console.log(`  Name:             ${metadata.name}`)
  console.log(`  Symbol:           ${metadata.symbol}`)
  console.log(`  Decimals:         ${dec}`)
  console.log(`  Underlying:       ${metadata.underlying} (${sym}, ${underlyingDec} dec)`)

  console.log('\n══ Status ══════════════════════════════════════')
  console.log(`  Mode:             ${status.mode}`)
  console.log(`  Is Hub:           ${status.isHub}`)
  console.log(`  Is Paused:        ${status.isPaused}`)
  console.log(`  Oracle Accounting: ${status.oracleAccountingEnabled}`)
  console.log(`  Withdrawal Queue: ${status.withdrawalQueueEnabled}`)
  console.log(`  Timelock:         ${status.withdrawalTimelockSeconds}s`)

  console.log('\n══ Capacity ════════════════════════════════════')
  const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
  const cap = status.remainingDepositCapacity
  console.log(`  Deposit Capacity: ${cap === MAX_UINT256 ? 'unlimited' : formatUnits(cap, underlyingDec) + ' ' + sym}`)
  console.log(`  Access Restricted: ${status.depositAccessRestricted}`)

  console.log('\n══ Vault Metrics ═══════════════════════════════')
  console.log(`  Total Assets:     ${formatUnits(status.totalAssets, underlyingDec)} ${sym}`)
  console.log(`  Total Supply:     ${formatUnits(status.totalSupply, dec)} ${metadata.symbol}`)
  console.log(`  Share Price:      ${formatUnits(status.sharePrice, underlyingDec)} ${sym}`)
  console.log(`  Hub Liquid:       ${formatUnits(status.hubLiquidBalance, underlyingDec)} ${sym}`)
  console.log(`  Spokes Deployed:  ${formatUnits(status.spokesDeployedBalance, underlyingDec)} ${sym}`)
  console.log(`  Max Immed Redeem: ${formatUnits(status.maxImmediateRedeemAssets, underlyingDec)} ${sym}`)

  console.log('\n══ Recommended Flows ═══════════════════════════')
  console.log(`  Deposit:  ${status.recommendedDepositFlow}`)
  console.log(`  Redeem:   ${status.recommendedRedeemFlow}`)

  if (status.issues.length > 0) {
    console.log('\n══ Issues ══════════════════════════════════════')
    status.issues.forEach((issue, i) => console.log(`  [${i + 1}] ${issue}`))
  } else {
    console.log('\n  No issues — vault is ready to use.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
