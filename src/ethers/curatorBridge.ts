/**
 * Curator BridgeFacet helpers for the MoreVaults ethers.js v6 SDK.
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
 * @module curatorBridge
 */

import { AbiCoder, Contract, getAddress } from "ethers";
import type { Provider, Signer, ContractTransactionReceipt } from "ethers";
import { BRIDGE_FACET_ABI, LZ_ADAPTER_ABI } from "./abis";
import { OFT_ROUTES } from "./chains";
import { getCuratorVaultStatus } from "./curatorStatus";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for a curator bridge operation.
 */
export interface CuratorBridgeParams {
  /** OFT contract address on the source chain (from OFT_ROUTES[symbol][chainId].oft) */
  oftToken: string;
  /** LayerZero endpoint ID of the destination chain */
  dstEid: number;
  /** Amount to bridge (in token's native units) */
  amount: bigint;
  /** Vault address on the destination chain (hub or spoke) */
  dstVault: string;
  /** Address where excess LayerZero gas refunds are sent (usually the curator wallet) */
  refundAddress: string;
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
 * @returns       ABI-encoded hex string
 */
export function encodeBridgeParams(params: CuratorBridgeParams): string {
  const coder = AbiCoder.defaultAbiCoder();
  return coder.encode(
    ["address", "uint32", "uint256", "address", "address"],
    [
      getAddress(params.oftToken),
      params.dstEid,
      params.amount,
      getAddress(params.dstVault),
      getAddress(params.refundAddress),
    ]
  );
}

/**
 * Encode the 4-field bridgeSpecificParams for `quoteBridgeFee`.
 * Does NOT include refundAddress — quoting only needs routing parameters.
 *
 * @internal
 */
function encodeBridgeParamsForQuote(
  params: Omit<CuratorBridgeParams, "refundAddress">
): string {
  const coder = AbiCoder.defaultAbiCoder();
  return coder.encode(
    ["address", "uint32", "uint256", "address"],
    [
      getAddress(params.oftToken),
      params.dstEid,
      params.amount,
      getAddress(params.dstVault),
    ]
  );
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
 * @param srcChainId    EVM chain ID of the source chain
 * @param dstChainId    EVM chain ID of the destination chain
 * @param tokenAddress  ERC-20 token address on the source chain
 * @returns             Route info or null if no matching route exists
 */
export function findBridgeRoute(
  srcChainId: number,
  dstChainId: number,
  tokenAddress: string
): { oftSrc: string; oftDst: string; symbol: string } | null {
  const normalizedToken = getAddress(tokenAddress);

  for (const [symbol, chains] of Object.entries(OFT_ROUTES)) {
    const srcEntry = (
      chains as Record<number, { oft: string; token: string }>
    )[srcChainId];
    const dstEntry = (
      chains as Record<number, { oft: string; token: string }>
    )[dstChainId];

    if (!srcEntry || !dstEntry) continue;

    const srcToken = getAddress(srcEntry.token);
    const srcOft = getAddress(srcEntry.oft);

    if (srcToken === normalizedToken || srcOft === normalizedToken) {
      return {
        oftSrc: srcOft,
        oftDst: getAddress(dstEntry.oft),
        symbol,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quote the native fee required to bridge assets via the vault's LzAdapter.
 *
 * Calls `lzAdapter.quoteBridgeFee(bridgeSpecificParams)` using a 4-field
 * encoding (no refundAddress). The returned fee must be sent as `value`
 * when calling `executeBridging`.
 *
 * @param provider  Read-only provider (must be on the vault's chain)
 * @param vault     Hub vault address (diamond proxy)
 * @param params    Bridge parameters (refundAddress is included but not encoded for quote)
 * @returns         Native fee in wei
 *
 * @example
 * ```typescript
 * const fee = await quoteCuratorBridgeFee(provider, VAULT, {
 *   oftToken: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26',
 *   dstEid: 30101,
 *   amount: 1_000_000n,
 *   dstVault: '0xSpokeVault...',
 *   refundAddress: '0xCurator...',
 * })
 * ```
 */
export async function quoteCuratorBridgeFee(
  provider: Provider,
  vault: string,
  params: CuratorBridgeParams
): Promise<bigint> {
  const status = await getCuratorVaultStatus(provider, vault);
  const lzAdapter = status.lzAdapter;

  const bridgeSpecificParams = encodeBridgeParamsForQuote(params);

  const adapterContract = new Contract(lzAdapter, LZ_ADAPTER_ABI, provider);
  const nativeFee = (await adapterContract.quoteBridgeFee.staticCall(
    bridgeSpecificParams
  )) as bigint;

  return nativeFee;
}

// ─────────────────────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a curator bridge operation via `BridgeFacet.executeBridging`.
 *
 * This is a direct curator call (NOT via multicall). The vault pauses during
 * bridging for security. The `token` parameter is the underlying ERC-20,
 * NOT the OFT address.
 *
 * Steps:
 *   1. Get lzAdapter from `getCuratorVaultStatus`
 *   2. Quote the native bridge fee
 *   3. Encode 5-field bridgeSpecificParams
 *   4. Call `vault.executeBridging(adapter, token, amount, bridgeSpecificParams)` with fee as value
 *
 * @param signer  Signer with curator account attached
 * @param vault   Hub vault address (diamond proxy)
 * @param token   Underlying ERC-20 token address (NOT the OFT address)
 * @param params  Full bridge parameters including refundAddress
 * @returns       Transaction receipt
 * @throws        If caller is not curator, vault is paused, or bridge fails
 */
export async function executeCuratorBridge(
  signer: Signer,
  vault: string,
  token: string,
  params: CuratorBridgeParams
): Promise<ContractTransactionReceipt> {
  const provider = signer.provider!;

  // Step 1: Get lzAdapter address from vault status
  const status = await getCuratorVaultStatus(provider, vault);
  const lzAdapter = status.lzAdapter;

  // Step 2: Quote the bridge fee
  const fee = await quoteCuratorBridgeFee(provider, vault, params);

  // Step 3: Encode full 5-field bridgeSpecificParams
  const bridgeSpecificParams = encodeBridgeParams(params);

  // Step 4: Execute bridging
  const vaultContract = new Contract(vault, BRIDGE_FACET_ABI, signer);
  const tx = await vaultContract.executeBridging(
    getAddress(lzAdapter),
    getAddress(token),
    params.amount,
    bridgeSpecificParams,
    { value: fee }
  );

  return tx.wait() as Promise<ContractTransactionReceipt>;
}
