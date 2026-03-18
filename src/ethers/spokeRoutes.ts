/**
 * Spoke route helpers for the MoreVaults ethers.js v6 SDK.
 *
 * Provides functions to discover inbound/outbound cross-chain deposit and
 * redemption routes, and to quote LayerZero fees for those routes.
 */

import { Contract, ZeroAddress } from "ethers";
import type { Provider } from "ethers";
import { OFT_ROUTES, CHAIN_ID_TO_EID, createChainProvider } from "./chains";
import { OFT_ABI, ERC20_ABI } from "./abis";
import { isAsyncMode, quoteLzFee } from "./utils";
import { getVaultTopology } from "./topology";
import { MoreVaultsError } from "./errors";

// ─────────────────────────────────────────────────────────────────────────────

export interface OutboundRoute {
  /** Chain ID where user can receive shares/assets */
  chainId: number;
  /** Whether this chain is the hub (direct redeem) or a spoke (shares bridged back) */
  routeType: "hub" | "spoke";
  /** LZ EID for this chain */
  eid: number;
  /** Native gas symbol */
  nativeSymbol: string;
}

export interface InboundRoute {
  /** Internal route identifier from OFT_ROUTES (e.g. 'stgUSDC') — do NOT show to users */
  symbol: string;
  /** Chain ID where user sends from */
  spokeChainId: number;
  /**
   * How the deposit is executed:
   * - 'direct'       → user is on the hub chain, vault uses standard ERC-4626 (depositSimple). No LZ fee.
   * - 'direct-async' → user is on the hub chain, vault uses async accounting (depositAsync). LZ fee required.
   * - 'oft-compose'  → user is on a spoke chain, use depositFromSpoke via OFT compose. LZ fee required.
   */
  depositType: "direct" | "direct-async" | "oft-compose";
  /** OFT contract on spoke chain — pass as `spokeOFT` to depositFromSpoke. Null for direct deposits. */
  spokeOft: string | null;
  /** Token user must approve on spoke chain (ZeroAddress = native ETH) */
  spokeToken: string;
  /**
   * Human-readable symbol of the token the user needs to hold on the spoke chain.
   * For OFTAdapters this is the underlying token symbol (e.g. 'USDC', 'weETH').
   * For pure OFTs this is the OFT's own symbol (e.g. 'sUSDe', 'USDe').
   * Use this — not `symbol` — when displaying the token name to users.
   */
  sourceTokenSymbol: string;
  /** OFT contract on hub chain — receives tokens for the composer. Null for direct deposits. */
  hubOft: string | null;
  /** oftCmd to use in SendParam (0x01 for Stargate taxi, 0x for standard OFT) */
  oftCmd: string;
  /** LZ fee estimate in native wei of the SPOKE chain (not always ETH — e.g. FLOW on Flow EVM) */
  lzFeeEstimate: bigint;
  /** Native gas token symbol for the spoke chain — use this when displaying the fee */
  nativeSymbol: string;
}

export interface InboundRouteWithBalance extends InboundRoute {
  /** User's token balance on the spoke chain */
  userBalance: bigint;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Native gas token symbol per chain ID — lzFeeEstimate is denominated in this token */
export const NATIVE_SYMBOL: Partial<Record<number, string>> = {
  1:     "ETH",
  10:    "ETH",
  42161: "ETH",
  8453:  "ETH",
  747:   "FLOW",
  146:   "S",
  56:    "BNB",
};

// ─────────────────────────────────────────────────────────────────────────────

const SYMBOL_ABI = [
  "function symbol() view returns (string)",
] as const;

/** Read ERC20 symbol() on-chain. Falls back to `fallbackSymbol` if the call fails. */
async function readTokenSymbol(
  provider: Provider | null,
  token: string,
  fallbackSymbol: string,
): Promise<string> {
  if (!provider) return fallbackSymbol;
  try {
    const contract = new Contract(token, SYMBOL_ABI, provider);
    return await (contract.symbol() as Promise<string>);
  } catch {
    return fallbackSymbol;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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
  vault: string,
  vaultAsset: string,
  userAddress: string,
): Promise<InboundRoute[]> {
  const hubEid = CHAIN_ID_TO_EID[hubChainId];
  if (!hubEid) throw new MoreVaultsError(`No LZ EID for hub chainId ${hubChainId}`);

  // Fetch vault topology to get registered spoke chains
  const hubProvider = createChainProvider(hubChainId);
  if (!hubProvider) throw new MoreVaultsError(`No public RPC for hub chainId ${hubChainId}`);
  const topology = await getVaultTopology(hubProvider, vault);
  const registeredSpokes = new Set(topology.spokeChainIds);

  const results: InboundRoute[] = [];

  const vaultAssetNorm = vaultAsset.toLowerCase();

  for (const [symbol, chainMap] of Object.entries(OFT_ROUTES)) {
    const hubEntry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId];
    if (!hubEntry) continue;

    // Does this OFT deliver the right asset to the hub?
    if (hubEntry.token.toLowerCase() !== vaultAssetNorm) continue;

    // oftCmd for OFT compose deposits: always '0x' (TAXI mode = immediate delivery with composeMsg).
    const oftCmd = "0x";

    // Only check chains where the vault has a registered spoke
    const spokesToCheck = Object.keys(chainMap)
      .map(Number)
      .filter((id) => id !== hubChainId && registeredSpokes.has(id));

    await Promise.allSettled(
      spokesToCheck.map(async (spokeChainId) => {
        const spokeEntry = (chainMap as Record<number, { oft: string; token: string }>)[spokeChainId];
        if (!spokeEntry) return;

        const spokeProvider = createChainProvider(spokeChainId);
        if (!spokeProvider) return;

        // Validate route via quoteSend — if it reverts, skip
        try {
          const receiverBytes32 =
            "0x" + userAddress.replace(/^0x/, "").toLowerCase().padStart(64, "0");

          const spokeOft = new Contract(spokeEntry.oft, OFT_ABI, spokeProvider);
          const [feeResult, sourceTokenSymbol] = await Promise.all([
            spokeOft.quoteSend(
              {
                dstEid: hubEid,
                to: receiverBytes32,
                amountLD: 1_000_000n,
                minAmountLD: 0n,
                extraOptions: "0x",
                composeMsg: "0x",
                oftCmd,
              },
              false,
            ),
            readTokenSymbol(spokeProvider, spokeEntry.token, symbol),
          ]);

          results.push({
            symbol,
            spokeChainId,
            depositType: "oft-compose",
            spokeOft: spokeEntry.oft,
            spokeToken: spokeEntry.token,
            sourceTokenSymbol,
            hubOft: hubEntry.oft,
            oftCmd,
            lzFeeEstimate: feeResult.nativeFee as bigint,
            nativeSymbol: NATIVE_SYMBOL[spokeChainId] ?? "ETH",
          });
        } catch {
          // Route not available — skip silently
        }
      }),
    );
  }

  // Add the hub chain itself as a deposit option.
  // For async vaults the vault uses depositAsync which requires a LZ fee even on the hub chain.
  const [asyncMode, ...hubOftEntries] = await Promise.all([
    isAsyncMode(hubProvider, vault),
    ...Object.entries(OFT_ROUTES).map(async ([sym, chainMap]) => {
      const hubEntry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId];
      if (!hubEntry || hubEntry.token.toLowerCase() !== vaultAssetNorm) return null;
      return { symbol: sym, hubEntry };
    }),
  ]);

  const hubOftEntry = hubOftEntries.find((e) => e !== null) ?? null;

  if (hubOftEntry) {
    const { symbol, hubEntry } = hubOftEntry as { symbol: string; hubEntry: { oft: string; token: string } };
    const [sourceTokenSymbol, lzFeeEstimate] = await Promise.all([
      readTokenSymbol(hubProvider, hubEntry.token, symbol),
      asyncMode ? quoteLzFee(hubProvider, vault) : Promise.resolve(0n),
    ]);
    results.unshift({
      symbol,
      spokeChainId: hubChainId,
      depositType: asyncMode ? "direct-async" : "direct",
      spokeOft: null,
      spokeToken: hubEntry.token,
      sourceTokenSymbol,
      hubOft: null,
      oftCmd: "0x",
      lzFeeEstimate,
      nativeSymbol: NATIVE_SYMBOL[hubChainId] ?? "ETH",
    });
  }

  return results;
}

/**
 * Fetch user token balances for each inbound route in parallel.
 * Routes with native ETH as token (ZeroAddress) return the chain's ETH balance.
 *
 * @param routes       Inbound routes from getInboundRoutes()
 * @param userAddress  User wallet address
 */
export async function getUserBalancesForRoutes(
  routes: InboundRoute[],
  userAddress: string,
): Promise<InboundRouteWithBalance[]> {
  return Promise.all(
    routes.map(async (route) => {
      const provider = createChainProvider(route.spokeChainId);
      if (!provider) return { ...route, userBalance: 0n };

      try {
        let userBalance: bigint;

        if (route.spokeToken.toLowerCase() === ZeroAddress.toLowerCase()) {
          userBalance = await provider.getBalance(userAddress);
        } else {
          const erc20 = new Contract(route.spokeToken, ERC20_ABI, provider);
          userBalance = await (erc20.balanceOf(userAddress) as Promise<bigint>);
        }

        return { ...route, userBalance };
      } catch {
        return { ...route, userBalance: 0n };
      }
    }),
  );
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
  vault: string,
): Promise<OutboundRoute[]> {
  const hubEid = CHAIN_ID_TO_EID[hubChainId];
  if (!hubEid) throw new MoreVaultsError(`No LZ EID for hub chainId ${hubChainId}`);

  const hubProvider = createChainProvider(hubChainId);
  if (!hubProvider) throw new MoreVaultsError(`No public RPC for hub chainId ${hubChainId}`);

  const topology = await getVaultTopology(hubProvider, vault);

  const routes: OutboundRoute[] = [
    {
      chainId: hubChainId,
      routeType: "hub",
      eid: hubEid,
      nativeSymbol: NATIVE_SYMBOL[hubChainId] ?? "ETH",
    },
  ];

  for (const spokeChainId of topology.spokeChainIds) {
    const eid = CHAIN_ID_TO_EID[spokeChainId];
    if (!eid) continue;

    routes.push({
      chainId: spokeChainId,
      routeType: "spoke",
      eid,
      nativeSymbol: NATIVE_SYMBOL[spokeChainId] ?? "ETH",
    });
  }

  return routes;
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
  userAddress: string,
): Promise<bigint> {
  if (route.depositType === "direct") return 0n;

  const hubEid = CHAIN_ID_TO_EID[hubChainId];
  if (!hubEid) throw new Error(`No LZ EID for hub chainId ${hubChainId}`);

  if (!route.spokeOft) throw new MoreVaultsError("Route is oft-compose but spokeOft is null");

  const spokeProvider = createChainProvider(route.spokeChainId);
  if (!spokeProvider) throw new MoreVaultsError(`No public RPC for spoke chainId ${route.spokeChainId}`);

  const receiverBytes32 =
    "0x" + userAddress.replace(/^0x/, "").toLowerCase().padStart(64, "0");

  const spokeOft = new Contract(route.spokeOft, OFT_ABI, spokeProvider);
  const feeResult = await spokeOft.quoteSend(
    {
      dstEid: hubEid,
      to: receiverBytes32,
      amountLD: amount,
      minAmountLD: 0n,
      extraOptions: "0x",
      composeMsg: "0x",
      oftCmd: route.oftCmd,
    },
    false,
  );

  return feeResult.nativeFee as bigint;
}
