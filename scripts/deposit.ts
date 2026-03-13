/**
 * Deposit 0.3 USDC into the vault from Base (cross-chain-async flow).
 * Polls for the LZ callback until the request is finalized.
 *
 * Run:
 *   PRIVATE_KEY=0x... npx tsx scripts/deposit.ts
 */

import { createWalletClient, formatUnits, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { smartDeposit, getAsyncRequestStatusLabel } from '../src/viem/index.js'
import { createChainClient, createChainTransport } from '../src/viem/spokeRoutes.js'

const VAULT   = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const AMOUNT  = parseUnits('0.3', 6) // 0.3 USDC (6 decimals)
const HUB_CHAIN_ID = 8453 // Base

const POLL_INTERVAL_MS = 10_000  // check every 10s
const POLL_TIMEOUT_MS  = 300_000 // give up after 5 min

async function poll(
  publicClient: ReturnType<typeof createPublicClient>,
  guid: `0x${string}`,
): Promise<void> {
  console.log(`\nPolling for LZ callback... (guid: ${guid})`)
  console.log(`Checking every ${POLL_INTERVAL_MS / 1000}s, timeout ${POLL_TIMEOUT_MS / 1000}s\n`)

  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const info = await getAsyncRequestStatusLabel(publicClient as any, VAULT, guid)
    console.log(`[${new Date().toISOString()}] ${info.label}`)

    if (info.status === 'completed') {
      console.log(`\nDeposit finalized! Shares received: ${info.result}`)
      return
    }

    if (info.status === 'refunded') {
      console.error('\nRequest was refunded — deposit did not go through.')
      process.exit(1)
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  console.error('\nTimeout — request not finalized within 5 minutes. Check LayerZero scan.')
  process.exit(1)
}

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!pk) {
    console.error('Missing PRIVATE_KEY env var.\nUsage: PRIVATE_KEY=0x... npx tsx scripts/deposit.ts')
    process.exit(1)
  }

  const account = privateKeyToAccount(pk)
  console.log(`Wallet:  ${account.address}`)
  console.log(`Vault:   ${VAULT}`)
  console.log(`Amount:  ${formatUnits(AMOUNT, 6)} USDC`)
  console.log(`Chain:   Base (${HUB_CHAIN_ID})\n`)

  const baseClient = createChainClient(HUB_CHAIN_ID)!
  const walletClient = createWalletClient({
    account,
    transport: createChainTransport(HUB_CHAIN_ID)!,
    chain: baseClient.chain,
  })

  console.log('Submitting deposit...')
  const result = await smartDeposit(
    walletClient,
    baseClient as any,
    { vault: VAULT, hubChainId: HUB_CHAIN_ID },
    AMOUNT,
    account.address,
  )

  if ('guid' in result) {
    console.log(`\nTx sent: ${result.txHash}`)
    console.log(`GUID:    ${result.guid}`)
    await poll(baseClient as any, result.guid)
  } else {
    // Shouldn't happen for async vault but handle gracefully
    console.log(`\nTx sent: ${result.txHash}`)
    console.log(`Shares:  ${result.shares}`)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
