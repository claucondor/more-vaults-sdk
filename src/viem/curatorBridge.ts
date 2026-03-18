/**
 * Curator BridgeFacet helpers for the MoreVaults SDK.
 *
 * Provides typed helpers to quote and execute cross-chain asset bridging
 * via BridgeFacet.executeBridging on any MoreVaults diamond.
 *
 * Key flows:
 *   1. `quoteCuratorBridgeFee`  — read-only fee estimation via LzAdapter
 *   2. `executeCuratorBridge`   — send bridging transaction (curator only)
 *   3. `encodeBridgeParams`     — encode the 5-field bridgeSpecificParams bytes
 *   4. `findBridgeRoute`        — resolve OFT route for a token on given chains
 *
 * Bridge call flow:
 *   curator → vault.executeBridging(adapter, token, amount, bridgeSpecificParams)
 *   bridgeSpecificParams = abi.encode(oftToken, dstEid, amount, dstVault, refundAddress)
 *
 * Quote call flow:
 *   publicClient → lzAdapter.quoteBridgeFee(encode(oftToken, dstEid, amount, dstVault))
 *
 * @module curatorBridge
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  type Hash,
  encodeAbiParameters,
  getAddress,
} from 'viem'
import { BRIDGE_FACET_ABI, LZ_ADAPTER_ABI } from './abis.js'
import { OFT_ROUTES } from './chains.js'
import { getCuratorVaultStatus } from './curatorStatus.js'
import { parseContractError } from './errorParser.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for a curator bridge operation.
 * Used in both quoting (4-field) and execution (5-field with refundAddress).
 */
export interface CuratorBridgeParams {
  /** OFT contract address on the source chain (from OFT_ROUTES[symbol][chainId].oft) */
  oftToken: Address
  /** LayerZero endpoint ID of the destination chain */
  dstEid: number
  /** Amount to bridge (in token's native units) */
  amount: bigint
  /** Vault address on the destination chain (hub or spoke) */
  dstVault: Address
  /** Address where excess LayerZero gas refunds are sent (usually the curator wallet) */
  refundAddress: Address
}

// ─────────────────────────────────────────────────────────────────────────────
// Encoding helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode the 5-field bridgeSpecificParams for use in `executeBridging`.
 *
 * Encodes: (oftToken, dstEid, amount, dstVault, refundAddress)
 * Types:   (address,  uint32, uint256, address,  address)
 *
 * @param params  Full bridge parameters including refundAddress
 * @returns       ABI-encoded bytes (`0x`-prefixed hex string)
 */
export function encodeBridgeParams(params: CuratorBridgeParams): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'uint32' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'address' },
    ],
    [
      getAddress(params.oftToken),
      params.dstEid,
      params.amount,
      getAddress(params.dstVault),
      getAddress(params.refundAddress),
    ],
  )
}

/**
 * Encode the 4-field bridgeSpecificParams for `quoteBridgeFee`.
 * Does NOT include refundAddress — quoting only needs the routing parameters.
 *
 * Encodes: (oftToken, dstEid, amount, dstVault)
 * Types:   (address,  uint32, uint256, address)
 *
 * @internal
 */
function encodeBridgeParamsForQuote(params: Omit<CuratorBridgeParams, 'refundAddress'>): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'uint32' },
      { type: 'uint256' },
      { type: 'address' },
    ],
    [
      getAddress(params.oftToken),
      params.dstEid,
      params.amount,
      getAddress(params.dstVault),
    ],
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Route resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the OFT bridge route for a given token address on the source chain.
 *
 * Searches OFT_ROUTES for an asset whose `token` or `oft` field matches
 * the provided address on the given source chainId.
 *
 * @param srcChainId    EVM chain ID of the source chain (where the vault holds the token)
 * @param dstChainId    EVM chain ID of the destination chain
 * @param tokenAddress  ERC-20 token address on the source chain
 * @returns             Route info or null if no matching route exists
 *
 * @example
 * ```typescript
 * const route = findBridgeRoute(8453, 1, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
 * // → { symbol: 'stgUSDC', oftHub: '0x27a1...', oftSpoke: '0xc026...' }
 * ```
 */
export function findBridgeRoute(
  srcChainId: number,
  dstChainId: number,
  tokenAddress: Address,
): { oftSrc: Address; oftDst: Address; symbol: string } | null {
  const normalizedToken = getAddress(tokenAddress)

  for (const [symbol, chains] of Object.entries(OFT_ROUTES)) {
    const srcEntry = (chains as Record<number, { oft: `0x${string}`; token: `0x${string}` }>)[srcChainId]
    const dstEntry = (chains as Record<number, { oft: `0x${string}`; token: `0x${string}` }>)[dstChainId]

    if (!srcEntry || !dstEntry) continue

    // Match if the provided address is either the token OR the OFT on the source chain
    const srcToken = getAddress(srcEntry.token)
    const srcOft = getAddress(srcEntry.oft)

    if (srcToken === normalizedToken || srcOft === normalizedToken) {
      return {
        oftSrc: srcOft,
        oftDst: getAddress(dstEntry.oft),
        symbol,
      }
    }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quote the native fee required to bridge assets via the vault's LzAdapter.
 *
 * Calls `lzAdapter.quoteBridgeFee(bridgeSpecificParams)` using a 4-field
 * encoding (no refundAddress). The returned fee must be sent as `msg.value`
 * when calling `executeBridging`.
 *
 * @param publicClient  Viem public client (must be on the vault's chain)
 * @param vault         Hub vault address (diamond proxy)
 * @param params        Bridge parameters (refundAddress is optional here)
 * @returns             Native fee in wei
 *
 * @example
 * ```typescript
 * const fee = await quoteCuratorBridgeFee(publicClient, VAULT, {
 *   oftToken: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26', // stgUSDC on Base
 *   dstEid: 30101,   // Ethereum EID
 *   amount: 1_000_000n, // 1 USDC
 *   dstVault: '0xSpokeVault...',
 *   refundAddress: '0xCurator...',
 * })
 * console.log('Fee:', formatEther(fee), 'ETH')
 * ```
 */
export async function quoteCuratorBridgeFee(
  publicClient: PublicClient,
  vault: Address,
  params: CuratorBridgeParams,
): Promise<bigint> {
  // Get lzAdapter from vault status
  const status = await getCuratorVaultStatus(publicClient, vault)
  const lzAdapter = status.lzAdapter

  // Encode 4-field params (no refundAddress) for quoting
  const bridgeSpecificParams = encodeBridgeParamsForQuote(params)

  // Call quoteBridgeFee on the LzAdapter (not the vault)
  try {
    const nativeFee = await publicClient.readContract({
      address: lzAdapter,
      abi: LZ_ADAPTER_ABI,
      functionName: 'quoteBridgeFee',
      args: [bridgeSpecificParams],
    })
    return nativeFee as bigint
  } catch (err) {
    parseContractError(err, vault)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a curator bridge operation via `BridgeFacet.executeBridging`.
 *
 * This is a direct curator call (NOT via multicall). The vault pauses during
 * bridging for security. The `token` passed to executeBridging is the underlying
 * ERC-20, NOT the OFT address.
 *
 * Steps:
 *   1. Get lzAdapter from `getCuratorVaultStatus`
 *   2. Quote the native bridge fee
 *   3. Encode 5-field bridgeSpecificParams
 *   4. Call `vault.executeBridging(adapter, token, amount, bridgeSpecificParams)` with fee as value
 *
 * @param walletClient   Wallet client with curator account attached
 * @param publicClient   Public client for reads and fee quoting
 * @param vault          Hub vault address (diamond proxy)
 * @param token          Underlying ERC-20 token address (NOT the OFT address)
 * @param params         Full bridge parameters including refundAddress
 * @returns              Transaction hash
 * @throws               If caller is not curator, vault is paused, or bridge fails
 *
 * @example
 * ```typescript
 * const txHash = await executeCuratorBridge(walletClient, publicClient, VAULT, USDC_ADDRESS, {
 *   oftToken: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26',
 *   dstEid: 30101,
 *   amount: 1_000_000n,
 *   dstVault: '0xSpokeVault...',
 *   refundAddress: curatorAddress,
 * })
 * ```
 */
export async function executeCuratorBridge(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vault: Address,
  token: Address,
  params: CuratorBridgeParams,
): Promise<Hash> {
  const account = walletClient.account!
  const v = getAddress(vault)

  // Step 1: Get lzAdapter address from vault status
  const status = await getCuratorVaultStatus(publicClient, vault)
  const lzAdapter = status.lzAdapter

  // Step 2: Quote the bridge fee
  const fee = await quoteCuratorBridgeFee(publicClient, vault, params)

  // Step 3: Encode full 5-field bridgeSpecificParams
  const bridgeSpecificParams = encodeBridgeParams(params)

  // Step 4: Simulate then execute bridging with fee as msg.value
  try {
    await publicClient.simulateContract({
      address: v,
      abi: BRIDGE_FACET_ABI,
      functionName: 'executeBridging',
      args: [
        lzAdapter,
        getAddress(token),
        params.amount,
        bridgeSpecificParams,
      ],
      value: fee,
      account: account.address,
    })
  } catch (err) {
    parseContractError(err, v, account.address)
  }

  const txHash = await walletClient.writeContract({
    address: v,
    abi: BRIDGE_FACET_ABI,
    functionName: 'executeBridging',
    args: [
      lzAdapter,
      getAddress(token),
      params.amount,
      bridgeSpecificParams,
    ],
    value: fee,
    account,
    chain: walletClient.chain,
  })

  return txHash
}
