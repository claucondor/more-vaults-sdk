import { Contract, AbiCoder, getAddress, zeroPadValue, Signer, Provider } from "ethers";
import { ERC20_ABI, OFT_ABI, BRIDGE_ABI, LZ_ENDPOINT_ABI } from "./abis";
import type { ContractTransactionReceipt } from "ethers";
import { EID_TO_CHAIN_ID, OFT_ROUTES, createChainProvider, getLzEndpoint, DEFAULT_LZ_ENDPOINT } from "./chains";
import { detectStargateOft } from "./utils";
import { OMNI_FACTORY_ADDRESS } from "./topology";
import { ComposerNotConfiguredError, InvalidInputError, ComposeAlreadyExecutedError } from "./errors";

/** @deprecated use getLzEndpoint(chainId) — endpoint differs on Flow EVM */
const LZ_ENDPOINT = DEFAULT_LZ_ENDPOINT;

const EMPTY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const RECEIVED_HASH = "0x0000000000000000000000000000000000000000000000000000000000000001";

/** keccak256("ComposeSent(address,address,bytes32,uint16,bytes)") — topic0 for log scans. */
const COMPOSE_SENT_TOPIC = "0x0c68e6a0b0fb0f33c52455a8da89b21fc640a3dd4a1b21d9bfcc8aeee4a43e84";

// ── Tunable defaults for cross-chain compose flows (mirror of viem) ──────────
// These preserve the SDK's existing behaviour; exported so callers can read them
// and the recovery scanners accept a per-call chunk-size override.

/** Default block-range window scanned backwards when no `fromBlock` is given. */
export const COMPOSE_SCAN_WINDOW_BLOCKS = 200_000n;
/** Block chunk size per `getLogs` call when scanning `ComposeSent` events. */
export const COMPOSE_SCAN_CHUNK_SIZE = 2_000n;
/** Gas limit forwarded to `endpoint.lzCompose` when executing a pending compose. */
export const EXECUTE_COMPOSE_GAS_LIMIT = 5_000_000n;

/**
 * Ensure `spender` has at least `amount` allowance from `owner`.
 */
async function ensureAllowance(
  signer: Signer,
  token: string,
  spender: string,
  amount: bigint
): Promise<void> {
  const owner = await signer.getAddress();
  const erc20 = new Contract(token, ERC20_ABI, signer);
  const current: bigint = await erc20.allowance(owner, spender);
  if (current < amount) {
    const tx = await erc20.approve(spender, amount);
    await tx.wait();
  }
}

// ---------------------------------------------------------------------------
// D6 / D7 — Spoke → Hub, OFT Compose deposit
// ---------------------------------------------------------------------------

/**
 * D6 / D7 — Deposit from a spoke chain to the hub vault via OFT Compose.
 *
 * Bridges tokens from the spoke chain to the hub via LayerZero OFT, attaching a
 * composeMsg that instructs the hub-side MoreVaultsComposer to deposit into the vault.
 * Shares are delivered on the hub chain (local safeTransfer).
 *
 * - **D6 (oracle ON)**: composer calls `_depositAndSend` — shares arrive immediately on hub.
 * - **D7 (oracle OFF)**: composer calls `_initDeposit` — requires an additional LZ Read round-trip.
 *
 * TXs: 1 approve (if needed) + 1 OFT.send().
 *
 * @param signer        - Wallet on the spoke chain.
 * @param spokeOFT      - OFT/OFTAdapter address on the spoke chain.
 * @param composer      - MoreVaultsComposer address on the hub chain.
 * @param hubEid        - LayerZero EID for the hub chain.
 * @param spokeEid      - LayerZero EID for the spoke chain — where shares are sent back.
 * @param amount        - Amount of underlying tokens to bridge and deposit.
 * @param receiver      - Address that will receive shares on the hub chain.
 * @param lzFee         - Native fee for the OFT.send() call.
 * @param minMsgValue   - Minimum msg.value the hub composer must receive (default 0).
 * @param minSharesOut  - Minimum shares to receive after deposit (default 0).
 * @param minAmountLD   - Minimum tokens received on hub after bridge (default: amount).
 * @param extraOptions  - LZ extra options bytes (default '0x').
 * @returns Transaction receipt.
 */
export async function depositFromSpoke(
  signer: Signer,
  spokeOFT: string,
  composer: string,
  hubEid: number,
  spokeEid: number,
  amount: bigint,
  receiver: string,
  lzFee: bigint,
  minMsgValue: bigint = 0n,
  minSharesOut: bigint = 0n,
  minAmountLD?: bigint,
  extraOptions: string = "0x",
): Promise<{ receipt: ContractTransactionReceipt }> {
  if (amount === 0n) throw new InvalidInputError('deposit amount must be greater than zero')
  if (!composer || composer === '0x0000000000000000000000000000000000000000') {
    throw new ComposerNotConfiguredError(spokeOFT)
  }

  await ensureAllowance(signer, spokeOFT, spokeOFT, amount);

  const oft = new Contract(spokeOFT, OFT_ABI, signer);
  const refundAddress = await signer.getAddress();

  const receiverBytes32 = zeroPadValue(receiver, 32);
  const composerBytes32 = zeroPadValue(composer, 32);

  // hopSendParam: dstEid = spokeEid → shares sent back to user on spoke via SHARE_OFT
  // Requires SHARE_OFT peers + enforcedOptions configured on both chains.
  // For Stargate OFTs: compose stays pending (msg.value=0), user retries via executeCompose.
  const hopSendParam = {
    dstEid: spokeEid,
    to: receiverBytes32,
    amountLD: 0n,
    minAmountLD: minSharesOut,
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };

  const coder = AbiCoder.defaultAbiCoder();
  const composeMsg = coder.encode(
    [
      "tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)",
      "uint256",
    ],
    [hopSendParam, minMsgValue],
  );

  const sendParam = {
    dstEid: hubEid,
    to: composerBytes32,
    amountLD: amount,
    minAmountLD: minAmountLD ?? amount,
    extraOptions,
    composeMsg,
    oftCmd: "0x",
  };

  const msgFee = { nativeFee: lzFee, lzTokenFee: 0n };

  const tx = await oft.send(sendParam, msgFee, refundAddress, {
    value: lzFee,
  });
  const receipt = await tx.wait();

  return { receipt };
}

// ---------------------------------------------------------------------------
// D7 -- Spoke -> Hub OFT Compose (oracle OFF, async)
// ---------------------------------------------------------------------------

/**
 * Alias: D7 — Spoke to hub deposit when oracle is OFF (async resolution).
 * Same interface as D6; the difference is handled server-side by the composer contract.
 */
export const depositFromSpokeAsync = depositFromSpoke;

// ---------------------------------------------------------------------------
// Fee quote helper
// ---------------------------------------------------------------------------

/**
 * Quote the LayerZero fee required for depositFromSpoke.
 *
 * @param provider       Read-only provider on the SPOKE chain
 * @param spokeOFT       OFT contract address on spoke chain
 * @param composer       MoreVaultsComposer address on the hub chain
 * @param hubEid         LayerZero EID for the hub chain
 * @param amount         Amount of tokens to bridge
 * @param receiver       Address that will receive vault shares
 * @param minMsgValue    Same value you plan to pass to depositFromSpoke (default 0n)
 * @param minSharesOut   Same value you plan to pass to depositFromSpoke (default 0n)
 * @param minAmountLD    Minimum tokens on hub after bridge (default: amount)
 * @param extraOptions   LZ extra options (default 0x)
 * @returns              Native fee in wei
 */
export async function quoteDepositFromSpokeFee(
  provider: Provider,
  spokeOFT: string,
  composer: string,
  hubEid: number,
  spokeEid: number,
  amount: bigint,
  receiver: string,
  minMsgValue: bigint = 0n,
  minSharesOut: bigint = 0n,
  minAmountLD?: bigint,
  extraOptions: string = "0x"
): Promise<bigint> {
  const receiverBytes32 = zeroPadValue(receiver, 32);
  const composerBytes32 = zeroPadValue(composer, 32);

  // hopSendParam with dstEid=spokeEid → shares go back to spoke via SHARE_OFT
  const hopSendParam = {
    dstEid: spokeEid,
    to: receiverBytes32,
    amountLD: 0n,
    minAmountLD: minSharesOut,
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };

  const coder = AbiCoder.defaultAbiCoder();
  const composeMsgBytes = coder.encode(
    ["tuple(uint32,bytes32,uint256,uint256,bytes,bytes,bytes)", "uint256"],
    [
      [
        hopSendParam.dstEid,
        hopSendParam.to,
        hopSendParam.amountLD,
        hopSendParam.minAmountLD,
        hopSendParam.extraOptions,
        hopSendParam.composeMsg,
        hopSendParam.oftCmd,
      ],
      minMsgValue,
    ]
  );

  const sendParam = {
    dstEid: hubEid,
    to: composerBytes32,
    amountLD: amount,
    minAmountLD: minAmountLD ?? amount,
    extraOptions,
    composeMsg: composeMsgBytes,
    oftCmd: "0x",
  };

  const oft = new Contract(spokeOFT, OFT_ABI, provider);
  const fee = await oft.quoteSend(sendParam, false);
  return fee.nativeFee as bigint;
}

// ---------------------------------------------------------------------------
// Stargate 2-TX compose helpers
// ---------------------------------------------------------------------------

/**
 * Quote the ETH needed to execute a pending compose on the hub chain.
 *
 * For D7 (oracle OFF) vaults, the composer needs ETH to cover:
 *   1. `readFee` for `vault.initVaultActionRequest`
 *   2. `shareSendFee` for `SHARE_OFT.send()` to deliver shares to the spoke chain
 *
 * @param provider   Read-only provider on the HUB chain
 * @param vault      Vault address on the hub
 * @param spokeEid   Destination EID for share delivery (optional — improves accuracy)
 * @param receiver   Receiver address on the spoke chain (optional — improves accuracy)
 * @returns          ETH amount in wei to send with executeCompose
 */
export async function quoteComposeFee(
  provider: Provider,
  vault: string,
  spokeEid?: number,
  receiver?: string,
): Promise<bigint> {
  try {
    const vaultContract = new Contract(vault, BRIDGE_ABI, provider);
    const readFee: bigint = await vaultContract.quoteAccountingFee("0x");

    // If spokeEid provided, also quote the SHARE_OFT send fee
    let shareSendFee = 0n;
    if (spokeEid && receiver) {
      try {
        const COMPOSER_ABI = ["function SHARE_OFT() view returns (address)"];
        const FACTORY_ABI = ["function vaultComposer(address _vault) view returns (address)"];
        const factory = new Contract("0x7bDB8B17604b03125eFAED33cA0c55FBf856BB0C", FACTORY_ABI, provider);
        const composerAddr: string = await factory.vaultComposer(vault);
        const composer = new Contract(composerAddr, COMPOSER_ABI, provider);
        const shareOftAddr: string = await composer.SHARE_OFT();
        const shareOft = new Contract(shareOftAddr, OFT_ABI, provider);

        const receiverBytes32 = zeroPadValue(receiver, 32);
        const fee = await shareOft.quoteSend({
          dstEid: spokeEid,
          to: receiverBytes32,
          amountLD: 1_000_000n,
          minAmountLD: 0n,
          extraOptions: "0x",
          composeMsg: "0x",
          oftCmd: "0x",
        }, false);
        shareSendFee = fee.nativeFee as bigint;
      } catch { /* fallback to readFee only */ }
    }

    return (readFee + shareSendFee) * 110n / 100n; // 10% buffer
  } catch {
    return 500_000_000_000_000n; // 0.0005 ETH fallback
  }
}

/**
 * Execute a pending LZ compose on the hub chain (Stargate 2-TX flow, step 2).
 *
 * Calls `endpoint.lzCompose{value: fee}(from, to, guid, index, message, '0x')`.
 *
 * @param signer      Wallet on the HUB chain
 * @param from        Stargate pool address on hub (from ComposeSent event)
 * @param to          MoreVaultsComposer address on hub
 * @param guid        LayerZero GUID from the original OFT.send()
 * @param message     Full compose message bytes (from ComposeSent event)
 * @param fee         ETH to send (from quoteComposeFee)
 * @param index       Compose index (default 0)
 * @returns           Transaction receipt
 */
export async function executeCompose(
  signer: Signer,
  from: string,
  to: string,
  guid: string,
  message: string,
  fee: bigint,
  index: number = 0,
  hubChainId?: number,
): Promise<{ receipt: ContractTransactionReceipt }> {
  // Resolve the LZ endpoint for the hub chain. Prefer the explicit hubChainId,
  // otherwise auto-detect from the signer's network so Flow EVM (which uses a
  // non-canonical endpoint) works without the caller having to pass it.
  let resolvedChainId = hubChainId;
  if (resolvedChainId === undefined && signer.provider) {
    resolvedChainId = Number((await signer.provider.getNetwork()).chainId);
  }
  const endpointAddr = resolvedChainId ? getLzEndpoint(resolvedChainId) : LZ_ENDPOINT;
  const endpoint = new Contract(endpointAddr, LZ_ENDPOINT_ABI, signer);

  // Verify compose is still pending
  const hash: string = await endpoint.composeQueue(from, to, guid, index);
  if (hash === EMPTY_HASH) {
    throw new Error("Compose not found in queue (hash = 0). Never sent or wrong parameters.");
  }
  if (hash === RECEIVED_HASH) {
    throw new Error("Compose already delivered — no action needed.");
  }

  const tx = await endpoint.lzCompose(from, to, guid, index, message, "0x", {
    value: fee,
    gasLimit: EXECUTE_COMPOSE_GAS_LIMIT,
  });
  const receipt = await tx.wait();

  return { receipt };
}

// ---------------------------------------------------------------------------
// Compose data types and waitForCompose
// ---------------------------------------------------------------------------

/**
 * Data needed to execute a pending LZ compose on the hub chain.
 * Returned by `depositFromSpoke` when the OFT is a Stargate V2 pool.
 * The SDK user must call `executeCompose()` with this data as TX2 on the hub.
 */
export interface ComposeData {
  /** LZ Endpoint address on the hub chain */
  endpoint: string
  /** The OFT/pool address that sent the compose (Stargate pool on hub) — resolved by waitForCompose */
  from: string
  /** MoreVaultsComposer address on the hub */
  to: string
  /** LayerZero GUID from the original OFT.send() */
  guid: string
  /** Compose index (default 0) */
  index: number
  /** Full compose message bytes — resolved by waitForCompose from ComposeSent event */
  message: string
  /** Whether this is a Stargate OFT (2-TX flow) */
  isStargate: boolean
  /** Hub chain ID */
  hubChainId: number
  /** Block number on hub chain right before depositFromSpoke TX — used to bound event scan */
  hubBlockStart: bigint
}

/** Minimal ABIs for helper functions used only in this file */
const FACTORY_COMPOSER_ABI_MIN = [
  "function vaultComposer(address _vault) view returns (address)",
] as const;

const COMPOSER_SHARE_OFT_ABI = [
  "function SHARE_OFT() view returns (address)",
] as const;

const OFT_PEERS_ABI = [
  "function peers(uint32 eid) view returns (bytes32)",
] as const;

const OFT_TOKEN_ABI = [
  "function token() view returns (address)",
] as const;

const OFT_QUOTE_OFT_ABI = [
  "function quoteOFT(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam) view returns (tuple(uint256 minAmountLD, uint256 maxAmountLD), tuple(int256 feeAmountLD, string description)[], tuple(uint256 amountSentLD, uint256 amountReceivedLD))",
] as const;

/**
 * Wait for a pending compose to appear in the LZ Endpoint's composeQueue on the hub chain.
 *
 * After `depositFromSpoke` sends tokens via Stargate, the LZ network delivers the message
 * to the hub chain. The endpoint stores the compose hash in `composeQueue` and emits
 * a `ComposeSent` event with the full message bytes.
 *
 * Strategy: scan ComposeSent events on the LZ Endpoint starting from `hubBlockStart`
 * (captured by `depositFromSpoke` right before TX1). We scan forward in 500-block chunks,
 * matching by composer address and receiver in the message body.
 *
 * @param hubProvider      Read-only provider on the HUB chain
 * @param composeData      Partial compose data (includes hubBlockStart, to, guid)
 * @param receiver         Receiver address to match in the compose message
 * @param pollIntervalMs   Polling interval (default 20s)
 * @param timeoutMs        Timeout (default 30 min)
 * @returns                Complete ComposeData ready for executeCompose
 */
export async function waitForCompose(
  hubProvider: Provider,
  composeData: ComposeData,
  receiver: string,
  pollIntervalMs = 20_000,
  timeoutMs = 1_800_000,
): Promise<ComposeData> {
  const deadline = Date.now() + timeoutMs
  const composer = composeData.to.toLowerCase()
  const endpoint = composeData.endpoint
  const receiverNeedle = receiver.replace(/^0x/, '').toLowerCase()
  const startBlock = composeData.hubBlockStart

  // Collect Stargate OFT addresses on the hub chain
  const hubChainId = composeData.hubChainId
  const candidateAddresses: string[] = []
  for (const chainMap of Object.values(OFT_ROUTES)) {
    const entry = (chainMap as Record<number, { oft: string; token: string }>)[hubChainId]
    if (entry) candidateAddresses.push(entry.oft.toLowerCase())
  }

  // Filter to Stargate addresses on-chain
  const stargateChecks = await Promise.all(
    candidateAddresses.map(async (addr) => ({
      addr,
      isSg: await detectStargateOft(hubProvider, addr),
    })),
  )
  const knownFromAddresses = stargateChecks.filter((c) => c.isSg).map((c) => c.addr)

  // ComposeSent event ABI for getLogs
  const endpointContract = new Contract(endpoint, LZ_ENDPOINT_ABI, hubProvider)

  let attempt = 0
  let scannedUpTo = startBlock - 1n

  while (Date.now() < deadline) {
    attempt++
    const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000)

    try {
      const currentBlock = BigInt(await hubProvider.getBlockNumber())
      const chunkSize = 500n
      let from = scannedUpTo + 1n

      while (from <= currentBlock) {
        const chunkEnd = from + chunkSize > currentBlock ? currentBlock : from + chunkSize

        try {
          const logs = await hubProvider.getLogs({
            address: endpoint,
            topics: [COMPOSE_SENT_TOPIC],
            fromBlock: `0x${from.toString(16)}`,
            toBlock: `0x${chunkEnd.toString(16)}`,
          })

          for (const log of logs) {
            // ComposeSent(address from, address to, bytes32 guid, uint16 index, bytes message)
            // All params are non-indexed — decode from data
            try {
              const coder = AbiCoder.defaultAbiCoder()
              const decoded = coder.decode(
                ['address', 'address', 'bytes32', 'uint16', 'bytes'],
                log.data,
              )
              const logFrom = (decoded[0] as string).toLowerCase()
              const logTo = (decoded[1] as string).toLowerCase()
              const logGuid = decoded[2] as string
              const logIndex = Number(decoded[3])
              const logMessage = decoded[4] as string

              if (
                logTo === composer &&
                logMessage.toLowerCase().includes(receiverNeedle)
              ) {
                // Verify this compose is still pending in composeQueue
                const hash: string = await endpointContract.composeQueue(
                  logFrom, composer, logGuid, logIndex,
                )

                if (hash === RECEIVED_HASH) {
                  console.log(`[more-vaults-sdk] waitForCompose compose already executed (RECEIVED_HASH) — signaling done`)
                  throw new ComposeAlreadyExecutedError()
                }

                if (hash !== EMPTY_HASH) {
                  console.log(`[${elapsed}s] Poll #${attempt} — compose found! (block ${log.blockNumber})`)
                  return {
                    ...composeData,
                    from: decoded[0] as string,
                    to: composeData.to,
                    guid: logGuid,
                    index: logIndex,
                    message: logMessage,
                  }
                }
              }
            } catch (e) {
              if (e instanceof ComposeAlreadyExecutedError) throw e
              /* decode failed — skip log */
            }
          }
        } catch (e) {
          if (e instanceof ComposeAlreadyExecutedError) throw e
          // Chunk failed (RPC limit) — break inner loop, will retry next poll
          break
        }

        from = chunkEnd + 1n
      }

      scannedUpTo = currentBlock
    } catch (e) {
      if (e instanceof ComposeAlreadyExecutedError) throw e
      // getBlockNumber failed — retry next poll
    }

    // Also try composeQueue directly with spoke GUID (works when GUIDs match)
    let guidMatchFound = false
    for (const fromAddr of knownFromAddresses) {
      try {
        const hash: string = await endpointContract.composeQueue(
          fromAddr, composer, composeData.guid, 0,
        )
        if (hash !== EMPTY_HASH && hash !== RECEIVED_HASH) {
          console.log(`[${elapsed}s] Poll #${attempt} — composeQueue confirms pending (GUID match), re-scanning for message...`)
          scannedUpTo = startBlock - 1n
          guidMatchFound = true
        }
      } catch { /* continue */ }
    }

    if (!guidMatchFound) {
      console.log(`[${elapsed}s] Poll #${attempt} — compose not found yet, waiting ${pollIntervalMs / 1000}s...`)
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error(
    `Timeout waiting for compose after ${timeoutMs / 60_000} min. Check LayerZero scan for composer ${composeData.to}.`,
  )
}

// ---------------------------------------------------------------------------
// Compose recovery helpers (parity with the viem build)
// ---------------------------------------------------------------------------

/**
 * Decode the OFTComposeMsgCodec message bytes from a ComposeSent event.
 *
 * Layout (bytes):
 *   0–7   amountSD (uint64)
 *   8–11  srcEid   (uint32)
 *  12–43  amountLD (uint256)
 *  44–75  composeFrom (bytes32, last 20 = depositor address)
 *  76+    composeMsgPayload = abi.encode(SendParam, uint256 minMsgValue)
 *
 * The SendParam inside composeMsgPayload carries dstEid (spoke EID) and
 * to (bytes32, last 20 = receiver address on spoke).
 */
export function decodeComposeMessage(message: string): {
  srcEid: number
  amountLD: bigint
  depositor: string
  dstEid?: number
  receiver?: string
} {
  const hex = message.startsWith("0x") ? message.slice(2) : message
  const srcEid = parseInt(hex.slice(16, 24), 16)            // bytes 8–11
  const amountLD = BigInt("0x" + hex.slice(24, 88))         // bytes 12–43
  const depositor = getAddress("0x" + hex.slice(112, 152))  // bytes 44–75, last 20

  let dstEid: number | undefined
  let receiver: string | undefined
  try {
    const payload = "0x" + hex.slice(152)                   // bytes 76+
    const coder = AbiCoder.defaultAbiCoder()
    const [sendParam] = coder.decode(
      [
        "tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)",
        "uint256",
      ],
      payload,
    )
    dstEid = Number(sendParam.dstEid)
    receiver = getAddress("0x" + (sendParam.to as string).slice(26)) // last 20 bytes of bytes32
  } catch { /* leave undefined */ }

  return { srcEid, amountLD, depositor, dstEid, receiver }
}

/**
 * Find a specific pending compose on the hub chain by GUID.
 *
 * Scans `ComposeSent` events on the LZ Endpoint until it finds an event matching
 * the given GUID directed at `composer`, then verifies it is still pending.
 *
 * @param hubProvider  Provider on the hub chain
 * @param endpoint     LZ EndpointV2 address on the hub
 * @param composer     MoreVaultsComposer address on the hub
 * @param guid         The LZ GUID to locate
 * @param fromBlock    Block to start scanning from (default: last 200k blocks)
 * @param hubChainId   Hub chain ID embedded in returned ComposeData (fetched if omitted)
 * @param chunkSize    Block chunk size per getLogs call (default 2000)
 * @throws {ComposeAlreadyExecutedError} If the compose was already executed
 * @throws {Error} If the GUID is not found in the scanned block range
 */
export async function findComposeByGuid(
  hubProvider: Provider,
  endpoint: string,
  composer: string,
  guid: string,
  fromBlock?: bigint,
  hubChainId?: number,
  chunkSize: bigint = COMPOSE_SCAN_CHUNK_SIZE,
): Promise<ComposeData> {
  const currentBlock = BigInt(await hubProvider.getBlockNumber())
  const scanFrom = fromBlock ?? (currentBlock > COMPOSE_SCAN_WINDOW_BLOCKS ? currentBlock - COMPOSE_SCAN_WINDOW_BLOCKS : 0n)
  const endpointContract = new Contract(endpoint, LZ_ENDPOINT_ABI, hubProvider)
  const coder = AbiCoder.defaultAbiCoder()
  const composerLc = composer.toLowerCase()

  let from = scanFrom
  while (from <= currentBlock) {
    const chunkEnd = from + chunkSize > currentBlock ? currentBlock : from + chunkSize

    const logs = await hubProvider.getLogs({
      address: endpoint,
      topics: [COMPOSE_SENT_TOPIC],
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${chunkEnd.toString(16)}`,
    })

    for (const log of logs) {
      let decoded
      try {
        decoded = coder.decode(["address", "address", "bytes32", "uint16", "bytes"], log.data)
      } catch { continue }
      const logFrom = decoded[0] as string
      const logTo = (decoded[1] as string).toLowerCase()
      const logGuid = decoded[2] as string
      const logIndex = Number(decoded[3])
      const logMessage = decoded[4] as string

      if (logGuid.toLowerCase() === guid.toLowerCase() && logTo === composerLc) {
        const hash: string = await endpointContract.composeQueue(logFrom, composer, guid, logIndex)
        if (hash === RECEIVED_HASH) throw new ComposeAlreadyExecutedError()
        if (hash === EMPTY_HASH) {
          throw new Error(`Compose ${guid} found in events but composeQueue hash is empty — may have been cleared externally.`)
        }
        const chainId = hubChainId ?? Number((await hubProvider.getNetwork()).chainId)
        return {
          endpoint,
          from: logFrom,
          to: composer,
          guid,
          index: logIndex,
          message: logMessage,
          isStargate: false,
          hubChainId: chainId,
          hubBlockStart: scanFrom,
        }
      }
    }

    from = chunkEnd + 1n
  }

  throw new Error(
    `Compose GUID ${guid} not found in ComposeSent events on blocks ${scanFrom}→${currentBlock}. ` +
    `Pass a lower fromBlock to scan further back.`,
  )
}

/**
 * Scan the hub LZ Endpoint for all pending (unexecuted) composes for a composer.
 *
 * Returns every `ComposeSent` event where `to === composer` and the compose is
 * still pending in `composeQueue`. Useful for recovery: lists composes needing TX2.
 *
 * @param hubProvider  Provider on the hub chain
 * @param endpoint     LZ EndpointV2 address on the hub
 * @param composer     MoreVaultsComposer address on the hub
 * @param fromBlock    Block to start scanning from (default: last 200k blocks)
 * @param chunkSize    Block chunk size per getLogs call (default 2000)
 */
export async function listPendingComposes(
  hubProvider: Provider,
  endpoint: string,
  composer: string,
  fromBlock?: bigint,
  chunkSize: bigint = COMPOSE_SCAN_CHUNK_SIZE,
): Promise<Array<{
  guid: string
  blockNumber: bigint
  from: string
  index: number
  message: string
  decoded: ReturnType<typeof decodeComposeMessage>
}>> {
  const currentBlock = BigInt(await hubProvider.getBlockNumber())
  const scanFrom = fromBlock ?? (currentBlock > COMPOSE_SCAN_WINDOW_BLOCKS ? currentBlock - COMPOSE_SCAN_WINDOW_BLOCKS : 0n)
  const endpointContract = new Contract(endpoint, LZ_ENDPOINT_ABI, hubProvider)
  const coder = AbiCoder.defaultAbiCoder()
  const composerLc = composer.toLowerCase()

  const pending: Array<{
    guid: string; blockNumber: bigint; from: string;
    index: number; message: string
    decoded: ReturnType<typeof decodeComposeMessage>
  }> = []

  for (let from = scanFrom; from <= currentBlock; from += chunkSize + 1n) {
    const chunkEnd = from + chunkSize > currentBlock ? currentBlock : from + chunkSize

    try {
      const logs = await hubProvider.getLogs({
        address: endpoint,
        topics: [COMPOSE_SENT_TOPIC],
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${chunkEnd.toString(16)}`,
      })

      for (const log of logs) {
        let decoded
        try {
          decoded = coder.decode(["address", "address", "bytes32", "uint16", "bytes"], log.data)
        } catch { continue }
        const logFrom = decoded[0] as string
        const logTo = (decoded[1] as string).toLowerCase()
        const logGuid = decoded[2] as string
        const logIndex = Number(decoded[3])
        const logMessage = decoded[4] as string
        if (logTo !== composerLc) continue

        try {
          const hash: string = await endpointContract.composeQueue(logFrom, composer, logGuid, logIndex)
          if (hash !== EMPTY_HASH && hash !== RECEIVED_HASH) {
            pending.push({
              guid: logGuid,
              blockNumber: BigInt(log.blockNumber),
              from: logFrom,
              index: logIndex,
              message: logMessage,
              decoded: decodeComposeMessage(logMessage),
            })
          }
        } catch { /* skip on RPC error */ }
      }
    } catch { continue }
  }

  return pending
}
