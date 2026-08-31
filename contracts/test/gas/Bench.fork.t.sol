// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Test } from "forge-std/Test.sol";
import { console2 } from "forge-std/console2.sol";
import { ModeLib, ModeCode } from "@erc7579/lib/ModeLib.sol";

import { GraphDomainScope } from "../../src/enforcers/GraphDomainScope.sol";
import { DemoGovernor } from "../../src/governance/DemoGovernor.sol";
import { IMultiVault } from "../../src/interfaces/IMultiVault.sol";

/// @notice Gas calibration of beforeHook against the REAL MultiVault on a 13579 fork,
/// depths 0–2 (the live graph's maximum chain: logo → branding → design). Validates
/// that the MockMultiVault bench numbers are representative of live costs.
contract GasBenchForkTest is Test {
    string internal constant DEFAULT_RPC = "https://testnet.rpc.intuition.systems/http";
    address internal constant MULTIVAULT = 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91;

    bytes32 internal constant DESIGN = 0x1392c1e72e3408bd41c4d2b670e4ac4371ca30c1b92b43b15d8b25a6954cb066;
    bytes32 internal constant BRANDING = 0x8017cd335e3f8c0ab844d752a8212952e78b772257c59d65142a6be8ebbeee7f;
    bytes32 internal constant LOGO = 0x1d3f36760a218532b7ceca6364a490f1d2674ec3f3eb29739b9da7e1edaddf7a;
    bytes32 internal constant PREDICATE = 0x9c2e2f2018dbfaa74fd3fd86cd54a62b16e771936f5d342e3751db8d0c046f80;
    bytes32 internal constant T_BRANDING_DESIGN = 0x176419b5177cfa99cba68cb6b0b884ea7bb593a84f0053ef6baf1e082f373784;
    bytes32 internal constant T_LOGO_BRANDING = 0xdcec7ce37346e051b98f1e19bc7d088a4844cdbe55d2b3ce9a3e5a320d70e865;

    IMultiVault internal vault;
    DemoGovernor internal governor;
    GraphDomainScope internal enforcer;

    address internal delegator = makeAddr("delegator");
    address internal redeemer = makeAddr("redeemer");

    ModeCode internal singleMode;

    function setUp() public {
        vm.createSelectFork(vm.envOr("INTUITION_TESTNET_RPC", DEFAULT_RPC));
        vault = IMultiVault(MULTIVAULT);
        governor = new DemoGovernor(vault, PREDICATE);
        enforcer = new GraphDomainScope(vault, address(governor), DemoGovernor.castVoteFor.selector);

        (, uint256 curveId) = vault.getBondingCurveConfig();
        vm.deal(delegator, 1 ether);
        vm.prank(delegator);
        vault.deposit{ value: 0.01 ether }(delegator, T_BRANDING_DESIGN, curveId, 0);
        vm.prank(delegator);
        vault.deposit{ value: 0.01 ether }(delegator, T_LOGO_BRANDING, curveId, 0);

        singleMode = ModeLib.encodeSimpleSingle();
    }

    function _measure(bytes32 domainId, bytes32[] memory path) internal returns (uint256 gasUsed) {
        bytes memory terms = abi.encode(
            GraphDomainScope.Terms({
                rootDomainId: DESIGN,
                predicateId: PREDICATE,
                maxDepth: 5,
                expiry: 0,
                attestor: address(0)
            })
        );
        // Recorded before the measurement so the proposal write stays out of the number.
        uint256 proposalId = governor.propose(domainId, "bench");
        address[] memory principals = new address[](1);
        principals[0] = delegator;
        bytes32[] memory noPath = new bytes32[](0);
        bytes memory exec = abi.encodePacked(
            address(governor),
            uint256(0),
            abi.encodeCall(DemoGovernor.castVoteFor, (proposalId, 1, redeemer, principals, noPath))
        );

        uint256 before = gasleft();
        enforcer.beforeHook(terms, abi.encode(path), singleMode, exec, bytes32(0), delegator, redeemer);
        gasUsed = before - gasleft();
    }

    function test_ForkGas_Depth0() public {
        bytes32[] memory path = new bytes32[](1);
        path[0] = DESIGN;
        console2.log("beforeHook fork gas at depth 0:", _measure(DESIGN, path));
    }

    function test_ForkGas_Depth1() public {
        bytes32[] memory path = new bytes32[](2);
        path[0] = BRANDING;
        path[1] = DESIGN;
        console2.log("beforeHook fork gas at depth 1:", _measure(BRANDING, path));
    }

    function test_ForkGas_Depth2() public {
        bytes32[] memory path = new bytes32[](3);
        path[0] = LOGO;
        path[1] = BRANDING;
        path[2] = DESIGN;
        console2.log("beforeHook fork gas at depth 2:", _measure(LOGO, path));
    }
}
