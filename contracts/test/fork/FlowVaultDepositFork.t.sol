// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IConfigurationFacet} from "../../src/interfaces/facets/IConfigurationFacet.sol";
import {IVaultFacet} from "../../src/interfaces/facets/IVaultFacet.sol";

/**
 * @title FlowVaultDepositFork
 * @notice Fork test del vault AlphaYields PYUSD (Flow EVM mainnet).
 *
 * Diagnostico confirmado (2026-04-13):
 *   - oracle accounting fue habilitado → maxDeposit() ya no revierte
 *   - whitelist esta activa (isDepositWhitelistEnabled = true)
 *   - 0xe001... tiene availableToDeposit = 0 → NO estaba whitelisted
 *   - Fix: owner llama setDepositWhitelist con cap apropiado
 *
 * Para correr:
 *   forge test --match-path "test/fork/FlowVaultDepositFork.t.sol" -vvvvv \
 *     --fork-url https://mainnet.evm.nodes.onflow.org
 */
contract FlowVaultDepositFork is Test {
    address constant VAULT   = 0xaf46A54208CE9924B7577AFf146dfD65eB193861;
    address constant PYUSD   = 0x99aF3EeA856556646C98c8B9b2548Fe815240750;
    address constant OWNER   = 0x6A66AeB125Ad05c3d35B4E26CD1033963cE0bA5C;

    // Address que Bogdan reporto como "whitelisted" pero tenia availableToDeposit = 0
    address constant USER    = 0xe001ff284318681D6986DaF0D6832dFA65aEC633;

    uint256 constant DEPOSIT_AMOUNT  = 5e6;    // 5 PYUSD
    uint256 constant WHITELIST_CAP   = 10_000e6; // 10k PYUSD cap

    function setUp() public {
        vm.createSelectFork("https://mainnet.evm.nodes.onflow.org");
    }

    // ── Reproduce el bug: whitelist activa, user sin cap → maxDeposit = 0 ──

    function test_bug_whitelistEnabledButNoCap() public {
        assertTrue(IConfigurationFacet(VAULT).isDepositWhitelistEnabled(), "whitelist debe estar activa");
        assertEq(IConfigurationFacet(VAULT).getAvailableToDeposit(USER), 0, "user NO debia tener cap");
        assertEq(IERC4626(VAULT).maxDeposit(USER), 0, "maxDeposit debe ser 0 sin cap");

        // Deposit revierte con ERC4626ExceededMaxDeposit(user, amount, 0)
        deal(PYUSD, USER, DEPOSIT_AMOUNT);
        vm.startPrank(USER);
        IERC20(PYUSD).approve(VAULT, DEPOSIT_AMOUNT);
        vm.expectRevert();
        IERC4626(VAULT).deposit(DEPOSIT_AMOUNT, USER);
        vm.stopPrank();

        console.log("[BUG] deposit revertio correctamente: user sin whitelist cap");
    }

    // ── Fix: owner whitelist al user → deposit exitoso ────────────────────

    function test_fix_whitelistAndDeposit() public {
        console.log("=== Estado inicial ===");
        console.log("whitelist enabled:        ", IConfigurationFacet(VAULT).isDepositWhitelistEnabled());
        console.log("availableToDeposit(user): ", IConfigurationFacet(VAULT).getAvailableToDeposit(USER));
        console.log("maxDeposit(user):         ", IERC4626(VAULT).maxDeposit(USER));
        console.log("totalAssets:              ", IVaultFacet(VAULT).totalAssets());
        console.log("depositCapacity:          ", IConfigurationFacet(VAULT).depositCapacity());
        console.log("PYUSD balance user:       ", IERC20(PYUSD).balanceOf(USER));

        // 1. Owner whitelist al user con cap de 10k PYUSD
        vm.startPrank(OWNER);
        address[] memory depositors = new address[](1);
        uint256[] memory caps = new uint256[](1);
        depositors[0] = USER;
        caps[0] = WHITELIST_CAP;
        IConfigurationFacet(VAULT).setDepositWhitelist(depositors, caps);
        vm.stopPrank();

        console.log("\n=== Despues de setDepositWhitelist ===");
        uint256 maxDep = IERC4626(VAULT).maxDeposit(USER);
        console.log("availableToDeposit(user): ", IConfigurationFacet(VAULT).getAvailableToDeposit(USER));
        console.log("maxDeposit(user):         ", maxDep);
        assertEq(maxDep, WHITELIST_CAP, "maxDeposit debe igualar el cap");

        // 2. Deal PYUSD y depositar
        deal(PYUSD, USER, DEPOSIT_AMOUNT);

        vm.startPrank(USER);
        IERC20(PYUSD).approve(VAULT, DEPOSIT_AMOUNT);
        uint256 shares = IERC4626(VAULT).deposit(DEPOSIT_AMOUNT, USER);
        vm.stopPrank();

        console.log("\n=== Despues del deposit ===");
        console.log("shares recibidas:         ", shares);
        console.log("totalAssets:              ", IVaultFacet(VAULT).totalAssets());
        console.log("availableToDeposit(user): ", IConfigurationFacet(VAULT).getAvailableToDeposit(USER));

        assertGt(shares, 0, "debe recibir shares");
        assertEq(
            IConfigurationFacet(VAULT).getAvailableToDeposit(USER),
            WHITELIST_CAP - DEPOSIT_AMOUNT,
            "availableToDeposit debe decrementarse"
        );
    }
}
