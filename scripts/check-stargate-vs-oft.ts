import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'

const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') })

// Stargate USDC on Base
const STG_USDC = '0x27a16dc786820B16E5c9028b75B99F6f604b5d26' as const
// Standard OFT: sUSDe on Base
const SUSDE = '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2' as const

const PROBE_ABI = [
  // Stargate-specific functions
  { type: 'function', name: 'stargateType', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'localEid', inputs: [], outputs: [{ type: 'uint32' }], stateMutability: 'view' },
  { type: 'function', name: 'token', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'sharedDecimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'lpToken', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'feeLib', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'plannerFee', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'treasurer', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'tokenMessaging', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

async function probe(label: string, address: `0x${string}`) {
  console.log(`\n=== ${label} (${address}) ===`)
  for (const fn of PROBE_ABI) {
    try {
      const result = await publicClient.readContract({
        address,
        abi: [fn],
        functionName: fn.name as any,
      })
      console.log(`  ${fn.name}(): ${result}`)
    } catch {
      console.log(`  ${fn.name}(): REVERTED`)
    }
  }
}

async function main() {
  await probe('Stargate USDC (Base)', STG_USDC)
  await probe('sUSDe OFT (Base)', SUSDE)
}

main().catch(e => { console.error(e); process.exit(1) })
