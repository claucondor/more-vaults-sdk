/**
 * Two-step redeem from Base vault (cross-chain-async flow):
 *   1. Redeem half of current shares
 *   2. Redeem all remaining shares
 *
 * Run:
 *   PRIVATE_KEY=0x... npx tsx scripts/redeem.ts
 */

import { createWalletClient, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { redeemAsync, getUserPosition, quoteLzFee, getAsyncRequestStatusLabel } from '../src/viem/index.js'
import { createChainClient, createChainTransport } from '../src/viem/spokeRoutes.js'

const VAULT        = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const HUB_CHAIN_ID = 8453 // Base

const POLL_INTERVAL_MS = 10_000   // check every 10s
const POLL_TIMEOUT_MS  = 600_000  // give up after 10 min

async function poll(
  publicClient: ReturnType<typeof createChainClient>,
  guid: `0x${string}`,
  label: string,
): Promise<void> {
  console.log(`\nPolling ${label}... (guid: ${guid})`)
  console.log(`Checking every ${POLL_INTERVAL_MS / 1000}s, timeout ${POLL_TIMEOUT_MS / 1000}s\n`)

  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const info = await getAsyncRequestStatusLabel(publicClient as any, VAULT, guid)
    console.log(`[${new Date().toISOString()}] ${info.label}`)

    if (info.status === 'completed') {
      console.log(`\n${label} finalized! Assets received: ${info.result}`)
      return
    }

    if (info.status === 'refunded') {
      console.error(`\n${label} was refunded — redeem did not go through.`)
      process.exit(1)
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  console.error(`\nTimeout — ${label} not finalized within 10 minutes. Check LayerZero scan.`)
  process.exit(1)
}

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!pk) {
    console.error('Missing PRIVATE_KEY env var.\nUsage: PRIVATE_KEY=0x... npx tsx scripts/redeem.ts')
    process.exit(1)
  }

  const account = privateKeyToAccount(pk)
  const baseClient = createChainClient(HUB_CHAIN_ID)!
  const walletClient = createWalletClient({
    account,
    transport: createChainTransport(HUB_CHAIN_ID)!,
    chain: baseClient.chain,
  })

  console.log(`Wallet: ${account.address}`)
  console.log(`Vault:  ${VAULT}`)
  console.log(`Chain:  Base (${HUB_CHAIN_ID})\n`)

  // ── Step 1: redeem half ─────────────────────────────────────────────────────
  const position = await getUserPosition(baseClient as any, VAULT, account.address)
  const totalShares = position.shares
  const halfShares = totalShares / 2n

  console.log(`Current shares: ${totalShares}`)
  console.log(`Redeeming half: ${halfShares}\n`)

  const lzFee1 = await quoteLzFee(baseClient as any, VAULT)
  console.log(`LZ fee: ${formatUnits(lzFee1, 18)} ETH`)

  const result1 = await redeemAsync(
    walletClient,
    baseClient as any,
    { vault: VAULT, hubChainId: HUB_CHAIN_ID },
    halfShares,
    account.address,
    account.address,
    lzFee1,
  )
  console.log(`\nTx sent: ${result1.txHash}`)
  console.log(`GUID:    ${result1.guid}`)

  await poll(baseClient, result1.guid, 'Redeem 1/2')

  // ── Step 2: redeem the rest ─────────────────────────────────────────────────
  const positionAfter = await getUserPosition(baseClient as any, VAULT, account.address)
  const remainingShares = positionAfter.shares

  console.log(`\nShares remaining after first redeem: ${remainingShares}`)
  console.log(`Redeeming all remaining: ${remainingShares}\n`)

  const lzFee2 = await quoteLzFee(baseClient as any, VAULT)
  console.log(`LZ fee: ${formatUnits(lzFee2, 18)} ETH`)

  const result2 = await redeemAsync(
    walletClient,
    baseClient as any,
    { vault: VAULT, hubChainId: HUB_CHAIN_ID },
    remainingShares,
    account.address,
    account.address,
    lzFee2,
  )
  console.log(`\nTx sent: ${result2.txHash}`)
  console.log(`GUID:    ${result2.guid}`)

  await poll(baseClient, result2.guid, 'Redeem remainder')

  console.log('\nAll done!')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
