import { createPublicClient, http, getAddress } from 'viem'
import { base } from 'viem/chains'

const LZ_ENDPOINT = '0x1a44076050125825900e736c501f859c50fe728c'
const COMPOSER = '0x96A4De4E80Cc13f084359961082F3daaa990aCC0'
const GUID = '0xdd013b147e8cb47ec4b26ef4da2ba67e60408e2a8f1ef0296f484804ec5cf031'

// Known Stargate USDC pool on Base
const STG_USDC_BASE = '0x27a16dc786820B16E5c9028b75B99F6f604b5d26'

const LZ_ENDPOINT_ABI = [{
  type: 'function', name: 'composeQueue',
  inputs: [
    { name: '_from', type: 'address' },
    { name: '_to', type: 'address' },
    { name: '_guid', type: 'bytes32' },
    { name: '_index', type: 'uint16' },
  ],
  outputs: [{ name: '', type: 'bytes32' }],
  stateMutability: 'view',
}] as const

const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') })

async function main() {
  console.log('Checking composeQueue...')
  console.log(`  from: ${STG_USDC_BASE}`)
  console.log(`  to:   ${COMPOSER}`)
  console.log(`  guid: ${GUID}`)
  console.log(`  idx:  0`)

  const hash = await client.readContract({
    address: LZ_ENDPOINT,
    abi: LZ_ENDPOINT_ABI,
    functionName: 'composeQueue',
    args: [STG_USDC_BASE, COMPOSER, GUID, 0],
  })

  const EMPTY = '0x0000000000000000000000000000000000000000000000000000000000000000'
  const RECEIVED = '0x0000000000000000000000000000000000000000000000000000000000000001'

  console.log(`\nResult: ${hash}`)
  if (hash === EMPTY) console.log('→ EMPTY — compose not delivered yet or wrong from/guid')
  else if (hash === RECEIVED) console.log('→ RECEIVED — compose already executed')
  else console.log('→ PENDING — compose is in queue, ready for executeCompose!')

  // Also try with from = 0x0 (in case the from is different)
  console.log('\nTrying with from=0x0...')
  const hash2 = await client.readContract({
    address: LZ_ENDPOINT,
    abi: LZ_ENDPOINT_ABI,
    functionName: 'composeQueue',
    args: ['0x0000000000000000000000000000000000000000', COMPOSER, GUID, 0],
  })
  console.log(`Result: ${hash2}`)
  if (hash2 === EMPTY) console.log('→ EMPTY')
  else if (hash2 === RECEIVED) console.log('→ RECEIVED')
  else console.log('→ PENDING')

  // Check the TX on spoke to see when it was sent
  console.log('\nChecking current Base block...')
  const block = await client.getBlockNumber()
  console.log(`Current block: ${block}`)
}

main().catch(e => { console.error(e); process.exit(1) })
