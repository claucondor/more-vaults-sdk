/**
 * Retry a pending LZ compose by calling endpoint.lzCompose with ETH.
 *
 * The compose was queued by Stargate V2 but the executor couldn't execute it
 * because msg.value=0 (Stargate doesn't forward ETH in compose options).
 *
 * Run:
 *   PRIVATE_KEY=0x... npx tsx scripts/retry-compose.ts
 */

import { createWalletClient, createPublicClient, http, formatEther, parseEther } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// --- Parameters for the TAXI compose ---
const LZ_ENDPOINT = '0x1a44076050125825900e736c501f859c50fe728c' as const
const COMPOSE_FROM = '0x27a16dc786820b16e5c9028b75b99f6f604b5d26' as const // StargatePool on Base
const COMPOSE_TO = '0xca0ae8788247fc4816f7877b4afbfb62d935dad1' as const   // MoreVaultsComposer
const GUID = '0xcb9ea5826799396f20f8428446c2a3d651d4de699aaafb52400779205cb2273e' as const
const INDEX = 0

// The exact compose message from ComposeSent event (must match the stored hash)
// Note: hopSendParam.dstEid = 0x75E8 = 30184 (Base/hub) → shares stay on hub (local transfer)
const COMPOSE_MESSAGE = '0x00000000000188760000759500000000000000000000000000000000000000000000000000000000000F4092000000000000000000000000C5C5A0220C1ABFCFA26EEC68E55D9B689193D6B20000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000075E8000000000000000000000000C5C5A0220C1ABFCFA26EEC68E55D9B689193D6B20000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000E000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' as const

// ETH to send: readFee (~0.0000754 ETH) for _initDeposit
// With shares on hub (dstEid=hubEid), _send does local transfer → no ETH needed for share return
// So msg.value - readFee ≈ 0 stored as pendingDeposit.msgValue (which is fine for local transfer)
const ETH_TO_SEND = 80000000000000n // 0.00008 ETH (readFee + tiny buffer)

const ENDPOINT_ABI = [
  {
    type: 'function',
    name: 'composeQueue',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'guid', type: 'bytes32' },
      { name: 'index', type: 'uint16' },
    ],
    outputs: [{ name: 'messageHash', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'lzCompose',
    inputs: [
      { name: '_from', type: 'address' },
      { name: '_to', type: 'address' },
      { name: '_guid', type: 'bytes32' },
      { name: '_index', type: 'uint16' },
      { name: '_message', type: 'bytes' },
      { name: '_extraData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!pk) {
    console.error('Missing PRIVATE_KEY env var.')
    process.exit(1)
  }

  const account = privateKeyToAccount(pk)
  const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') })
  const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') })

  console.log(`Wallet: ${account.address}`)
  console.log(`ETH to send: ${formatEther(ETH_TO_SEND)} ETH`)

  // 1. Verify compose is still pending
  const hash = await publicClient.readContract({
    address: LZ_ENDPOINT,
    abi: ENDPOINT_ABI,
    functionName: 'composeQueue',
    args: [COMPOSE_FROM, COMPOSE_TO, GUID, INDEX],
  })

  console.log(`\nCompose hash in queue: ${hash}`)
  if (hash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    console.error('Compose not found (hash = 0). Already executed or never sent.')
    process.exit(1)
  }
  if (hash === '0x0000000000000000000000000000000000000000000000000000000000000001') {
    console.log('Compose already delivered (hash = RECEIVED_MESSAGE_HASH).')
    process.exit(0)
  }
  console.log('Compose is PENDING — proceeding with retry.\n')

  // 2. Check ETH balance on Base
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Base ETH balance: ${formatEther(balance)} ETH`)
  if (balance < ETH_TO_SEND) {
    console.error(`Insufficient ETH on Base. Need ${formatEther(ETH_TO_SEND)}, have ${formatEther(balance)}.`)
    process.exit(1)
  }

  // 3. Simulate first
  console.log('Simulating lzCompose...')
  try {
    await publicClient.simulateContract({
      address: LZ_ENDPOINT,
      abi: ENDPOINT_ABI,
      functionName: 'lzCompose',
      args: [COMPOSE_FROM, COMPOSE_TO, GUID, INDEX, COMPOSE_MESSAGE, '0x'],
      value: ETH_TO_SEND,
      account: account.address,
    })
    console.log('Simulation OK!\n')
  } catch (e: any) {
    console.error('Simulation reverted:', e.shortMessage || e.message)
    console.error('\nThe compose will likely fail. Check if:')
    console.error('  - SHARE_OFT has peers configured for the destination EID')
    console.error('  - The vault is not paused')
    console.error('  - The readFee is covered by ETH_TO_SEND')
    process.exit(1)
  }

  // 4. Execute with explicit gas limit (initVaultActionRequest + LZ Read is expensive)
  console.log('Sending lzCompose transaction...')
  const txHash = await walletClient.writeContract({
    address: LZ_ENDPOINT,
    abi: ENDPOINT_ABI,
    functionName: 'lzCompose',
    args: [COMPOSE_FROM, COMPOSE_TO, GUID, INDEX, COMPOSE_MESSAGE, '0x'],
    value: ETH_TO_SEND,
    gas: 5_000_000n,
  })

  console.log(`TX sent: ${txHash}`)
  console.log(`Track: https://basescan.org/tx/${txHash}`)

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  console.log(`\nStatus: ${receipt.status}`)
  console.log(`Gas used: ${receipt.gasUsed}`)

  // 5. Verify compose was consumed
  const hashAfter = await publicClient.readContract({
    address: LZ_ENDPOINT,
    abi: ENDPOINT_ABI,
    functionName: 'composeQueue',
    args: [COMPOSE_FROM, COMPOSE_TO, GUID, INDEX],
  })
  console.log(`Compose hash after: ${hashAfter}`)
  if (hashAfter === '0x0000000000000000000000000000000000000000000000000000000000000001') {
    console.log('Compose delivered successfully!')
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
