// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

// Core contracts
import {OFTAdapterFactory} from "../src/factory/OFTAdapterFactory.sol";
import {MoreVaultsComposer} from "../src/cross-chain/layerZero/MoreVaultsComposer.sol";

// Facets
import {DiamondCutFacet} from "../src/facets/DiamondCutFacet.sol";
import {AccessControlFacet} from "../src/facets/AccessControlFacet.sol";
import {VaultFacet} from "../src/facets/VaultFacet.sol";
import {BridgeFacet} from "../src/facets/BridgeFacet.sol";
import {ConfigurationFacet} from "../src/facets/ConfigurationFacet.sol";

// Interfaces
import {IDiamondCut} from "../src/interfaces/facets/IDiamondCut.sol";
import {IVaultFacet} from "../src/interfaces/facets/IVaultFacet.sol";
import {IConfigurationFacet} from "../src/interfaces/facets/IConfigurationFacet.sol";
import {IBridgeFacet} from "../src/interfaces/facets/IBridgeFacet.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";

// Test mocks (local dev only — never used in production deployments)
import {MockEndpointV2} from "../test/mocks/MockEndpointV2.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockOracleRegistry} from "../test/mocks/MockOracleRegistry.sol";
import {MockMoreVaultsRegistry} from "../test/mocks/MockMoreVaultsRegistry.sol";
import {MockMoreVaultsEscrow} from "../test/mocks/MockMoreVaultsEscrow.sol";
import {MockCCManager} from "../test/mocks/MockCCManager.sol";
import {MockAggregator} from "../test/mocks/MockAggregator.sol";
import {VaultsFactoryHarnessV2} from "../test/mocks/VaultsFactoryHarnessV2.sol";
import {IOracleRegistry} from "../src/interfaces/IOracleRegistry.sol";
import {IAggregatorV2V3Interface} from "../src/interfaces/Chainlink/IAggregatorV2V3Interface.sol";

/// @notice Deploys a full MoreVaults hub environment to local Anvil.
/// Run with:
///   forge script scripts/DeployLocalE2E.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
/// Then run the TypeScript integration tests:
///   cd sdk/integration-test && npm test
contract DeployLocalE2E is Script {
    // ── Chain EIDs ─────────────────────────────────────────────────────────
    uint32 constant HUB_EID = 30332;
    uint32 constant SPOKE_EID = 30110;

    // ── Anvil default accounts ──────────────────────────────────────────────
    address constant OWNER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    uint256 constant OWNER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    // ── Fake spoke address (for async flow enablement) ──────────────────────
    address constant FAKE_SPOKE = address(0x5afe5afE5afE5afE5afE5aFe5aFe5Afe5Afe5AfE);

    function test_skip() public pure {} // exclude from forge test coverage

    function run() public {
        vm.startBroadcast(OWNER_PK);

        // ── 1. Mock LZ endpoint (hub only — single Anvil) ──────────────────
        MockEndpointV2 endpoint = new MockEndpointV2(HUB_EID);

        // ── 2. Facet singletons ────────────────────────────────────────────
        DiamondCutFacet diamondCutFacet = new DiamondCutFacet();
        AccessControlFacet accessControlFacet = new AccessControlFacet();
        VaultFacet vaultFacet = new VaultFacet();
        BridgeFacet bridgeFacet = new BridgeFacet();
        ConfigurationFacet configurationFacet = new ConfigurationFacet();

        // ── 3. Mock tokens ─────────────────────────────────────────────────
        MockERC20 underlying = new MockERC20("USDC", "USDC");
        MockERC20 weth = new MockERC20("WETH", "WETH");

        // ── 4. Mock registries ─────────────────────────────────────────────
        MockOracleRegistry oracleRegistry = new MockOracleRegistry();
        oracleRegistry.setAssetPrice(address(underlying), 1e8); // $1.00
        oracleRegistry.setAssetPrice(address(weth), 2000e8);    // $2000.00

        // Deploy mock aggregators (8-decimal Chainlink-style).
        // Required by convertToUnderlying which calls aggregator.decimals().
        MockAggregator agg8 = new MockAggregator(8);
        oracleRegistry.setAssetOracleInfo(
            address(underlying),
            IOracleRegistry.OracleInfo(IAggregatorV2V3Interface(address(agg8)), 0)
        );
        oracleRegistry.setAssetOracleInfo(
            address(weth),
            IOracleRegistry.OracleInfo(IAggregatorV2V3Interface(address(agg8)), 0)
        );

        MockMoreVaultsRegistry registry = new MockMoreVaultsRegistry();
        registry.setOracle(address(oracleRegistry));

        // ── 5. Factory infrastructure ──────────────────────────────────────
        MoreVaultsComposer composerImpl = new MoreVaultsComposer();
        OFTAdapterFactory oftAdapterFactory = new OFTAdapterFactory(address(endpoint), OWNER);

        VaultsFactoryHarnessV2 factory = new VaultsFactoryHarnessV2(address(endpoint));
        factory.initialize(
            OWNER,
            address(registry),
            address(diamondCutFacet),
            address(accessControlFacet),
            address(weth),       // wrappedNative
            HUB_EID,
            0,                   // finalization delay (none for tests)
            address(0x1),        // lzAdapter placeholder (not used in local tests)
            address(composerImpl),
            address(oftAdapterFactory)
        );

        // ── 6. Deploy hub vault ────────────────────────────────────────────
        IDiamondCut.FacetCut[] memory cuts = _buildFacetCuts(
            address(vaultFacet),
            address(bridgeFacet),
            address(configurationFacet),
            address(underlying)
        );
        // owner == curator == guardian for simplicity
        bytes memory acInitData = abi.encode(OWNER, OWNER, OWNER);

        address hubVault = factory.deployVault(cuts, acInitData, true, keccak256("E2E_VAULT_V1"));

        address shareOFT   = oftAdapterFactory.getAdapter(hubVault);
        address hubComposer = factory.vaultComposer(hubVault);

        // ── 7. Escrow ──────────────────────────────────────────────────────
        MockMoreVaultsEscrow escrow = new MockMoreVaultsEscrow();
        escrow.setUnderlyingToken(hubVault, address(underlying));
        registry.setEscrow(address(escrow));

        // ── 8. Cross-chain accounting manager (for async D4/D5/R5 flows) ──
        //   MockCCManager implements quoteReadFee + initiateCrossChainAccounting.
        //   The TypeScript test will impersonate it to call updateAccountingInfoForRequest
        //   + executeRequest, simulating the LZ Read callback.
        MockCCManager ccManager = new MockCCManager();
        registry.setIsCrossChainAccountingManager(address(ccManager), true);

        vm.stopBroadcast();

        // ── 10. Write addresses.json (TS integration test reads this) ──────
        string memory obj = "e2e";
        vm.serializeAddress(obj, "underlying", address(underlying));
        vm.serializeAddress(obj, "weth", address(weth));
        vm.serializeAddress(obj, "hubVault", hubVault);
        vm.serializeAddress(obj, "escrow", address(escrow));
        vm.serializeAddress(obj, "factory", address(factory));
        vm.serializeAddress(obj, "shareOFT", shareOFT);
        vm.serializeAddress(obj, "oracleRegistry", address(oracleRegistry));
        vm.serializeAddress(obj, "ccManager", address(ccManager));
        string memory json = vm.serializeAddress(obj, "composer", hubComposer);
        vm.writeJson(json, "./sdk/integration-test/addresses.json");

        // ── Console summary ────────────────────────────────────────────────
        console.log("=== DeployLocalE2E ===");
        console.log("hubVault:    ", hubVault);
        console.log("escrow:      ", address(escrow));
        console.log("ccManager:   ", address(ccManager));
        console.log("factory:     ", address(factory));
        console.log("underlying:  ", address(underlying));
        console.log("weth:        ", address(weth));
        console.log("shareOFT:    ", shareOFT);
        console.log("composer:    ", hubComposer);
        console.log("addresses written to sdk/integration-test/addresses.json");
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Facet cuts (mirrors BaseE2ETest._buildFacetCuts)
    // ════════════════════════════════════════════════════════════════════════

    function _buildFacetCuts(
        address vaultFacetAddr,
        address bridgeFacetAddr,
        address configFacetAddr,
        address underlyingAddr
    ) internal pure returns (IDiamondCut.FacetCut[] memory cuts) {
        cuts = new IDiamondCut.FacetCut[](3);

        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: vaultFacetAddr,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getVaultFacetSelectors(),
            initData: abi.encode(
                "E2E Vault",       // name
                "E2EV",            // symbol
                underlyingAddr,    // asset
                OWNER,             // feeRecipient
                uint96(0),         // fee (0%)
                type(uint256).max  // depositCapacity (unlimited)
            )
        });

        cuts[1] = IDiamondCut.FacetCut({
            facetAddress: bridgeFacetAddr,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getBridgeFacetSelectors(),
            initData: "" // BridgeFacet takes no init data
        });

        cuts[2] = IDiamondCut.FacetCut({
            facetAddress: configFacetAddr,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: _getConfigurationFacetSelectors(),
            initData: abi.encode(uint256(500)) // maxSlippagePercent = 5%
        });
    }

    function _getVaultFacetSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](31);
        s[0]  = IVaultFacet.pause.selector;
        s[1]  = IVaultFacet.unpause.selector;
        s[2]  = IVaultFacet.paused.selector;
        s[3]  = IVaultFacet.totalAssets.selector;
        s[4]  = IVaultFacet.totalAssetsUsd.selector;
        s[5]  = IVaultFacet.getWithdrawalRequest.selector;
        s[6]  = bytes4(keccak256("deposit(address[],uint256[],address,uint256)"));
        s[7]  = IERC4626.deposit.selector;
        s[8]  = IERC4626.mint.selector;
        s[9]  = IERC4626.withdraw.selector;
        s[10] = IERC4626.redeem.selector;
        s[11] = IVaultFacet.setFee.selector;
        s[12] = IVaultFacet.requestRedeem.selector;
        s[13] = IVaultFacet.requestWithdraw.selector;
        s[14] = IVaultFacet.clearRequest.selector;
        s[15] = IVaultFacet.accrueFees.selector;
        s[16] = IERC4626.asset.selector;
        s[17] = IERC20.totalSupply.selector;
        s[18] = IERC20.balanceOf.selector;
        s[19] = IERC4626.convertToShares.selector;
        s[20] = IERC4626.convertToAssets.selector;
        s[21] = IERC4626.maxDeposit.selector;
        s[22] = IERC4626.previewDeposit.selector;
        s[23] = IERC4626.maxRedeem.selector;
        s[24] = IERC20Metadata.decimals.selector;
        s[25] = IERC20Metadata.name.selector;
        s[26] = IERC20Metadata.symbol.selector;
        s[27] = IERC20.approve.selector;
        s[28] = IERC20.transfer.selector;
        s[29] = IERC20.transferFrom.selector;
        s[30] = IERC20.allowance.selector;
    }

    function _getBridgeFacetSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](11);
        s[0]  = IBridgeFacet.accountingBridgeFacet.selector;
        s[1]  = IBridgeFacet.setOraclesCrossChainAccounting.selector;
        s[2]  = IBridgeFacet.oraclesCrossChainAccounting.selector;
        s[3]  = IBridgeFacet.quoteAccountingFee.selector;
        s[4]  = IBridgeFacet.executeBridging.selector;
        s[5]  = IBridgeFacet.initVaultActionRequest.selector;
        s[6]  = IBridgeFacet.updateAccountingInfoForRequest.selector;
        s[7]  = IBridgeFacet.executeRequest.selector;
        s[8]  = IBridgeFacet.refundRequestTokens.selector;
        s[9]  = IBridgeFacet.getRequestInfo.selector;
        s[10] = IBridgeFacet.getFinalizationResult.selector;
    }

    function _getConfigurationFacetSelectors() internal pure returns (bytes4[] memory s) {
        s = new bytes4[](27);
        s[0]  = IConfigurationFacet.setFeeRecipient.selector;
        s[1]  = IConfigurationFacet.setTimeLockPeriod.selector;
        s[2]  = IConfigurationFacet.setDepositCapacity.selector;
        s[3]  = IConfigurationFacet.setDepositWhitelist.selector;
        s[4]  = IConfigurationFacet.enableDepositWhitelist.selector;
        s[5]  = IConfigurationFacet.disableDepositWhitelist.selector;
        s[6]  = IConfigurationFacet.getAvailableToDeposit.selector;
        s[7]  = IConfigurationFacet.addAvailableAsset.selector;
        s[8]  = IConfigurationFacet.addAvailableAssets.selector;
        s[9]  = IConfigurationFacet.enableAssetToDeposit.selector;
        s[10] = IConfigurationFacet.disableAssetToDeposit.selector;
        s[11] = IConfigurationFacet.setWithdrawalFee.selector;
        s[12] = IConfigurationFacet.setWithdrawalTimelock.selector;
        s[13] = IConfigurationFacet.updateWithdrawalQueueStatus.selector;
        s[14] = IConfigurationFacet.setMaxWithdrawalDelay.selector;
        s[15] = IConfigurationFacet.setGasLimitForAccounting.selector;
        s[16] = IConfigurationFacet.setMaxSlippagePercent.selector;
        s[17] = IConfigurationFacet.setCrossChainAccountingManager.selector;
        s[18] = IConfigurationFacet.getEscrow.selector;
        s[19] = IConfigurationFacet.getWithdrawalFee.selector;
        s[20] = IConfigurationFacet.getWithdrawalQueueStatus.selector;
        s[21] = IConfigurationFacet.getMaxWithdrawalDelay.selector;
        s[22] = IConfigurationFacet.isAssetDepositable.selector;
        s[23] = IConfigurationFacet.isAssetAvailable.selector;
        s[24] = IConfigurationFacet.isHub.selector;
        s[25] = IConfigurationFacet.getCrossChainAccountingManager.selector;
        s[26] = IConfigurationFacet.getWithdrawalTimelock.selector;
    }
}
