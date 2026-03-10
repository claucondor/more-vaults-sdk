import { type Address, createPublicClient, http, getAddress, zeroAddress } from 'viem'
import { OFT_ROUTES, CHAIN_ID_TO_EID } from './chains'
import { OFT_ABI, ERC20_ABI } from './abis'
import { getVaultTopology } from './topology'

export interface OutboundRoute {
  /** Chain ID where user can receive shares/assets */
  chainId: number
  /** Whether this chain is the hub (direct redeem) or a spoke (shares bridged back) */
  routeType: 'hub' | 'spoke'
  /** LZ EID for this chain */
  eid: number
  /** Native gas symbol */
  nativeSymbol: string
}

/** Public RPC endpoints per chain ID for reading spoke chain data without wallet connection */
const PUBLIC_RPC: Partial<Record<number, string>> = {
  1:     'https://ethereum-rpc.publicnode.com',
  10:    'https://mainnet.optimism.io',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
  8453:  'https://base-rpc.publicnode.com',
  747:   'https://mainnet.evm.nodes.onflow.org',
  146:   'https://rpc.soniclabs.com',
  56:    'https://bsc-dataseed1.binance.org',
}

/** Native gas token symbol per chain ID — lzFeeEstimate is denominated in this token */
export const NATIVE_SYMBOL: Partial<Record<number, string>> = {
  1:     'ETH',
  10:    'ETH',
  42161: 'ETH',
  8453:  'ETH',
  747:   'FLOW',
  146:   'S',
  56:    'BNB',
}

export interface InboundRoute {
  /** Asset symbol from OFT_ROUTES (e.g. 'stgUSDC') */
  symbol: string
  /** Chain ID where user sends from */
  spokeChainId: number
  /**
   * How the deposit is executed:
   * - 'direct'      → user is on the hub chain, use depositSimple/depositAsync
   * - 'oft-compose' → user is on a spoke chain, use depositFromSpoke via OFT compose
   */
  depositType: 'direct' | 'oft-compose'
  /** OFT contract on spoke chain — pass as `spokeOFT` to depositFromSpoke. Null for direct deposits. */
  spokeOft: Address | null
  /** Token user must approve on spoke chain (zeroAddress = native ETH) */
  spokeToken: Address
  /** OFT contract on hub chain — receives tokens for the composer. Null for direct deposits. */
  hubOft: Address | null
  /** oftCmd to use in SendParam (0x01 for Stargate taxi, 0x for standard OFT) */
  oftCmd: `0x${string}`
  /** LZ fee estimate in native wei of the SPOKE chain (not always ETH — e.g. FLOW on Flow EVM) */
  lzFeeEstimate: bigint
  /** Native gas token symbol for the spoke chain — use this when displaying the fee */
  nativeSymbol: string
}

export interface InboundRouteWithBalance extends InboundRoute {
  /** User's token balance on the spoke chain */
  userBalance: bigint
}

/**
 * Find all valid OFT inbound routes for a vault.
 *
 * Only returns routes for chains where the vault has a registered spoke —
 * this is required so the composer can send shares back to the user's chain.
 * The hub chain is always included as a 'direct' deposit option.
 *
 * Routes that revert on quoteSend() (no liquidity, no peer) are excluded.
 *
 * @param hubChainId   Chain ID of the vault hub (e.g. 8453 for Base)
 * @param vault        Vault address (to resolve registered spoke chains)
 * @param vaultAsset   vault.asset() address on the hub chain
 * @param userAddress  User address (used as receiver for fee quote)
 */
export async function getInboundRoutes(
  hubChainId: number,
  vault: Address,
  vaultAsset: Address,
  userAddress: Address,
): Promise<InboundRoute[]> {
  const hubEid = CHAIN_ID_TO_EID[hubChainId]
  if (!hubEid) throw new Error(`No LZ EID for hub chainId ${hubChainId}`)

  // Fetch vault topology to get registered spoke chains
  const hubRpc = PUBLIC_RPC[hubChainId]
  if (!hubRpc) throw new Error(`No public RPC for hub chainId ${hubChainId}`)
  const hubClient = createPublicClient({ transport: http(hubRpc) })
  const topology = await getVaultTopology(hubClient, vault)
  const registeredSpokes = new Set(topology.spokeChainIds)

  const results: InboundRoute[] = []

  for (const [symbol, chainMap] of Object.entries(OFT_ROUTES)) {
    const hubEntry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId]
    if (!hubEntry) continue

    // Does this OFT deliver the right asset to the hub?
    if (getAddress(hubEntry.token) !== getAddress(vaultAsset)) continue

    // Determine oftCmd — Stargate v2 pools need taxi cmd (0x01), standard OFTs use empty (0x)
    const STARGATE_ASSETS = new Set(['stgUSDC', 'USDT', 'WETH'])
    const oftCmd: `0x${string}` = STARGATE_ASSETS.has(symbol) ? '0x01' : '0x'

    // Only check chains where the vault has a registered spoke
    // (composer needs to send shares back — requires a spoke vault on that chain)
    const spokesToCheck = Object.keys(chainMap)
      .map(Number)
      .filter(id => id !== hubChainId && registeredSpokes.has(id))

    await Promise.allSettled(
      spokesToCheck.map(async (spokeChainId) => {
        const spokeEntry = (chainMap as Record<number, { oft: string; token: string }>)[spokeChainId]
        if (!spokeEntry) return

        const rpc = PUBLIC_RPC[spokeChainId]
        if (!rpc) return

        const client = createPublicClient({ transport: http(rpc) })

        // Validate route via quoteSend — if it reverts, skip
        try {
          const receiverBytes32 = `0x${getAddress(userAddress).slice(2).padStart(64, '0')}` as `0x${string}`
          const fee = await client.readContract({
            address: getAddress(spokeEntry.oft) as Address,
            abi: OFT_ABI,
            functionName: 'quoteSend',
            args: [{
              dstEid: hubEid,
              to: receiverBytes32,
              amountLD: 1_000_000n,
              minAmountLD: 0n,
              extraOptions: '0x',
              composeMsg: '0x',
              oftCmd,
            }, false],
          })

          results.push({
            symbol,
            spokeChainId,
            depositType:   'oft-compose',
            spokeOft:      getAddress(spokeEntry.oft) as Address,
            spokeToken:    getAddress(spokeEntry.token) as Address,
            hubOft:        getAddress(hubEntry.oft) as Address,
            oftCmd,
            lzFeeEstimate: fee.nativeFee,
            nativeSymbol:  NATIVE_SYMBOL[spokeChainId] ?? 'ETH',
          })
        } catch {
          // Route not available — skip silently
        }
      })
    )
  }

  // Add the hub chain itself as a direct deposit option
  for (const [symbol, chainMap] of Object.entries(OFT_ROUTES)) {
    const hubEntry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId]
    if (hubEntry && getAddress(hubEntry.token) === getAddress(vaultAsset)) {
      results.unshift({
        symbol,
        spokeChainId:  hubChainId,
        depositType:   'direct',
        spokeOft:      null,
        spokeToken:    getAddress(hubEntry.token) as Address,
        hubOft:        null,
        oftCmd:        '0x',
        lzFeeEstimate: 0n,
        nativeSymbol:  NATIVE_SYMBOL[hubChainId] ?? 'ETH',
      })
      break
    }
  }

  return results
}

/**
 * Fetch user token balances for each inbound route in parallel.
 * Routes with native ETH as token (zeroAddress) return the chain's ETH balance.
 */
export async function getUserBalancesForRoutes(
  routes: InboundRoute[],
  userAddress: Address,
): Promise<InboundRouteWithBalance[]> {
  return Promise.all(
    routes.map(async (route) => {
      const rpc = PUBLIC_RPC[route.spokeChainId]
      if (!rpc) return { ...route, userBalance: 0n }

      const client = createPublicClient({ transport: http(rpc) })

      try {
        let userBalance: bigint

        if (route.spokeToken === zeroAddress) {
          userBalance = await client.getBalance({ address: getAddress(userAddress) as Address })
        } else {
          userBalance = await client.readContract({
            address: route.spokeToken,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [getAddress(userAddress) as Address],
          })
        }

        return { ...route, userBalance }
      } catch {
        return { ...route, userBalance: 0n }
      }
    })
  )
}

/**
 * Find all outbound routes for a vault — chains where a user can receive
 * shares/assets when redeeming.
 *
 * The hub chain is always first (direct redeem). Spoke chains follow
 * (shares are bridged back via the composer).
 *
 * @param hubChainId  Chain ID of the vault hub (e.g. 8453 for Base)
 * @param vault       Vault address (to resolve registered spoke chains)
 */
export async function getOutboundRoutes(
  hubChainId: number,
  vault: Address,
): Promise<OutboundRoute[]> {
  const hubEid = CHAIN_ID_TO_EID[hubChainId]
  if (!hubEid) throw new Error(`No LZ EID for hub chainId ${hubChainId}`)

  const hubRpc = PUBLIC_RPC[hubChainId]
  if (!hubRpc) throw new Error(`No public RPC for hub chainId ${hubChainId}`)

  const hubClient = createPublicClient({ transport: http(hubRpc) })
  const topology = await getVaultTopology(hubClient, vault)

  const routes: OutboundRoute[] = [
    {
      chainId: hubChainId,
      routeType: 'hub',
      eid: hubEid,
      nativeSymbol: NATIVE_SYMBOL[hubChainId] ?? 'ETH',
    },
  ]

  for (const spokeChainId of topology.spokeChainIds) {
    const eid = CHAIN_ID_TO_EID[spokeChainId]
    if (!eid) continue

    routes.push({
      chainId: spokeChainId,
      routeType: 'spoke',
      eid,
      nativeSymbol: NATIVE_SYMBOL[spokeChainId] ?? 'ETH',
    })
  }

  return routes
}

/**
 * Quote the LayerZero native fee for a cross-chain deposit with a real amount.
 *
 * More precise than the `lzFeeEstimate` field on `InboundRoute`, which uses
 * a dummy 1 USDC amount.
 *
 * @param route       An InboundRoute from `getInboundRoutes()`
 * @param hubChainId  Chain ID of the vault hub (needed for LZ destination EID)
 * @param amount      Real deposit amount in token decimals
 * @param userAddress User address (used as receiver for fee quote)
 * @returns Native fee in wei of the spoke chain's gas token, or 0n for direct deposits
 */
export async function quoteRouteDepositFee(
  route: InboundRoute,
  hubChainId: number,
  amount: bigint,
  userAddress: Address,
): Promise<bigint> {
  if (route.depositType === 'direct') return 0n

  const hubEid = CHAIN_ID_TO_EID[hubChainId]
  if (!hubEid) throw new Error(`No LZ EID for hub chainId ${hubChainId}`)

  if (!route.spokeOft) throw new Error('Route is oft-compose but spokeOft is null')

  const rpc = PUBLIC_RPC[route.spokeChainId]
  if (!rpc) throw new Error(`No public RPC for spoke chainId ${route.spokeChainId}`)

  const client = createPublicClient({ transport: http(rpc) })

  const receiverBytes32 = `0x${getAddress(userAddress).slice(2).padStart(64, '0')}` as `0x${string}`
  const fee = await client.readContract({
    address: route.spokeOft,
    abi: OFT_ABI,
    functionName: 'quoteSend',
    args: [{
      dstEid: hubEid,
      to: receiverBytes32,
      amountLD: amount,
      minAmountLD: 0n,
      extraOptions: '0x',
      composeMsg: '0x',
      oftCmd: route.oftCmd,
    }, false],
  })

  return fee.nativeFee
}
