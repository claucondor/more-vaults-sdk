import { createPublicClient, http, getAddress } from 'viem'
import { METADATA_ABI, OFT_ABI } from '../src/viem/abis.js'

const flowRpc = 'https://mainnet.evm.nodes.onflow.org'
const arbRpc = 'https://arb1.arbitrum.io/rpc'

const flowClient = createPublicClient({ transport: http(flowRpc) })
const arbClient = createPublicClient({ transport: http(arbRpc) })

const FLOW_OFT_ADAPTER = '0x26d27d5AF2F6f1c14F40013C8619d97aaf015509' as const
const ARB_OFT_ADAPTER = '0x3CD2b89C49D130C08f1d683225b2e5DeB63ff876' as const

async function main() {
  // 1. Flow OFT Adapter
  console.log('=== Flow OFT Adapter ===')
  try {
    const token = await flowClient.readContract({
      address: FLOW_OFT_ADAPTER,
      abi: [{ type: 'function', name: 'token', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'token',
    })
    console.log(`token(): ${token}`)
    
    const ep = await flowClient.readContract({
      address: FLOW_OFT_ADAPTER,
      abi: [{ type: 'function', name: 'endpoint', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'endpoint',
    })
    console.log(`endpoint(): ${ep}`)

    // Check peer on Arbitrum (EID 30110)
    const arbPeer = await flowClient.readContract({
      address: FLOW_OFT_ADAPTER, abi: OFT_ABI, functionName: 'peers', args: [30110],
    }) as `0x${string}`
    console.log(`peers(30110/Arb): 0x${arbPeer.slice(-40)}`)

    // Check peer on Ethereum (EID 30101)
    const ethPeer = await flowClient.readContract({
      address: FLOW_OFT_ADAPTER, abi: OFT_ABI, functionName: 'peers', args: [30101],
    }) as `0x${string}`
    const ethEmpty = ethPeer === '0x0000000000000000000000000000000000000000000000000000000000000000'
    console.log(`peers(30101/Eth): ${ethEmpty ? 'NONE' : '0x' + ethPeer.slice(-40)}`)

    // Check peer on Base (EID 30184)
    const basePeer = await flowClient.readContract({
      address: FLOW_OFT_ADAPTER, abi: OFT_ABI, functionName: 'peers', args: [30184],
    }) as `0x${string}`
    const baseEmpty = basePeer === '0x0000000000000000000000000000000000000000000000000000000000000000'
    console.log(`peers(30184/Base): ${baseEmpty ? 'NONE' : '0x' + basePeer.slice(-40)}`)
  } catch (e: any) {
    console.log(`ERROR: ${e.message?.slice(0, 120)}`)
  }

  // 2. Arb OFT Adapter
  console.log('\n=== Arb OFT Adapter ===')
  try {
    const token = await arbClient.readContract({
      address: ARB_OFT_ADAPTER,
      abi: [{ type: 'function', name: 'token', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'token',
    })
    console.log(`token(): ${token}`)

    const [name, symbol] = await Promise.all([
      arbClient.readContract({ address: token as `0x${string}`, abi: METADATA_ABI, functionName: 'name' }),
      arbClient.readContract({ address: token as `0x${string}`, abi: METADATA_ABI, functionName: 'symbol' }),
    ])
    console.log(`  → ${name} (${symbol})`)

    // Check peer on Flow (EID 30332 or 30336?)
    for (const eid of [30332, 30336]) {
      try {
        const flowPeer = await arbClient.readContract({
          address: ARB_OFT_ADAPTER, abi: OFT_ABI, functionName: 'peers', args: [eid],
        }) as `0x${string}`
        const empty = flowPeer === '0x0000000000000000000000000000000000000000000000000000000000000000'
        console.log(`peers(${eid}/Flow): ${empty ? 'NONE' : '0x' + flowPeer.slice(-40)}`)
      } catch {
        console.log(`peers(${eid}/Flow): ERROR`)
      }
    }
  } catch (e: any) {
    console.log(`ERROR: ${e.message?.slice(0, 120)}`)
  }

  // 3. Test quoteSend Arb→Flow
  console.log('\n=== quoteSend Arb→Flow ===')
  try {
    for (const eid of [30332, 30336]) {
      try {
        const fee = await arbClient.readContract({
          address: ARB_OFT_ADAPTER,
          abi: OFT_ABI,
          functionName: 'quoteSend',
          args: [{
            dstEid: eid,
            to: '0x000000000000000000000000c5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2' as `0x${string}`,
            amountLD: 1_000_000n,
            minAmountLD: 0n,
            extraOptions: '0x' as `0x${string}`,
            composeMsg: '0x' as `0x${string}`,
            oftCmd: '0x' as `0x${string}`,
          }, false],
        }) as { nativeFee: bigint }
        console.log(`EID ${eid}: fee = ${fee.nativeFee} wei`)
      } catch {
        console.log(`EID ${eid}: FAILED`)
      }
    }
  } catch (e: any) {
    console.log(`ERROR: ${e.message?.slice(0, 80)}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
