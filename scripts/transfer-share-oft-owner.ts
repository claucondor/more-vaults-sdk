/**
 * Transfer ownership of the ayUSD SHARE_OFT on Flow EVM to a new address.
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx tsx scripts/transfer-share-oft-owner.ts
 */
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const SHARE_OFT_FLOW = '0x54b1b994c87E7C5DdC945E8A82020c7ECe9473a3' as const
const NEW_OWNER      = '0x1e237D7E2eaF1C28c3163Ff0674906bFc0761D47' as const
const FLOW_RPC       = 'https://mainnet.evm.nodes.onflow.org'

const pk = process.env.PRIVATE_KEY as `0x${string}`
if (!pk) { console.error('Missing PRIVATE_KEY env var'); process.exit(1) }

const account = privateKeyToAccount(pk)
console.log('Signing as:', account.address)

const flowChain = {
  id: 747,
  name: 'Flow EVM',
  nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
  rpcUrls: { default: { http: [FLOW_RPC] } },
} as const

const publicClient = createPublicClient({ chain: flowChain, transport: http(FLOW_RPC) })
const walletClient = createWalletClient({ account, chain: flowChain, transport: http(FLOW_RPC) })

const ABI = [
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'transferOwnership', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'newOwner', type: 'address' }], outputs: [] },
] as const

const currentOwner = await publicClient.readContract({ address: SHARE_OFT_FLOW, abi: ABI, functionName: 'owner' })
console.log('Current owner:', currentOwner)
console.log('Transferring to:', NEW_OWNER)

const hash = await walletClient.writeContract({
  address: SHARE_OFT_FLOW,
  abi: ABI,
  functionName: 'transferOwnership',
  args: [NEW_OWNER],
})

console.log('TX:', hash)
await publicClient.waitForTransactionReceipt({ hash })
console.log('Done ✓')

const newOwner = await publicClient.readContract({ address: SHARE_OFT_FLOW, abi: ABI, functionName: 'owner' })
console.log('New owner confirmed:', newOwner)
