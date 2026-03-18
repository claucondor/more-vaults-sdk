/**
 * Full flow readiness test for ayUSD and ayFLOW vaults.
 * Tests: topology, distribution, inbound routes, outbound routes,
 * smartDeposit readiness, smartRedeem readiness.
 *
 * Usage: npx tsx scripts/test-vault-flows.ts
 */

import { formatUnits, type Address } from 'viem'
import {
  discoverVaultTopology,
  getVaultStatus,
  getVaultMetadata,
  getVaultDistributionWithTopology,
  getInboundRoutes,
  getOutboundRoutes,
  CHAIN_IDS,
  CHAIN_ID_TO_EID,
} from '../src/viem/index.js'
import { createChainClient } from '../src/viem/spokeRoutes.js'

const VAULTS: { name: string; address: Address }[] = [
  { name: 'ayUSD',  address: '0xaf46A54208CE9924B7577AFf146dfD65eB193861' },
  { name: 'ayFLOW', address: '0xCBf9a7753F9D2d0e8141ebB36d99f87AcEf98597' },
]

// Dummy user for inbound route quotes
const DUMMY_USER: Address = '0x0000000000000000000000000000000000000001'

function chainName(id: number): string {
  return Object.entries(CHAIN_IDS).find(([, v]) => v === id)?.[0] ?? `chain-${id}`
}

function ok(label: string, detail = '') {
  console.log(`  ✓  ${label}${detail ? '  →  ' + detail : ''}`)
}

function warn(label: string, detail = '') {
  console.log(`  ⚠  ${label}${detail ? '  →  ' + detail : ''}`)
}

function fail(label: string, detail = '') {
  console.log(`  ✗  ${label}${detail ? '  →  ' + detail : ''}`)
}

function sep(title: string) {
  console.log(`\n${'═'.repeat(62)}`)
  console.log(`  ${title}`)
  console.log('═'.repeat(62))
}

function sub(title: string) {
  console.log(`\n  ── ${title}`)
}

async function testVault(name: string, vault: Address) {
  sep(`${name}  (${vault})`)

  // ── 1. Topology ──────────────────────────────────────────
  sub('1. Topology')
  const topo = await discoverVaultTopology(vault)
  const hubChainId = topo.hubChainId
  ok(`role`, topo.role)
  ok(`hub chain`, `${chainName(hubChainId)} (${hubChainId})`)
  ok(`spoke chains`, topo.spokeChainIds.length > 0
    ? topo.spokeChainIds.map(id => `${chainName(id)}(${id})`).join(', ')
    : 'none (single-chain)')

  if (hubChainId === 0) {
    fail('hub chain unknown — cannot continue')
    return
  }

  const hubClient = createChainClient(hubChainId)
  if (!hubClient) {
    fail(`no RPC for hub chainId=${hubChainId}`)
    return
  }

  // ── 2. Vault status ──────────────────────────────────────
  sub('2. Vault Status')
  const [status, meta] = await Promise.all([
    getVaultStatus(hubClient, vault),
    getVaultMetadata(hubClient, vault),
  ])
  const udec = meta.underlyingDecimals
  const sym  = meta.underlyingSymbol
  const fmt  = (v: bigint) => `${formatUnits(v, udec)} ${sym}`

  ok(`mode`, status.mode)
  ok(`paused`, String(status.isPaused))
  ok(`total assets`, fmt(status.totalAssets))
  ok(`share price`, fmt(status.sharePrice))
  ok(`recommended deposit flow`, status.recommendedDepositFlow)
  ok(`recommended redeem flow`,  status.recommendedRedeemFlow)
  if (status.issues.length > 0) {
    status.issues.forEach(i => warn(`issue`, i))
  } else {
    ok(`no issues`)
  }

  // ── 3. Distribution ──────────────────────────────────────
  sub('3. Distribution (getVaultDistributionWithTopology)')
  try {
    const dist = await getVaultDistributionWithTopology(hubClient, vault)
    ok(`hub total assets`, fmt(dist.hubTotalAssets))
    ok(`hub liquid`,       fmt(dist.hubLiquidBalance))
    ok(`hub strategy`,     fmt(dist.hubStrategyBalance))
    ok(`spokes deployed (hub accounting)`, fmt(dist.spokesDeployedBalance))
    ok(`spoke chain IDs`, dist.spokeChainIds.length > 0
      ? dist.spokeChainIds.map(id => `${chainName(id)}(${id})`).join(', ')
      : 'none')
  } catch (e: any) {
    fail(`getVaultDistributionWithTopology`, e.message)
  }

  // ── 4. Inbound routes ────────────────────────────────────
  sub('4. Inbound Routes (getInboundRoutes)')
  const hasEid = !!CHAIN_ID_TO_EID[hubChainId]
  if (!hasEid) {
    warn(`no LZ EID for chainId=${hubChainId} — inbound routes not available`)
  } else {
    try {
      const routes = await getInboundRoutes(hubChainId, vault, meta.underlying as Address, DUMMY_USER)
      if (routes.length === 0) {
        warn(`no inbound routes found`, `no OFT routes registered for ${sym} on chainId=${hubChainId}`)
      } else {
        for (const r of routes) {
          ok(
            `route [${r.depositType}]`,
            `from ${chainName(r.spokeChainId)}(${r.spokeChainId}) — token=${r.sourceTokenSymbol} lzFee=${r.lzFeeEstimate} native=${r.nativeSymbol}`
          )
        }
      }
    } catch (e: any) {
      fail(`getInboundRoutes`, e.message)
    }
  }

  // ── 5. Outbound routes ───────────────────────────────────
  sub('5. Outbound Routes (getOutboundRoutes)')
  if (!hasEid) {
    warn(`no LZ EID for chainId=${hubChainId} — outbound routes not available`)
  } else {
    try {
      const routes = await getOutboundRoutes(hubChainId, vault)
      for (const r of routes) {
        ok(
          `route [${r.routeType}]`,
          `chainId=${r.chainId} (${chainName(r.chainId)}) eid=${r.eid} native=${r.nativeSymbol}`
        )
      }
    } catch (e: any) {
      fail(`getOutboundRoutes`, e.message)
    }
  }

  // ── 6. smartDeposit readiness ────────────────────────────
  sub('6. smartDeposit readiness')
  if (status.isPaused) {
    warn(`vault is paused — smartDeposit would throw VaultPausedError`)
  } else if (status.mode === 'full') {
    warn(`vault is full — smartDeposit would throw CapacityFullError`)
  } else {
    switch (status.recommendedDepositFlow) {
      case 'depositSimple':
        ok(`smartDeposit → depositSimple (direct ERC4626 deposit, no LZ fee needed)`)
        break
      case 'depositAsync':
        ok(`smartDeposit → depositAsync (ERC7540 async, requires quoteLzFee for LZ fee)`)
        break
      default:
        warn(`smartDeposit → unknown flow`, status.recommendedDepositFlow)
    }
  }

  // ── 7. smartRedeem readiness ─────────────────────────────
  sub('7. smartRedeem readiness')
  if (status.isPaused) {
    warn(`vault is paused — smartRedeem would throw VaultPausedError`)
  } else {
    switch (status.recommendedRedeemFlow) {
      case 'redeemShares':
        ok(`smartRedeem → redeemShares (direct ERC4626 redeem, no LZ fee needed)`)
        break
      case 'redeemAsync':
        ok(`smartRedeem → redeemAsync (ERC7540 async, requires quoteLzFee for LZ fee)`)
        break
      default:
        warn(`smartRedeem → unknown flow`, status.recommendedRedeemFlow)
    }
    const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
    ok(`max immediate redeem`, status.maxImmediateRedeemAssets === MAX_UINT256
      ? 'unlimited'
      : fmt(status.maxImmediateRedeemAssets))
  }
}

async function main() {
  for (const { name, address } of VAULTS) {
    try {
      await testVault(name, address)
    } catch (e: any) {
      console.error(`\nFATAL for ${name}: ${e.message}`)
    }
    console.log()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
