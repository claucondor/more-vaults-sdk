import { createPublicClient, http, formatEther } from 'viem'
import { base } from 'viem/chains'

const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') })

async function main() {
  const tx = await client.getTransaction({ hash: '0x684610b19889fd428396b454b3175e7d59a6e9614fa3c7981af2af18672ff0fc' })
  console.log('=== TX2 (executeCompose) ===')
  console.log(`from:  ${tx.from}`)
  console.log(`to:    ${tx.to}`)
  console.log(`value: ${tx.value} (${formatEther(tx.value)} ETH)`)
  console.log(`input: ${tx.input.slice(0, 10)}...`)
  
  // Also check what our quoteComposeFee would return
  const { quoteComposeFee, CHAIN_ID_TO_EID } = await import('../src/viem/index.js')
  const composeFee = await quoteComposeFee(
    client as any, 
    '0x8f740aba022b3fcc934ab75c581c04b75e72aba6',
    CHAIN_ID_TO_EID[1],  // spoke = Ethereum
    '0xc5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2',
  )
  console.log(`\nSDK quoteComposeFee: ${composeFee} (${formatEther(composeFee)} ETH)`)
}

main().catch(e => { console.error(e); process.exit(1) })
