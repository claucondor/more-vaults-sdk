import { 
  discoverVaultTopology,
  getVaultStatus,
  getVaultMetadata,
  getUserPositionMultiChain,
} from '../src/viem/index.js'
import { getInboundRoutes } from '../src/viem/spokeRoutes.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'
import { formatUnits } from 'viem'

const VAULT = '0xaf46A54208CE9924B7577AFf146dfD65eB193861' as const
const USER  = '0xc5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2' as const

async function main() {
  // 1. Discover topology
  console.log('=== 1. Topology ===')
  try {
    const topo = await discoverVaultTopology(VAULT)
    console.log(`Hub chain:    ${topo.hubChainId}`)
    console.log(`Role:         ${topo.role}`)
    console.log(`Spoke chains: ${JSON.stringify(topo.spokeChainIds)}`)
  } catch (e: any) {
    console.log(`ERROR: ${e.message}`)
  }

  // 2. Try vault status on Flow EVM (747)
  console.log('\n=== 2. Vault Status (Flow EVM 747) ===')
  const flowClient = createChainClient(747)
  if (flowClient) {
    try {
      const status = await getVaultStatus(flowClient as any, VAULT)
      console.log(`Mode:          ${status.mode}`)
      console.log(`isHub:         ${status.isHub}`)
      console.log(`Oracle:        ${status.oraclesCrossChainAccounting}`)
      console.log(`Paused:        ${status.paused}`)
      console.log(`Escrow:        ${status.escrow}`)
      console.log(`Deposit flow:  ${status.recommendedDepositFlow}`)
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`)
    }
  } else {
    console.log('No client for Flow EVM (747)')
  }

  // 3. Vault metadata
  console.log('\n=== 3. Vault Metadata ===')
  if (flowClient) {
    try {
      const meta = await getVaultMetadata(flowClient as any, VAULT)
      console.log(`Name:          ${meta.name}`)
      console.log(`Symbol:        ${meta.symbol}`)
      console.log(`Decimals:      ${meta.decimals}`)
      console.log(`Underlying:    ${meta.underlying}`)
      console.log(`Underlying sym: ${meta.underlyingSymbol}`)
      console.log(`Underlying dec: ${meta.underlyingDecimals}`)
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`)
    }
  }

  // 4. Inbound routes
  console.log('\n=== 4. Inbound Routes ===')
  if (flowClient) {
    try {
      const meta = await getVaultMetadata(flowClient as any, VAULT)
      const routes = await getInboundRoutes(747, VAULT, meta.underlying, USER)
      console.log(`Routes found: ${routes.length}`)
      for (const r of routes) {
        console.log(`  ${r.symbol} on chain ${r.spokeChainId}: OFT=${r.spokeOft}, token=${r.spokeToken}`)
      }
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`)
    }
  }

  // 5. Multi-chain position
  console.log('\n=== 5. Multi-chain Position ===')
  try {
    const pos = await getUserPositionMultiChain(VAULT, USER)
    console.log(`Hub shares:    ${pos.hubShares}`)
    console.log(`Spoke shares:  ${JSON.stringify(pos.spokeShares)}`)
    console.log(`Total shares:  ${pos.totalShares}`)
    console.log(`Est. assets:   ${pos.estimatedAssets}`)
  } catch (e: any) {
    console.log(`ERROR: ${e.message}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
