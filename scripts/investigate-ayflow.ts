/**
 * Investigate ayFLOW vault — tries Flow EVM testnet directly
 * since testnet (chainId=545) is excluded from auto-discovery.
 */

import { createPublicClient, http, formatUnits, type Address } from 'viem'
import {
  getVaultTopology,
  getVaultStatus,
  getVaultMetadata,
  getVaultConfiguration,
  getVaultAnalysis,
  OMNI_FACTORY_ADDRESS,
  CHAIN_IDS,
} from '../src/viem/index.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const VAULT: Address = '0xCBf9a7753F9D2d0e8141ebB36d99f87AcEf98597'
const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

function chainName(id: number): string {
  return Object.entries(CHAIN_IDS).find(([, v]) => v === id)?.[0] ?? `chain-${id}`
}

function fmt(value: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(value, decimals)} ${symbol}`
}

async function main() {
  console.log(`ayFLOW vault: ${VAULT}`)
  console.log('Trying Flow EVM Testnet (chainId=545) directly...\n')

  const testnetClient = createPublicClient({
    transport: http('https://testnet.evm.nodes.onflow.org', { retryCount: 3 }),
    chain: {
      id: 545,
      name: 'Flow EVM Testnet',
      nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
      rpcUrls: { default: { http: ['https://testnet.evm.nodes.onflow.org'] } },
    } as any,
  })

  // Check topology
  const topo = await getVaultTopology(testnetClient, VAULT, OMNI_FACTORY_ADDRESS)
  console.log('Topology:')
  console.log(`  Role:         ${topo.role}`)
  console.log(`  Hub chainId:  ${topo.hubChainId} (${chainName(topo.hubChainId)})`)
  console.log(`  Spoke chains: ${topo.spokeChainIds.length > 0
    ? topo.spokeChainIds.map(id => `${chainName(id)} (${id})`).join(', ')
    : 'none'}`)

  // Use hub client (testnet) or resolve hub if it's a spoke
  let hubClient: any = testnetClient
  if (topo.role === 'spoke') {
    const resolved = createChainClient(topo.hubChainId)
    if (resolved) hubClient = resolved
    else {
      // hub is probably testnet too
      console.log(`  Hub is on chainId=${topo.hubChainId}, using testnet client`)
    }
  }

  // Metadata
  console.log('\nMetadata:')
  const meta = await getVaultMetadata(hubClient, VAULT)
  const dec  = meta.decimals
  const udec = meta.underlyingDecimals
  const sym  = meta.underlyingSymbol
  console.log(`  Vault name:      ${meta.name}`)
  console.log(`  Vault symbol:    ${meta.symbol}`)
  console.log(`  Underlying addr: ${meta.underlying}`)
  console.log(`  Underlying sym:  ${sym}`)
  console.log(`  Underlying dec:  ${udec}`)

  // Status
  console.log('\nStatus:')
  const status = await getVaultStatus(hubClient, VAULT)
  console.log(`  Mode:               ${status.mode}`)
  console.log(`  Is Hub:             ${status.isHub}`)
  console.log(`  Is Paused:          ${status.isPaused}`)
  console.log(`  Withdrawal Queue:   ${status.withdrawalQueueEnabled}`)
  console.log(`  Withdrawal Timelock: ${status.withdrawalTimelockSeconds}s`)
  console.log(`  Total Assets:       ${fmt(status.totalAssets, udec, sym)}`)
  console.log(`  Share Price:        ${fmt(status.sharePrice, udec, sym)}`)
  console.log(`  Deposit Capacity:   ${status.remainingDepositCapacity === MAX_UINT256 ? 'unlimited' : fmt(status.remainingDepositCapacity, udec, sym)}`)
  console.log(`  Access Restricted:  ${status.depositAccessRestricted}`)
  console.log(`  Recommended Deposit: ${status.recommendedDepositFlow}`)
  console.log(`  Recommended Redeem:  ${status.recommendedRedeemFlow}`)

  // Analysis
  console.log('\nVault Analysis:')
  try {
    const analysis = await getVaultAnalysis(hubClient, VAULT)
    console.log(`  Whitelist enabled: ${analysis.depositWhitelistEnabled}`)
    console.log(`  Depositable assets (${analysis.depositableAssets.length}):`)
    for (const a of analysis.depositableAssets) {
      console.log(`    - ${a.symbol} (${a.name}) @ ${a.address}  [${a.decimals} dec]`)
    }
    console.log(`  Available assets (${analysis.availableAssets.length}):`)
    for (const a of analysis.availableAssets) {
      console.log(`    - ${a.symbol} (${a.name}) @ ${a.address}  [${a.decimals} dec]`)
    }
  } catch (e: any) {
    console.log(`  WARN: ${e.message}`)
  }

  // Configuration
  console.log('\nConfiguration:')
  try {
    const cfg = await getVaultConfiguration(hubClient, VAULT)
    console.log(`  Owner:        ${cfg.owner}`)
    console.log(`  Curator:      ${cfg.curator}`)
    console.log(`  Guardian:     ${cfg.guardian}`)
    console.log(`  Fee:          ${cfg.fee} bps`)
    console.log(`  Deposit Cap:  ${cfg.depositCapacity === MAX_UINT256 ? 'unlimited' : fmt(cfg.depositCapacity, udec, sym)}`)
    console.log(`  Whitelist:    ${cfg.depositWhitelistEnabled}`)
    console.log(`  Timelock:     ${cfg.timeLockPeriod}s`)
    console.log(`  Paused:       ${cfg.paused}`)
    console.log(`  Escrow:       ${cfg.escrow}`)
    console.log(`  LZ Adapter:   ${cfg.lzAdapter}`)
    console.log(`  Depositable:  ${cfg.depositableAssets.join(', ')}`)
    console.log(`  Available:    ${cfg.availableAssets.join(', ')}`)
  } catch (e: any) {
    console.log(`  WARN: ${e.message}`)
  }
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
