import { createPublicClient, http, getAddress } from 'viem'
import { base } from 'viem/chains'

const LZ_ENDPOINT = '0x1a44076050125825900e736c501f859c50fe728c'
const COMPOSER = '0x96A4De4E80Cc13f084359961082F3daaa990aCC0'
const GUID = '0xdd013b147e8cb47ec4b26ef4da2ba67e60408e2a8f1ef0296f484804ec5cf031'
const STG_USDC_BASE = '0x27a16dc786820B16E5c9028b75B99F6f604b5d26'

const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') })

async function main() {
  // Scan for ComposeSent event to get the message bytes
  const currentBlock = await client.getBlockNumber()
  // Scan last 2000 blocks (~1 hour on Base)
  const fromBlock = currentBlock - 2000n

  console.log(`Scanning blocks ${fromBlock} to ${currentBlock} for ComposeSent...`)

  const logs = await client.getLogs({
    address: LZ_ENDPOINT,
    events: [{
      type: 'event',
      name: 'ComposeSent',
      inputs: [
        { name: 'from', type: 'address', indexed: false },
        { name: 'to', type: 'address', indexed: false },
        { name: 'guid', type: 'bytes32', indexed: false },
        { name: 'index', type: 'uint16', indexed: false },
        { name: 'message', type: 'bytes', indexed: false },
      ],
    }],
    fromBlock,
    toBlock: currentBlock,
  })

  console.log(`Found ${logs.length} ComposeSent events`)

  for (const log of logs) {
    const args = log.args as any
    if (args.guid === GUID || (args.to && getAddress(args.to) === COMPOSER)) {
      console.log('\n=== MATCH ===')
      console.log(`  block:   ${log.blockNumber}`)
      console.log(`  from:    ${args.from}`)
      console.log(`  to:      ${args.to}`)
      console.log(`  guid:    ${args.guid}`)
      console.log(`  index:   ${args.index}`)
      console.log(`  message: ${args.message?.slice(0, 80)}...`)
      console.log(`  full msg length: ${args.message?.length}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
