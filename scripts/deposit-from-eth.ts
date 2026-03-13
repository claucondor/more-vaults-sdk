/**
 * Deposit 1 USDC into the vault from Ethereum mainnet (OFT compose flow).
 * Tokens bridge via Stargate v2 to Base, composer deposits into vault,
 * shares are sent back to user on Ethereum via SHARE_OFT.
 *
 * For Stargate OFTs this is a 2-TX flow:
 *   TX1 (Ethereum): OFT.send with composeMsg → tokens bridge to Base
 *   TX2 (Base):     endpoint.lzCompose{value: ETH} → retry compose with ETH
 *
 * Timeouts are generous to allow for LZ cross-chain delivery + oracle callbacks.
 *
 * Run:
 *   PRIVATE_KEY=0x... npx tsx scripts/deposit-from-eth.ts
 */

import { createWalletClient, createPublicClient, formatUnits, formatEther, parseUnits, getAddress, http } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  depositFromSpoke,
  quoteDepositFromSpokeFee,
  quoteComposeFee,
  executeCompose,
  waitForCompose,
  preflightSpokeDeposit,
  CHAIN_ID_TO_EID,
  OFT_ROUTES,
} from '../src/viem/index.js'
import { createChainClient, createChainTransport } from '../src/viem/spokeRoutes.js'
import { ERC20_ABI } from '../src/viem/abis.js'

const VAULT        = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const SPOKE_CHAIN_ID = 1     // Ethereum mainnet
const HUB_CHAIN_ID   = 8453  // Base

const SPOKE_EID = CHAIN_ID_TO_EID[SPOKE_CHAIN_ID] // 30101
const HUB_EID   = CHAIN_ID_TO_EID[HUB_CHAIN_ID]   // 30184

const SPOKE_OFT  = OFT_ROUTES.stgUSDC[SPOKE_CHAIN_ID].oft
const SPOKE_TOKEN = OFT_ROUTES.stgUSDC[SPOKE_CHAIN_ID].token as `0x${string}`
const AMOUNT     = parseUnits('0.1', 6) // 0.1 USDC

// Share OFT on Ethereum (to check final share balance)
const ETH_SHARE_OFT = '0x36975a03f24b20768dda2277d81d2b8288c131ed' as const

// --- Very generous timeouts (LZ can take 5-15 min per cross-chain hop) ---
const COMPOSE_POLL_INTERVAL  = 30_000     // 30s between compose checks
const COMPOSE_TIMEOUT        = 2_700_000  // 45 min for LZ to deliver compose to hub
const SHARES_POLL_INTERVAL   = 30_000     // 30s between share checks
const SHARES_TIMEOUT         = 3_600_000  // 60 min for oracle + share bridge to spoke

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined
  if (!pk) {
    console.error('Missing PRIVATE_KEY env var.\nUsage: PRIVATE_KEY=0x... npx tsx scripts/deposit-from-eth.ts')
    process.exit(1)
  }

  const account = privateKeyToAccount(pk)
  const ethClient = createChainClient(SPOKE_CHAIN_ID)!
  const baseClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') })
  const baseWalletClient = createWalletClient({
    account,
    chain: base,
    transport: http('https://mainnet.base.org'),
  })
  const ethWalletClient = createWalletClient({
    account,
    transport: createChainTransport(SPOKE_CHAIN_ID)!,
    chain: ethClient.chain,
  })

  console.log(`Wallet:      ${account.address}`)
  console.log(`Spoke OFT:   ${SPOKE_OFT}  (Ethereum stgUSDC)`)
  console.log(`Amount:      ${formatUnits(AMOUNT, 6)} USDC`)
  console.log(`Route:       Ethereum → Base (hub) → shares back to Ethereum\n`)

  // Quote LZ fee first (needed for preflight)
  const lzFee = await quoteDepositFromSpokeFee(
    ethClient as any,
    VAULT,
    SPOKE_OFT,
    HUB_EID,
    SPOKE_EID,
    AMOUNT,
    account.address,
  )
  console.log(`LZ fee: ${formatEther(lzFee)} ETH`)

  // SDK pre-flight: validates token balance, spoke gas, AND hub ETH for Stargate TX2
  console.log('\nRunning pre-flight checks...')
  const preflight = await preflightSpokeDeposit(
    ethClient as any,
    VAULT,
    SPOKE_OFT,
    HUB_EID,
    SPOKE_EID,
    AMOUNT,
    account.address,
    lzFee,
  )
  console.log(`  Token balance:     ${formatUnits(preflight.spokeTokenBalance, 6)} USDC`)
  console.log(`  ETH on Ethereum:   ${formatEther(preflight.spokeNativeBalance)}`)
  console.log(`  ETH on Base:       ${formatEther(preflight.hubNativeBalance)}`)
  console.log(`  Stargate 2-TX:     ${preflight.isStargate ? 'YES' : 'NO'}`)
  if (preflight.isStargate) {
    console.log(`  Compose fee est:   ${formatEther(preflight.estimatedComposeFee)} ETH`)
  }
  console.log('  All checks passed!\n')

  // Snapshot shares on Ethereum before deposit
  const sharesBefore = await ethClient.readContract({
    address: ETH_SHARE_OFT,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })
  console.log(`Shares on Ethereum before: ${sharesBefore}`)

  // ================================================================
  // TX1: Deposit from Ethereum (spoke) — tokens bridge to Base (hub)
  // ================================================================
  console.log('\n========================================')
  console.log('TX1: Deposit from Ethereum (spoke)')
  console.log('========================================')

  const { txHash, guid, composeData } = await depositFromSpoke(
    ethWalletClient,
    ethClient as any,
    VAULT,
    SPOKE_OFT,
    HUB_EID,
    SPOKE_EID,
    AMOUNT,
    account.address,
    lzFee,
  )

  console.log(`\nTX1 sent:    ${txHash}`)
  console.log(`Spoke GUID:  ${guid}`)
  console.log(`Etherscan:   https://etherscan.io/tx/${txHash}`)
  console.log(`LZ scan:     https://layerzeroscan.com/tx/${guid}`)
  console.log(`Stargate:    ${composeData ? 'YES — 2-TX flow, compose retry needed on hub' : 'NO — 1-TX flow, compose auto-executes'}`)

  if (!composeData) {
    console.log('\nStandard OFT — compose will execute automatically with ETH.')
    console.log('Waiting for shares to arrive on Ethereum...\n')
    await pollShares(ethClient, ETH_SHARE_OFT, account.address, sharesBefore, SHARES_POLL_INTERVAL, SHARES_TIMEOUT)
    return
  }

  // ================================================================
  // Wait for compose to arrive on Base (LZ cross-chain delivery)
  // ================================================================
  console.log('\n========================================')
  console.log('Waiting for compose on Base (hub)')
  console.log('========================================')
  console.log('LZ is delivering the message from Ethereum to Base...')
  console.log(`Scanning Base blocks from: ${composeData.hubBlockStart}`)
  console.log(`Polling every ${COMPOSE_POLL_INTERVAL / 1000}s, timeout ${COMPOSE_TIMEOUT / 60_000} min`)
  console.log(`Composer: ${composeData.to}\n`)

  const readyComposeData = await waitForCompose(
    baseClient,
    composeData,
    account.address,
    COMPOSE_POLL_INTERVAL,
    COMPOSE_TIMEOUT,
  )

  console.log(`\nCompose arrived on Base!`)
  console.log(`  from (Stargate pool): ${readyComposeData.from}`)
  console.log(`  to (composer):        ${readyComposeData.to}`)
  console.log(`  hub GUID:             ${readyComposeData.guid}`)
  console.log(`  message length:       ${readyComposeData.message.length} chars`)

  // ================================================================
  // TX2: Execute compose on Base (retry with ETH for readFee + shareSendFee)
  // ================================================================
  console.log('\n========================================')
  console.log('TX2: Execute compose on Base (hub)')
  console.log('========================================')

  const composeFee = await quoteComposeFee(baseClient, VAULT, SPOKE_EID, account.address)
  console.log(`Compose fee: ${formatEther(composeFee)} ETH`)

  const { txHash: composeTxHash } = await executeCompose(
    baseWalletClient,
    baseClient,
    readyComposeData,
    composeFee,
  )

  console.log(`\nTX2 sent:    ${composeTxHash}`)
  console.log(`Basescan:    https://basescan.org/tx/${composeTxHash}`)
  console.log(`Hub GUID:    ${readyComposeData.guid}`)
  console.log(`LZ scan:     https://layerzeroscan.com/tx/${readyComposeData.guid}`)

  // ================================================================
  // Wait for shares on Ethereum (oracle callback + SHARE_OFT bridge)
  // ================================================================
  console.log('\n========================================')
  console.log('Waiting for shares on Ethereum (spoke)')
  console.log('========================================')
  console.log('Flow: compose executed → LZ Read oracle callback → shares minted → SHARE_OFT.send Base→Ethereum')
  console.log(`Polling every ${SHARES_POLL_INTERVAL / 1000}s, timeout ${SHARES_TIMEOUT / 60_000} min\n`)

  await pollShares(ethClient, ETH_SHARE_OFT, account.address, sharesBefore, SHARES_POLL_INTERVAL, SHARES_TIMEOUT)

  console.log('\n========================================')
  console.log('DEPOSIT COMPLETE')
  console.log('========================================')
  console.log(`Vault:       ${VAULT}`)
  console.log(`TX1 (spoke): ${txHash}`)
  console.log(`TX2 (hub):   ${composeTxHash}`)
  console.log(`Share token: ${ETH_SHARE_OFT} (on Ethereum)`)
}

async function pollShares(
  client: ReturnType<typeof createPublicClient>,
  shareToken: `0x${string}`,
  userAddress: `0x${string}`,
  sharesBefore: bigint,
  intervalMs: number,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs
  let attempt = 0

  while (Date.now() < deadline) {
    attempt++
    try {
      const shares = await client.readContract({
        address: getAddress(shareToken),
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      })

      const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000)
      console.log(`[${elapsed}s] Poll #${attempt} — Shares: ${shares}`)

      if (shares > sharesBefore) {
        const newShares = shares - sharesBefore
        console.log(`\n✓ Deposit finalized! Received ${newShares} new shares.`)
        console.log(`  Previous: ${sharesBefore}`)
        console.log(`  Current:  ${shares}`)
        return
      }
    } catch (e: any) {
      console.log(`[poll #${attempt}] RPC error: ${e.shortMessage || e.message} — retrying...`)
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  console.error(`\nTimeout after ${timeoutMs / 60_000} min — shares not received.`)
  console.error('Check LayerZero scan for the hub GUID to see if the oracle callback happened.')
  process.exit(1)
}

main().catch(e => {
  console.error('\n--- FATAL ERROR ---')
  console.error(e)
  process.exit(1)
})
