import { getUserPositionMultiChain, quoteShareBridgeFee, CHAIN_ID_TO_EID } from '../src/viem/index.js'
import { formatUnits, formatEther } from 'viem'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const VAULT = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const USER  = '0xc5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2' as const

async function main() {
  const pos = await getUserPositionMultiChain(VAULT, USER)

  console.log('=== Multi-Chain User Position ===')
  console.log(`Hub shares:      ${pos.hubShares}`)
  console.log(`Spoke shares (normalized to vault dec):`)
  for (const [chainId, shares] of Object.entries(pos.spokeShares)) {
    console.log(`  Chain ${chainId}: ${shares}`)
  }
  console.log(`Raw spoke shares (OFT native dec):`)
  for (const [chainId, shares] of Object.entries(pos.rawSpokeShares)) {
    console.log(`  Chain ${chainId}: ${shares}`)
  }
  console.log(`Total shares:    ${pos.totalShares}`)
  console.log(`Decimals:        ${pos.decimals}`)
  console.log(`Share price:     ${pos.sharePrice}`)
  console.log(`Est. assets:     ${pos.estimatedAssets} (${formatUnits(pos.estimatedAssets, 6)} USDC)`)

  // Test quoteShareBridgeFee with raw spoke balance
  const ethChainId = 1
  const rawEthShares = pos.rawSpokeShares[ethChainId]
  if (rawEthShares && rawEthShares > 0n) {
    console.log(`\n=== Quote Share Bridge Fee (Eth→Base) ===`)

    const { resolveRedeemAddresses } = await import('../src/viem/index.js')
    const hubClient = createChainClient(8453)!
    const route = await resolveRedeemAddresses(hubClient as any, VAULT, 8453, ethChainId)
    console.log(`Spoke SHARE_OFT: ${route.spokeShareOft}`)

    const spokeClient = createChainClient(ethChainId)!
    const fee = await quoteShareBridgeFee(
      spokeClient as any, route.spokeShareOft,
      CHAIN_ID_TO_EID[8453], rawEthShares, USER,
    )
    console.log(`Raw amount:  ${rawEthShares} (OFT decimals)`)
    console.log(`Bridge fee:  ${formatEther(fee)} ETH`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
