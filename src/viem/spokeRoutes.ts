import { type Address, createPublicClient, http, fallback, getAddress, zeroAddress } from 'viem'
import { OFT_ROUTES, CHAIN_ID_TO_EID } from './chains'
import { OFT_ABI, ERC20_ABI } from './abis'
import { getVaultTopology } from './topology'
import { isAsyncMode, quoteLzFee } from './utils'
import { MoreVaultsError } from './errors.js'

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

/**
 * Multiple public RPC endpoints per chain — tried in order via viem fallback transport.
 * First entry is preferred; subsequent entries are used if the first fails or times out.
 */
const PUBLIC_RPCS: Partial<Record<number, string[]>> = {
  1: [
    'https://ethereum-rpc.publicnode.com',
    'https://ethereum.publicnode.com',
    'https://eth.drpc.org',
    'https://eth-mainnet.public.blastapi.io',
    'https://0xrpc.io/eth',
    'https://eth.llamarpc.com',
  ],
  10: [
    'https://mainnet.optimism.io',
    'https://optimism-rpc.publicnode.com',
    'https://op.drpc.org',
  ],
  42161: [
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arbitrum.publicnode.com',
    'https://arbitrum.public.blockpi.network/v1/rpc/public',
    'https://public-arb-mainnet.fastnode.io',
  ],
  8453: [
    'https://base-rpc.publicnode.com',
    'https://base.llamarpc.com',
    'https://base.drpc.org',
    'https://mainnet.base.org',
    'https://1rpc.io/base',
    'https://base.rpc.subquery.network/public',
  ],
  747: [
    'https://mainnet.evm.nodes.onflow.org',
  ],
  146: [
    'https://rpc.soniclabs.com',
    'https://sonic.drpc.org',
  ],
  56: [
    'https://bsc-dataseed1.binance.org',
    'https://bsc-dataseed2.binance.org',
    'https://bsc-rpc.publicnode.com',
  ],
}

// multicall3 is deployed at the same deterministic address on all supported chains
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

/**
 * Create a viem transport for a given chain ID using the configured public RPCs.
 *
 * @param chainId  EVM chain ID
 * @returns        A viem fallback transport, or null if the chain is not supported
 */
export function createChainTransport(chainId: number) {
  const rpcs = PUBLIC_RPCS[chainId]
  if (!rpcs?.length) return null
  return rpcs.length === 1 ? http(rpcs[0]) : fallback(rpcs.map(url => http(url)))
}

/**
 * Create a viem PublicClient with fallback transport for a given chain ID.
 *
 * @param chainId  EVM chain ID — must be present in PUBLIC_RPCS
 * @returns        A configured PublicClient, or null if the chain is not supported
 */
export function createChainClient(chainId: number) {
  const rpcs = PUBLIC_RPCS[chainId]
  if (!rpcs?.length) return null
  return createPublicClient({
    chain: {
      id: chainId,
      name: `chain-${chainId}`,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: rpcs as [string, ...string[]] } },
      contracts: { multicall3: { address: MULTICALL3_ADDRESS } },
    },
    transport: rpcs.length === 1 ? http(rpcs[0]) : fallback(rpcs.map(url => http(url))),
  })
}

const SYMBOL_ABI = [{ name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }] as const
const DECIMALS_ABI = [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }] as const

/** Read ERC20 symbol() on-chain. Falls back to `fallback` if the call fails. */
async function readTokenSymbol(client: ReturnType<typeof createChainClient>, token: Address, fallbackSymbol: string): Promise<string> {
  if (!client) return fallbackSymbol
  try {
    return await client.readContract({ address: token, abi: SYMBOL_ABI, functionName: 'symbol' })
  } catch {
    return fallbackSymbol
  }
}

/** Read ERC20 decimals() on-chain. Falls back to 18 if the call fails. */
async function readTokenDecimals(client: ReturnType<typeof createChainClient>, token: Address): Promise<number> {
  if (!client) return 18
  try {
    return await client.readContract({ address: token, abi: DECIMALS_ABI, functionName: 'decimals' })
  } catch {
    return 18
  }
}

/** @deprecated use PUBLIC_RPCS — kept for backwards compat in internal checks */
const PUBLIC_RPC: Partial<Record<number, string>> = Object.fromEntries(
  Object.entries(PUBLIC_RPCS).map(([k, v]) => [k, v![0]])
)

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
  /** Internal route identifier from OFT_ROUTES (e.g. 'stgUSDC') — do NOT show to users */
  symbol: string
  /** Chain ID where user sends from */
  spokeChainId: number
  /**
   * How the deposit is executed:
   * - 'direct'       → user is on the hub chain, vault uses standard ERC-4626 (depositSimple). No LZ fee.
   * - 'direct-async' → user is on the hub chain, vault uses async accounting (depositAsync). LZ fee required.
   * - 'oft-compose'  → user is on a spoke chain, use depositFromSpoke via OFT compose. LZ fee required.
   */
  depositType: 'direct' | 'direct-async' | 'oft-compose'
  /** OFT contract on spoke chain — pass as `spokeOFT` to depositFromSpoke. Null for direct deposits. */
  spokeOft: Address | null
  /** Token user must approve on spoke chain (zeroAddress = native ETH) */
  spokeToken: Address
  /**
   * Human-readable symbol of the token the user needs to hold on the spoke chain.
   * For OFTAdapters this is the underlying token symbol (e.g. 'USDC', 'weETH').
   * For pure OFTs this is the OFT's own symbol (e.g. 'sUSDe', 'USDe').
   * Use this — not `symbol` — when displaying the token name to users.
   */
  sourceTokenSymbol: string
  /** OFT contract on hub chain — receives tokens for the composer. Null for direct deposits. */
  hubOft: Address | null
  /** oftCmd to use in SendParam (0x01 for Stargate taxi, 0x for standard OFT) */
  oftCmd: `0x${string}`
  /** LZ fee estimate in native wei of the SPOKE chain (not always ETH — e.g. FLOW on Flow EVM) */
  lzFeeEstimate: bigint
  /** Native gas token symbol for the spoke chain — use this when displaying the fee */
  nativeSymbol: string
  /** Decimals of spokeToken — use this with formatUnits(userBalance, decimals) */
  decimals: number
}

export interface InboundRouteWithBalance extends InboundRoute {
  /** User's token balance on the spoke chain */
  userBalance: bigint
}

/**
 * Core logic: resolve inbound routes for a single vault asset.
 * Pre-fetched shared state (client, topology, asyncMode) is passed in to avoid
 * redundant RPC calls when iterating multiple assets.
 */
async function _getRoutesForAsset(
  hubChainId: number,
  hubEid: number,
  vault: Address,
  singleAsset: Address,
  userAddress: Address,
  hubClient: ReturnType<typeof createChainClient>,
  registeredSpokes: Set<number>,
  asyncMode: boolean,
): Promise<InboundRoute[]> {
  const results: InboundRoute[] = []
  const asset = getAddress(singleAsset)

  // ── OFT cross-chain routes (spoke → hub) ──────────────────
  for (const [symbol, chainMap] of Object.entries(OFT_ROUTES)) {
    const hubEntry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId]
    if (!hubEntry) continue
    if (getAddress(hubEntry.token) !== asset) continue

    const oftCmd: `0x${string}` = '0x'
    const spokesToCheck = Object.keys(chainMap as Record<string, unknown>)
      .map(Number)
      .filter(id => id !== hubChainId && registeredSpokes.has(id))

    await Promise.allSettled(
      spokesToCheck.map(async (spokeChainId) => {
        const spokeEntry = (chainMap as Record<number, { oft: string; token: string }>)[spokeChainId]
        if (!spokeEntry) return
        const client = createChainClient(spokeChainId)
        if (!client) return

        try {
          const receiverBytes32 = `0x${getAddress(userAddress).slice(2).padStart(64, '0')}` as `0x${string}`
          const spokeTokenAddr = getAddress(spokeEntry.token) as Address
          const [fee, sourceTokenSymbol, decimals] = await Promise.all([
            client.readContract({
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
            }),
            readTokenSymbol(client, spokeTokenAddr, symbol),
            readTokenDecimals(client, spokeTokenAddr),
          ])
          results.push({
            symbol,
            spokeChainId,
            depositType:      'oft-compose',
            spokeOft:         getAddress(spokeEntry.oft) as Address,
            spokeToken:       spokeTokenAddr,
            sourceTokenSymbol,
            hubOft:           getAddress(hubEntry.oft) as Address,
            oftCmd,
            lzFeeEstimate:    fee.nativeFee,
            nativeSymbol:     NATIVE_SYMBOL[spokeChainId] ?? 'ETH',
            decimals,
          })
        } catch { /* route not available — skip */ }
      })
    )
  }

  // ── Hub direct route ──────────────────────────────────────
  const hubOftEntry = Object.entries(OFT_ROUTES)
    .map(([symbol, chainMap]) => {
      const hubEntry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId]
      if (!hubEntry || getAddress(hubEntry.token) !== asset) return null
      return { symbol, hubEntry }
    })
    .find(e => e !== null) ?? null

  if (hubOftEntry) {
    const { symbol, hubEntry } = hubOftEntry
    const hubTokenAddr = getAddress(hubEntry.token) as Address
    const [sourceTokenSymbol, lzFeeEstimate, decimals] = await Promise.all([
      readTokenSymbol(hubClient!, hubTokenAddr, symbol),
      asyncMode ? quoteLzFee(hubClient!, vault) : Promise.resolve(0n),
      readTokenDecimals(hubClient!, hubTokenAddr),
    ])
    results.unshift({
      symbol,
      spokeChainId:     hubChainId,
      depositType:      asyncMode ? 'direct-async' : 'direct',
      spokeOft:         null,
      spokeToken:       hubTokenAddr,
      sourceTokenSymbol,
      hubOft:           null,
      oftCmd:           '0x',
      lzFeeEstimate,
      nativeSymbol:     NATIVE_SYMBOL[hubChainId] ?? 'ETH',
      decimals,
    })
  } else {
    // No OFT route — direct deposit with the token as-is (local vaults, non-OFT tokens)
    const hubTokenAddr = asset
    const [sourceTokenSymbol, lzFeeEstimate, decimals] = await Promise.all([
      readTokenSymbol(hubClient!, hubTokenAddr, 'UNKNOWN'),
      asyncMode ? quoteLzFee(hubClient!, vault) : Promise.resolve(0n),
      readTokenDecimals(hubClient!, hubTokenAddr),
    ])
    results.unshift({
      symbol:           sourceTokenSymbol,
      spokeChainId:     hubChainId,
      depositType:      asyncMode ? 'direct-async' : 'direct',
      spokeOft:         null,
      spokeToken:       hubTokenAddr,
      sourceTokenSymbol,
      hubOft:           null,
      oftCmd:           '0x',
      lzFeeEstimate,
      nativeSymbol:     NATIVE_SYMBOL[hubChainId] ?? 'ETH',
      decimals,
    })
  }

  return results
}

/**
 * Find all valid inbound deposit routes for a vault.
 *
 * Accepts a single asset address **or an array** of depositable asset addresses.
 * When an array is passed (multi-asset vaults), routes for each asset are fetched
 * in parallel and merged — topology and async-mode are fetched only once.
 *
 * The hub chain is always included as a 'direct' (or 'direct-async') option for
 * every depositable asset, even if the token is not in OFT_ROUTES.
 *
 * Routes that revert on quoteSend() (no liquidity, no peer) are excluded silently.
 *
 * @param hubChainId   Chain ID of the vault hub (e.g. 747 for Flow EVM)
 * @param vault        Vault address
 * @param vaultAsset   Single asset address OR array of depositable asset addresses
 * @param userAddress  User address (used as receiver for fee quotes)
 * @returns            Array of InboundRoute objects; hub direct route(s) are first
 */
export async function getInboundRoutes(
  hubChainId: number,
  vault: Address,
  vaultAsset: Address | Address[],
  userAddress: Address,
): Promise<InboundRoute[]> {
  const hubEid = CHAIN_ID_TO_EID[hubChainId]
  if (!hubEid) throw new MoreVaultsError(`No LZ EID for hub chainId ${hubChainId}`)

  const hubClient = createChainClient(hubChainId)
  if (!hubClient) throw new MoreVaultsError(`No public RPC for hub chainId ${hubChainId}`)

  // Fetch topology and async mode once, shared across all assets
  const [topology, asyncMode] = await Promise.all([
    getVaultTopology(hubClient, vault),
    isAsyncMode(hubClient, vault),
  ])
  const registeredSpokes = new Set<number>(topology.spokeChainIds)

  const assets = Array.isArray(vaultAsset) ? vaultAsset : [vaultAsset]

  // Fetch routes for each asset in parallel, then merge and dedup by (spokeChainId + spokeToken)
  const perAsset = await Promise.all(
    assets.map(asset =>
      _getRoutesForAsset(hubChainId, hubEid, vault, asset, userAddress, hubClient, registeredSpokes, asyncMode)
    )
  )

  const seen = new Set<string>()
  const merged: InboundRoute[] = []
  for (const routes of perAsset) {
    for (const r of routes) {
      const key = `${r.spokeChainId}:${r.spokeToken}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(r)
      }
    }
  }

  return merged
}

/**
 * Fetch user token balances for each inbound route in parallel.
 *
 * Routes with native token as the source (zeroAddress) return the chain's
 * native gas balance instead of an ERC-20 balance.
 *
 * @param routes       Array of InboundRoute objects from getInboundRoutes
 * @param userAddress  User wallet address to query balances for
 * @returns            Each route extended with the user's current token balance
 */
export async function getUserBalancesForRoutes(
  routes: InboundRoute[],
  userAddress: Address,
): Promise<InboundRouteWithBalance[]> {
  return Promise.all(
    routes.map(async (route) => {
      const client = createChainClient(route.spokeChainId)
      if (!client) return { ...route, userBalance: 0n }

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
 * @returns           Array of OutboundRoute objects; hub is always at index 0
 */
export async function getOutboundRoutes(
  hubChainId: number,
  vault: Address,
): Promise<OutboundRoute[]> {
  const hubEid = CHAIN_ID_TO_EID[hubChainId]
  if (!hubEid) throw new MoreVaultsError(`No LZ EID for hub chainId ${hubChainId}`)

  const hubClient = createChainClient(hubChainId)
  if (!hubClient) throw new MoreVaultsError(`No public RPC for hub chainId ${hubChainId}`)

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
  if (!hubEid) throw new MoreVaultsError(`No LZ EID for hub chainId ${hubChainId}`)

  if (!route.spokeOft) throw new MoreVaultsError('Route is oft-compose but spokeOft is null')

  const client = createChainClient(route.spokeChainId)
  if (!client) throw new MoreVaultsError(`No public RPC for spoke chainId ${route.spokeChainId}`)

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
