/**
 * Pre-flight validation helpers for MoreVaults ethers.js v6 SDK flows.
 *
 * Each function reads on-chain state and throws a descriptive error BEFORE
 * the actual contract call, so developers see a clear, actionable message
 * instead of a raw VM revert.
 */

import { Contract, ZeroAddress } from "ethers";
import type { Provider } from "ethers";
import { CONFIG_ABI, BRIDGE_ABI, VAULT_ABI, ERC20_ABI, OFT_ABI } from "./abis";
import {
  InsufficientLiquidityError,
  VaultPausedError,
  CCManagerNotConfiguredError,
  EscrowNotConfiguredError,
  NotHubVaultError,
  CapacityFullError,
  InsufficientBalanceError,
  UnsupportedChainError,
  MoreVaultsError,
} from "./errors";
import { detectStargateOft } from "./utils";
import { EID_TO_CHAIN_ID, createChainProvider } from "./chains";
import { quoteComposeFee } from "./crossChainFlows";

/**
 * Pre-flight checks for async cross-chain flows (D4 / D5 / R5).
 *
 * Validates that:
 * 1. The CCManager is configured on the vault.
 * 2. An escrow is registered in the vault's registry.
 * 3. The vault is a hub (required for async flows).
 * 4. The vault does NOT have oracle-based cross-chain accounting enabled
 *    (oracle-on vaults should use depositSimple / depositCrossChainOracleOn).
 * 5. The vault is not paused.
 *
 * All reads that are independent of each other are executed in parallel via
 * Promise.all to minimise latency.
 *
 * @param provider  Read-only provider for contract reads
 * @param vault     Vault address (diamond proxy)
 * @param escrow    Escrow address from VaultAddresses
 */
export async function preflightAsync(
  provider: Provider,
  vault: string,
  escrow: string
): Promise<void> {
  const config = new Contract(vault, CONFIG_ABI, provider);
  const bridge = new Contract(vault, BRIDGE_ABI, provider);

  // Parallel read: ccManager, escrow, isHub, oraclesCrossChainAccounting, paused
  const [ccManager, registeredEscrow, isHub, oraclesEnabled, isPaused] =
    await Promise.all([
      config.getCrossChainAccountingManager() as Promise<string>,
      config.getEscrow() as Promise<string>,
      config.isHub() as Promise<boolean>,
      bridge.oraclesCrossChainAccounting() as Promise<boolean>,
      config.paused() as Promise<boolean>,
    ]);

  if (ccManager === ZeroAddress) {
    throw new CCManagerNotConfiguredError(vault)
  }

  if (registeredEscrow === ZeroAddress) {
    throw new EscrowNotConfiguredError(vault)
  }

  if (!isHub) {
    throw new NotHubVaultError(vault)
  }

  if (oraclesEnabled) {
    throw new MoreVaultsError(
      `[MoreVaults] Vault ${vault} has oracle-based cross-chain accounting enabled. Use depositSimple/depositCrossChainOracleOn instead of async flows.`
    )
  }

  if (isPaused) {
    throw new VaultPausedError(vault)
  }
}

/**
 * Pre-flight liquidity check for async redeem (R5).
 *
 * Reads the hub's liquid balance of the underlying token and compares it
 * against the assets the user expects to receive. If the hub does not hold
 * enough liquid assets the redeem will be auto-refunded after the LZ round-trip,
 * wasting the LayerZero fee.
 *
 * @param provider  Read-only provider for contract reads
 * @param vault     Vault address (diamond proxy)
 * @param shares    Shares the user intends to redeem
 */
export async function preflightRedeemLiquidity(
  provider: Provider,
  vault: string,
  shares: bigint
): Promise<void> {
  const config = new Contract(vault, CONFIG_ABI, provider);
  const bridge = new Contract(vault, BRIDGE_ABI, provider);

  // Check if this is a hub vault without oracle accounting.
  // Only those vaults can have liquidity stranded on spoke chains.
  const [isHub, oraclesEnabled]: [boolean, boolean] = await Promise.all([
    config.isHub(),
    bridge.oraclesCrossChainAccounting(),
  ]);

  // Non-hub vaults and oracle-on hubs hold all redeemable assets locally —
  // no liquidity gap is possible, so skip the check.
  if (!isHub || oraclesEnabled) return;

  const vaultContract = new Contract(vault, VAULT_ABI, provider);
  const underlying: string = await vaultContract.asset();

  const underlyingContract = new Contract(underlying, ERC20_ABI, provider);
  // NOTE: previewRedeem reverts on async cross-chain vaults (disabled by design).
  //       convertToAssets is always safe and gives a correct lower-bound estimate.
  const [hubLiquid, assetsNeeded]: [bigint, bigint] = await Promise.all([
    underlyingContract.balanceOf(vault),
    vaultContract.convertToAssets(shares),
  ]);

  if (hubLiquid < assetsNeeded) {
    throw new InsufficientLiquidityError(vault, hubLiquid, assetsNeeded);
  }
}

/**
 * Pre-flight checks for synchronous deposit flows (D1 / D3).
 *
 * Validates that:
 * 1. The vault is not paused.
 * 2. The vault still has deposit capacity (maxDeposit > 0).
 *
 * Both reads are executed in parallel.
 *
 * @param provider  Read-only provider for contract reads
 * @param vault     Vault address (diamond proxy)
 */
export async function preflightSync(
  provider: Provider,
  vault: string
): Promise<void> {
  const config = new Contract(vault, CONFIG_ABI, provider);

  // Run paused and maxDeposit in parallel.
  // maxDeposit(ZeroAddress) may REVERT on whitelisted vaults — catch separately.
  const [isPaused, depositCapResult] = await Promise.all([
    config.paused() as Promise<boolean>,
    (config.maxDeposit(ZeroAddress) as Promise<bigint>).catch(() => null as null),
  ]);

  if (isPaused) {
    throw new VaultPausedError(vault)
  }

  // null means maxDeposit reverted → whitelist vault — skip capacity check
  // (the user may still be whitelisted; canDeposit will do user-specific check)
  if (depositCapResult !== null && depositCapResult === 0n) {
    throw new CapacityFullError(vault)
  }
}

/**
 * Pre-flight checks for spoke-to-hub deposits (D6 / D7 via OFT Compose).
 *
 * Validates that:
 * 1. User has enough tokens on the spoke chain to deposit.
 * 2. User has enough native gas on the spoke chain for TX1 (OFT.send).
 * 3. For Stargate OFTs (2-TX flow): user has enough ETH on the hub chain for TX2.
 *
 * @param spokeProvider  Read-only provider on the SPOKE chain
 * @param vault          Vault address
 * @param spokeOFT       OFT contract address on the spoke chain
 * @param hubEid         LZ EID for the hub chain
 * @param spokeEid       LZ EID for the spoke chain
 * @param amount         Amount of tokens to deposit
 * @param userAddress    User's wallet address
 * @param lzFee          LZ fee for TX1 (from quoteDepositFromSpokeFee)
 * @returns              Object with validated balances for UI display
 */
export async function preflightSpokeDeposit(
  spokeProvider: Provider,
  vault: string,
  spokeOFT: string,
  hubEid: number,
  spokeEid: number,
  amount: bigint,
  userAddress: string,
  lzFee: bigint,
): Promise<{
  spokeTokenBalance: bigint
  spokeNativeBalance: bigint
  hubNativeBalance: bigint
  estimatedComposeFee: bigint
  isStargate: boolean
}> {
  // Read the underlying token address from the OFT
  const OFT_TOKEN_ABI = ["function token() view returns (address)"] as const;
  const oftContract = new Contract(spokeOFT, OFT_TOKEN_ABI, spokeProvider);
  const spokeToken: string = await oftContract.token();

  // Check token balance + native balance on spoke in parallel
  const tokenContract = new Contract(spokeToken, ERC20_ABI, spokeProvider);
  const [spokeTokenBalance, spokeNativeBalance]: [bigint, bigint] = await Promise.all([
    tokenContract.balanceOf(userAddress),
    spokeProvider.getBalance(userAddress),
  ]);

  // 1. Check token balance
  if (spokeTokenBalance < amount) {
    throw new InsufficientBalanceError(spokeToken, spokeTokenBalance as bigint, amount)
  }

  // 2. Check native gas for TX1 (lzFee + gas buffer)
  const gasBuffer = 500_000_000_000_000n; // 0.0005 ETH
  if (spokeNativeBalance < lzFee + gasBuffer) {
    throw new InsufficientBalanceError('native gas (spoke TX1)', spokeNativeBalance, lzFee + gasBuffer)
  }

  // 3. For Stargate OFTs: check ETH on hub for TX2 (compose retry)
  const isStargate = await detectStargateOft(spokeProvider, spokeOFT);

  let hubNativeBalance = 0n;
  let estimatedComposeFee = 0n;

  if (isStargate) {
    const hubChainId = EID_TO_CHAIN_ID[hubEid];
    const hubProvider = createChainProvider(hubChainId);
    if (hubProvider) {
      [hubNativeBalance, estimatedComposeFee] = await Promise.all([
        hubProvider.getBalance(userAddress),
        quoteComposeFee(hubProvider, vault, spokeEid, userAddress),
      ]);

      const hubGasBuffer = 300_000_000_000_000n; // 0.0003 ETH
      const totalNeeded = estimatedComposeFee + hubGasBuffer;

      if (hubNativeBalance < totalNeeded) {
        throw new InsufficientBalanceError('native gas (hub TX2)', hubNativeBalance, totalNeeded)
      }
    }
  }

  return {
    spokeTokenBalance,
    spokeNativeBalance,
    hubNativeBalance,
    estimatedComposeFee,
    isStargate,
  };
}

/**
 * Pre-flight checks for spoke→hub→spoke redeem (R6 + R1 + R7).
 *
 * Validates that:
 * 1. User has shares on the spoke chain.
 * 2. User has enough native gas on the spoke for TX1.
 * 3. User has enough native gas on the hub for TX2 (redeem) + TX3 (asset bridge).
 *
 * @param route           SpokeRedeemRoute from resolveRedeemAddresses
 * @param shares          Shares the user intends to redeem
 * @param userAddress     User's wallet address
 * @param shareBridgeFee  LZ fee for share bridge (TX1)
 * @returns               Validated balances for UI display
 */
export async function preflightSpokeRedeem(
  route: {
    hubChainId: number
    spokeChainId: number
    hubEid: number
    spokeEid: number
    hubAsset: string
    spokeShareOft: string
    hubAssetOft: string
    spokeAsset: string
    isStargate: boolean
  },
  shares: bigint,
  userAddress: string,
  shareBridgeFee: bigint,
): Promise<{
  sharesOnSpoke: bigint
  spokeNativeBalance: bigint
  hubNativeBalance: bigint
  estimatedAssetBridgeFee: bigint
  estimatedAssetsOut: bigint
  hubLiquidBalance: bigint
}> {
  const spokeProvider = createChainProvider(route.spokeChainId);
  const hubProvider = createChainProvider(route.hubChainId);
  if (!spokeProvider) throw new UnsupportedChainError(route.spokeChainId)
  if (!hubProvider) throw new UnsupportedChainError(route.hubChainId)

  // Parallel reads: shares on spoke, native balances
  const spokeShareContract = new Contract(route.spokeShareOft, ERC20_ABI, spokeProvider);
  const [sharesOnSpoke, spokeNativeBalance, hubNativeBalance]: [bigint, bigint, bigint] =
    await Promise.all([
      spokeShareContract.balanceOf(userAddress),
      spokeProvider.getBalance(userAddress),
      hubProvider.getBalance(userAddress),
    ]);

  // 1. Check shares
  if (sharesOnSpoke < shares) {
    throw new InsufficientBalanceError(route.spokeShareOft, sharesOnSpoke as bigint, shares)
  }

  // 2. Check spoke gas for TX1
  const spokeGasBuffer = 500_000_000_000_000n; // 0.0005 ETH
  if (spokeNativeBalance < shareBridgeFee + spokeGasBuffer) {
    throw new InsufficientBalanceError('native gas (spoke TX1)', spokeNativeBalance, shareBridgeFee + spokeGasBuffer)
  }

  // 3. Estimate asset bridge fee (TX3) and check hub gas
  let estimatedAssetBridgeFee = 0n;

  try {
    const toBytes32 = `0x${userAddress.replace(/^0x/, '').padStart(64, '0')}`;
    const dummyAmount = 1_000_000n; // 1 USDC for fee estimation
    const hubOft = new Contract(route.hubAssetOft, OFT_ABI, hubProvider);
    const feeResult = await hubOft.quoteSend({
      dstEid: route.spokeEid,
      to: toBytes32,
      amountLD: dummyAmount,
      minAmountLD: dummyAmount * 99n / 100n,
      extraOptions: "0x",
      composeMsg: "0x",
      oftCmd: route.isStargate ? "0x01" : "0x",
    }, false);
    estimatedAssetBridgeFee = feeResult.nativeFee as bigint;
  } catch {
    estimatedAssetBridgeFee = 300_000_000_000_000n; // 0.0003 ETH fallback
  }

  const hubGasBuffer = 300_000_000_000_000n; // 0.0003 ETH for gas (TX2 + TX3)
  const totalHubNeeded = estimatedAssetBridgeFee + hubGasBuffer;

  if (hubNativeBalance < totalHubNeeded) {
    throw new InsufficientBalanceError('native gas (hub TX2+TX3)', hubNativeBalance, totalHubNeeded)
  }

  return {
    sharesOnSpoke,
    spokeNativeBalance,
    hubNativeBalance,
    estimatedAssetBridgeFee,
    estimatedAssetsOut: 0n,
    hubLiquidBalance: 0n,
  };
}
