/**
 * Test script for Phase 5 — curator sub-vault operations.
 *
 * Tests against the MoreVaults hub on Base:
 *   Vault:             0x8f740aba022b3fcc934ab75c581c04b75e72aba6
 *   Known ERC4626:     Moonwell mUSDC — 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22
 *
 * Run:  npx tsx scripts/test-sub-vaults.ts
 */

import { createPublicClient, http, formatUnits } from 'viem'
import { base } from 'viem/chains'
import {
  getSubVaultPositions,
  getVaultPortfolio,
  detectSubVaultType,
  getSubVaultInfo,
  getERC7540RequestStatus,
  previewSubVaultDeposit,
  previewSubVaultRedeem,
} from '../src/viem/curatorSubVaults.js'

const VAULT          = '0x8f740aba022b3fcc934ab75c581c04b75e72aba6' as const
const MOONWELL_MUSDC = '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22' as const

const publicClient = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org'),
})

function sep(label: string) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${label}`)
  console.log('─'.repeat(60))
}

async function main() {
  console.log('MoreVaults SDK — Phase 5: Sub-Vault Operations Test')
  console.log(`Vault:  ${VAULT}`)
  console.log(`Chain:  Base (chainId 8453)`)

  // ── 1. Sub-vault positions ────────────────────────────────────────────────
  sep('1. getSubVaultPositions()')
  const positions = await getSubVaultPositions(publicClient, VAULT)
  if (positions.length === 0) {
    console.log('  No active sub-vault positions found.')
  } else {
    for (const p of positions) {
      console.log(`\n  Sub-vault: ${p.address}`)
      console.log(`    Type:            ${p.type}`)
      console.log(`    Name:            ${p.name} (${p.symbol})`)
      console.log(`    Shares held:     ${formatUnits(p.sharesBalance, p.decimals)} ${p.symbol}`)
      console.log(`    Underlying:      ${p.underlyingAsset} (${p.underlyingSymbol})`)
      console.log(`    Underlying value: ${formatUnits(p.underlyingValue, p.underlyingDecimals)} ${p.underlyingSymbol}`)
    }
  }

  // ── 2. Full portfolio ─────────────────────────────────────────────────────
  sep('2. getVaultPortfolio()')
  const portfolio = await getVaultPortfolio(publicClient, VAULT)

  console.log('\n  Liquid assets:')
  if (portfolio.liquidAssets.length === 0) {
    console.log('    (none)')
  } else {
    for (const a of portfolio.liquidAssets) {
      console.log(`    ${a.symbol}: ${formatUnits(a.balance, a.decimals)} (${a.address})`)
    }
  }

  console.log('\n  Sub-vault positions:')
  if (portfolio.subVaultPositions.length === 0) {
    console.log('    (none)')
  } else {
    for (const p of portfolio.subVaultPositions) {
      console.log(`    [${p.type}] ${p.symbol}: ${formatUnits(p.underlyingValue, p.underlyingDecimals)} ${p.underlyingSymbol} value`)
    }
  }

  console.log(`\n  totalAssets (vault):  ${formatUnits(portfolio.totalAssets, 6)} USDC`)
  console.log(`  totalSupply (shares): ${formatUnits(portfolio.totalSupply, 8)} shares`)
  console.log(`  lockedAssets:         ${formatUnits(portfolio.lockedAssets, 6)} USDC`)
  console.log(`  totalValue (calc):    ${formatUnits(portfolio.totalValue, 6)} USDC`)

  // ── 3. detectSubVaultType on Moonwell mUSDC ───────────────────────────────
  sep(`3. detectSubVaultType() — Moonwell mUSDC`)
  console.log(`  Address: ${MOONWELL_MUSDC}`)
  const svType = await detectSubVaultType(publicClient, MOONWELL_MUSDC)
  console.log(`  Detected type: ${svType ?? 'unknown'}`)

  // ── 4. getSubVaultInfo on Moonwell mUSDC ─────────────────────────────────
  sep(`4. getSubVaultInfo() — Moonwell mUSDC`)
  const info = await getSubVaultInfo(publicClient, VAULT, MOONWELL_MUSDC)
  console.log(`  Name:              ${info.name} (${info.symbol})`)
  console.log(`  Type:              ${info.type}`)
  console.log(`  Underlying:        ${info.underlyingAsset} (${info.underlyingSymbol}, ${info.underlyingDecimals} decimals)`)
  console.log(`  maxDeposit(vault): ${formatUnits(info.maxDeposit, info.underlyingDecimals)} ${info.underlyingSymbol}`)
  console.log(`  isWhitelisted:     ${info.isWhitelisted}`)

  // ── 5. previewSubVaultDeposit ─────────────────────────────────────────────
  sep(`5. previewSubVaultDeposit() — 1 USDC into Moonwell mUSDC`)
  const oneUSDC = 1_000_000n
  try {
    const sharesOut = await previewSubVaultDeposit(publicClient, MOONWELL_MUSDC, oneUSDC)
    console.log(`  1 USDC → ${sharesOut} shares (raw)`)
  } catch (e) {
    console.log(`  Error: ${(e as Error).message}`)
  }

  // ── 6. previewSubVaultRedeem ──────────────────────────────────────────────
  sep(`6. previewSubVaultRedeem() — 1e8 shares from Moonwell mUSDC`)
  const oneShare = 100_000_000n // 1e8
  try {
    const assetsOut = await previewSubVaultRedeem(publicClient, MOONWELL_MUSDC, oneShare)
    console.log(`  1e8 shares → ${formatUnits(assetsOut, 6)} USDC`)
  } catch (e) {
    console.log(`  Error: ${(e as Error).message}`)
  }

  // ── 7. getERC7540RequestStatus (if vault has ERC7540 positions) ───────────
  sep(`7. getERC7540RequestStatus() — checking active positions`)
  const erc7540Positions = portfolio.subVaultPositions.filter((p) => p.type === 'erc7540')
  if (erc7540Positions.length === 0) {
    console.log('  No ERC7540 sub-vault positions to check.')
  } else {
    for (const p of erc7540Positions) {
      const status = await getERC7540RequestStatus(publicClient, VAULT, p.address)
      console.log(`\n  Sub-vault: ${p.address} (${p.symbol})`)
      console.log(`    pendingDeposit:    ${status.pendingDeposit}`)
      console.log(`    claimableDeposit:  ${status.claimableDeposit}  (canFinalize: ${status.canFinalizeDeposit})`)
      console.log(`    pendingRedeem:     ${status.pendingRedeem}`)
      console.log(`    claimableRedeem:   ${status.claimableRedeem}   (canFinalize: ${status.canFinalizeRedeem})`)
    }
  }

  console.log('\n\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
