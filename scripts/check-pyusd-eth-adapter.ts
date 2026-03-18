import { createPublicClient, http } from 'viem'
import { OFT_ABI } from '../src/viem/abis.js'

// The Arb OFT Adapter was 0x3CD2b89C... — let's see if there's a similar one on Eth
// Strategy: check if the Eth PYUSD token (0x6c3ea9...) has any known OFT adapter
// by looking at the Arb adapter's peers for Eth EID

const arbRpc = 'https://arb1.arbitrum.io/rpc'
const ethRpc = 'https://eth.llamarpc.com'
const flowRpc = 'https://mainnet.evm.nodes.onflow.org'

const ARB_ADAPTER = '0x3CD2b89C49D130C08f1d683225b2e5DeB63ff876' as const
const FLOW_ADAPTER = '0x26d27d5AF2F6f1c14F40013C8619d97aaf015509' as const
const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

const arbClient = createPublicClient({ transport: http(arbRpc) })
const flowClient = createPublicClient({ transport: http(flowRpc) })

async function main() {
  // Check if Arb or Flow adapters have an Eth peer we missed
  console.log('=== Checking for Eth peers ===')

  const arbPeerEth = await arbClient.readContract({
    address: ARB_ADAPTER, abi: OFT_ABI, functionName: 'peers', args: [30101],
  }) as `0x${string}`
  console.log(`Arb adapter → Eth (30101): ${arbPeerEth === ZERO ? 'NONE' : '0x' + arbPeerEth.slice(-40)}`)

  const flowPeerEth = await flowClient.readContract({
    address: FLOW_ADAPTER, abi: OFT_ABI, functionName: 'peers', args: [30101],
  }) as `0x${string}`
  console.log(`Flow adapter → Eth (30101): ${flowPeerEth === ZERO ? 'NONE' : '0x' + flowPeerEth.slice(-40)}`)

  // Try some known OFT adapter patterns on Eth for PYUSD
  // Search: is there any contract on Eth that has peers pointing to the Arb or Flow adapters?
  // We can try the Paxos deployer pattern or known addresses

  // Check if PYUSD token itself is an OFT (unlikely but let's verify)
  const ethClient = createPublicClient({ transport: http(ethRpc) })
  const PYUSD_ETH = '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8' as const

  console.log('\n=== Is PYUSD on Eth an OFT? ===')
  try {
    const peer = await ethClient.readContract({
      address: PYUSD_ETH, abi: OFT_ABI, functionName: 'peers', args: [30110],
    }) as `0x${string}`
    console.log(`PYUSD Eth peers(30110/Arb): ${peer === ZERO ? 'NONE' : '0x' + peer.slice(-40)}`)
  } catch (e: any) {
    console.log(`PYUSD Eth is NOT an OFT (peers() reverted)`)
  }

  // Check if there's an endpoint() on PYUSD Eth
  try {
    const ep = await ethClient.readContract({
      address: PYUSD_ETH,
      abi: [{ type: 'function', name: 'endpoint', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'endpoint',
    })
    console.log(`PYUSD Eth endpoint(): ${ep}`)
  } catch {
    console.log(`PYUSD Eth has no endpoint() — not LZ-enabled`)
  }

  // Check if there's an owner/deployer pattern — try common OFTAdapter factory addresses
  // Actually, let's check if the Arb adapter's owner deployed something on Eth
  try {
    const arbOwner = await arbClient.readContract({
      address: ARB_ADAPTER,
      abi: [{ type: 'function', name: 'owner', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'owner',
    })
    console.log(`\nArb adapter owner: ${arbOwner}`)

    const flowOwner = await flowClient.readContract({
      address: FLOW_ADAPTER,
      abi: [{ type: 'function', name: 'owner', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'owner',
    })
    console.log(`Flow adapter owner: ${flowOwner}`)
  } catch (e: any) {
    console.log(`Could not read owner: ${e.message?.slice(0, 80)}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
