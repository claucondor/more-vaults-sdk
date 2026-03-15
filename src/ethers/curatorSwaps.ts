/**
 * Curator swap helpers for Uniswap V3-compatible DEXes.
 *
 * Provides typed helpers to build CuratorAction objects and raw calldata for
 * Uniswap V3 exactInputSingle swaps, automatically resolving the correct router
 * and ABI variant (SwapRouter vs SwapRouter02) per chain.
 *
 * Supported chains and routers:
 *   - Base (8453):        SwapRouter02 0x2626...  — NO deadline field
 *   - Ethereum (1):       SwapRouter   0xE592...  — HAS deadline field
 *   - Arbitrum (42161):   SwapRouter   0xE592...  — HAS deadline field
 *   - Optimism (10):      SwapRouter   0xE592...  — HAS deadline field
 *   - Flow EVM (747):     FlowSwap V3  0xeEDC...  — HAS deadline field
 *
 * @module curatorSwaps
 */

import { Interface } from "ethers";
import { UNISWAP_V3_ROUTERS } from "./chains";
import type { CuratorAction } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// ABI constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uniswap V3 SwapRouter exactInputSingle ABI (human-readable).
 * Used for: Ethereum (1), Arbitrum (42161), Optimism (10), Flow EVM (747).
 * Struct includes `deadline` field.
 */
const UNISWAP_V3_SWAP_ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
] as const;

/**
 * Uniswap V3 SwapRouter02 exactInputSingle ABI (human-readable).
 * Used for: Base (8453).
 * Struct does NOT include `deadline` field — SwapRouter02 removed it.
 */
const UNISWAP_V3_SWAP_ROUTER02_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Chain variant detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chains that use SwapRouter02 (no deadline in struct).
 * All other chains in UNISWAP_V3_ROUTERS use the original SwapRouter.
 */
const SWAP_ROUTER02_CHAINS = new Set([8453]);

// ─────────────────────────────────────────────────────────────────────────────
// Calldata encoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode Uniswap V3 exactInputSingle calldata directly.
 * For curators who want raw calldata without the CuratorAction wrapper.
 *
 * Automatically selects the correct ABI variant (SwapRouter vs SwapRouter02)
 * based on the chainId. The deadline (for SwapRouter chains) is set to
 * `now + 20 minutes` to prevent stale transactions from executing.
 *
 * @param params.chainId       EVM chain ID — must be present in UNISWAP_V3_ROUTERS
 * @param params.tokenIn       Input token address
 * @param params.tokenOut      Output token address
 * @param params.fee           Pool fee tier: 100, 500, 3000, or 10000
 * @param params.amountIn      Exact input amount (in tokenIn units)
 * @param params.minAmountOut  Minimum acceptable output (slippage protection)
 * @param params.recipient     Address to receive the output tokens (usually the vault)
 * @returns                    The router contract address and ABI-encoded calldata
 * @throws                     If no router is configured for the given chainId
 */
export function encodeUniswapV3SwapCalldata(params: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  fee: number;
  amountIn: bigint;
  minAmountOut: bigint;
  recipient: string;
}): { targetContract: string; swapCallData: string } {
  const { chainId, tokenIn, tokenOut, fee, amountIn, minAmountOut, recipient } = params;

  const router = UNISWAP_V3_ROUTERS[chainId];
  if (!router) {
    throw new Error(
      `[MoreVaults] No Uniswap V3 router configured for chainId ${chainId}. ` +
      `Supported chains: ${Object.keys(UNISWAP_V3_ROUTERS).join(', ')}`
    );
  }

  let swapCallData: string;

  if (SWAP_ROUTER02_CHAINS.has(chainId)) {
    // SwapRouter02 (Base) — no deadline field
    const iface = new Interface(UNISWAP_V3_SWAP_ROUTER02_ABI as unknown as string[]);
    swapCallData = iface.encodeFunctionData("exactInputSingle", [
      {
        tokenIn,
        tokenOut,
        fee,
        recipient,
        amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0n,
      },
    ]);
  } else {
    // Original SwapRouter (Eth/Arb/Op/Flow EVM) — has deadline field
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // now + 20 minutes
    const iface = new Interface(UNISWAP_V3_SWAP_ROUTER_ABI as unknown as string[]);
    swapCallData = iface.encodeFunctionData("exactInputSingle", [
      {
        tokenIn,
        tokenOut,
        fee,
        recipient,
        deadline,
        amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0n,
      },
    ]);
  }

  return { targetContract: router, swapCallData };
}

// ─────────────────────────────────────────────────────────────────────────────
// CuratorAction builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a CuratorAction for a Uniswap V3 exactInputSingle swap.
 *
 * Automatically resolves the router address from UNISWAP_V3_ROUTERS and
 * selects the correct ABI struct (with or without deadline) based on chainId.
 *
 * The returned action is a `swap` variant ready to be passed to
 * `buildCuratorBatch` and then `submitActions`.
 *
 * @param params.chainId       EVM chain ID — must be present in UNISWAP_V3_ROUTERS
 * @param params.tokenIn       Input token address
 * @param params.tokenOut      Output token address
 * @param params.fee           Pool fee tier: 100, 500, 3000, or 10000
 * @param params.amountIn      Exact input amount (in tokenIn units)
 * @param params.minAmountOut  Minimum acceptable output (slippage protection)
 * @param params.recipient     Address to receive output tokens (usually the vault)
 * @returns                    A typed CuratorAction ready for buildCuratorBatch
 * @throws                     If no router is configured for the given chainId
 *
 * @example
 * ```typescript
 * const action = buildUniswapV3Swap({
 *   chainId: 8453,
 *   tokenIn:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
 *   tokenOut: '0x4200000000000000000000000000000000000006', // WETH
 *   fee: 500,           // 0.05% pool
 *   amountIn: 150_000n, // 0.15 USDC (6 decimals)
 *   minAmountOut: 1n,   // accept any amount (set properly in production)
 *   recipient: VAULT,
 * })
 * const batch = buildCuratorBatch([action])
 * await submitActions(signer, vault, batch)
 * ```
 */
export function buildUniswapV3Swap(params: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  fee: number;
  amountIn: bigint;
  minAmountOut: bigint;
  recipient: string;
}): CuratorAction {
  const { targetContract, swapCallData } = encodeUniswapV3SwapCalldata(params);

  return {
    type: 'swap',
    params: {
      targetContract,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      maxAmountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      swapCallData,
    },
  };
}
