import { createPublicClient, http, getAddress } from 'viem'
import { OFT_ABI, METADATA_ABI } from '../src/viem/abis.js'
import { CHAIN_ID_TO_EID } from '../src/viem/chains.js'

const flowRpc = 'https://mainnet.evm.nodes.onflow.org'
const client = createPublicClient({ transport: http(flowRpc) })

const PYUSD0 = '0x99aF3EeA856556646C98c8B9b2548Fe815240750' as const

async function main() {
  console.log('=== PYUSD0 analysis ===')
  
  // Check if it has token() (OFTAdapter)
  console.log('\n1. OFT.token()')
  try {
    const token = await client.readContract({
      address: PYUSD0,
      abi: [{ type: 'function', name: 'token', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'token',
    })
    console.log(`   token() = ${token}`)
  } catch {
    console.log('   reverted — not OFTAdapter or pure OFT')
  }

  // Check endpoint
  console.log('\n2. endpoint()')
  try {
    const ep = await client.readContract({
      address: PYUSD0,
      abi: [{ type: 'function', name: 'endpoint', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'endpoint',
    })
    console.log(`   endpoint() = ${ep}`)
  } catch {
    console.log('   reverted — no LZ endpoint')
  }

  // Check peers on known chains
  console.log('\n3. peers() on known chains')
  for (const [chainName, chainId] of [['Ethereum', 1], ['Arbitrum', 42161], ['Base', 8453]] as const) {
    const eid = CHAIN_ID_TO_EID[chainId]
    if (!eid) continue
    try {
      const peer = await client.readContract({
        address: PYUSD0,
        abi: OFT_ABI,
        functionName: 'peers',
        args: [eid],
      }) as `0x${string}`
      const peerAddr = `0x${peer.slice(-40)}`
      const isEmpty = peer === '0x0000000000000000000000000000000000000000000000000000000000000000'
      console.log(`   ${chainName} (EID ${eid}): ${isEmpty ? 'NONE' : peerAddr}`)
    } catch (e: any) {
      console.log(`   ${chainName} (EID ${eid}): ERROR — ${e.message?.slice(0, 80)}`)
    }
  }

  // Check quoteSend to Ethereum
  console.log('\n4. quoteSend to Ethereum')
  try {
    const fee = await client.readContract({
      address: PYUSD0,
      abi: OFT_ABI,
      functionName: 'quoteSend',
      args: [{
        dstEid: CHAIN_ID_TO_EID[1],
        to: '0x000000000000000000000000c5c5A0220c1AbFCfA26eEc68e55d9b689193d6b2' as `0x${string}`,
        amountLD: 1_000_000n,
        minAmountLD: 0n,
        extraOptions: '0x' as `0x${string}`,
        composeMsg: '0x' as `0x${string}`,
        oftCmd: '0x' as `0x${string}`,
      }, false],
    }) as { nativeFee: bigint }
    console.log(`   fee: ${fee.nativeFee} wei`)
  } catch (e: any) {
    console.log(`   ERROR: ${e.message?.slice(0, 120)}`)
  }

  // Check owner
  console.log('\n5. owner()')
  try {
    const owner = await client.readContract({
      address: PYUSD0,
      abi: [{ type: 'function', name: 'owner', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'owner',
    })
    console.log(`   owner() = ${owner}`)
  } catch {
    console.log('   reverted')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
