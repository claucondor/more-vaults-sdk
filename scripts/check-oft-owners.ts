import { type Address } from 'viem'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const OWNER_ABI = [{ name: 'owner', type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }] as const

const FLOW_SHARE_OFT: Address  = '0x54b1b994c87E7C5DdC945E8A82020c7ECe9473a3'
const ARB_SHARE_OFT: Address   = '0x92fb13069176e64D92DB72B22BDF1dC191BA8d7a'

async function main() {
  const flowClient = createChainClient(747)!
  const arbClient  = createChainClient(42161)!

  const [flowOwner, arbOwner] = await Promise.all([
    flowClient.readContract({ address: FLOW_SHARE_OFT, abi: OWNER_ABI, functionName: 'owner' }),
    arbClient.readContract({ address: ARB_SHARE_OFT,  abi: OWNER_ABI, functionName: 'owner' }),
  ])

  console.log('SHARE_OFT Flow (hub):')
  console.log(`  address: ${FLOW_SHARE_OFT}`)
  console.log(`  owner:   ${flowOwner}`)
  console.log()
  console.log('SHARE_OFT Arbitrum:')
  console.log(`  address: ${ARB_SHARE_OFT}`)
  console.log(`  owner:   ${arbOwner}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
