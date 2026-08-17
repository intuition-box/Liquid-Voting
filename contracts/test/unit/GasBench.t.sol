// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Test } from "forge-std/Test.sol";
import { console2 } from "forge-std/console2.sol";
import { ModeLib, ModeCode } from "@erc7579/lib/ModeLib.sol";

import { GraphDomainCaveatEnforcer } from "../../src/GraphDomainCaveatEnforcer.sol";
import { MockGovernor } from "../../src/MockGovernor.sol";
import { IMultiVault } from "../../src/interfaces/IMultiVault.sol";
import { MockMultiVault } from "../mocks/MockMultiVault.sol";

/// @notice Gas benchmark for the enforcer's beforeHook across witness depths 0–5,
/// against MockMultiVault (mock storage costs approximate the live vault's; the fork
/// bench in test/fork calibrates depths 0–2 against the real deployment). Numbers are
/// logged per depth (`forge test --match-contract GasBench -vv`) and recorded in
/// docs/phase1/gas-report.md.
contract GasBenchTest is Test {
    MockMultiVault internal vault;
    MockGovernor internal governor;
    GraphDomainCaveatEnforcer internal enforcer;

    address internal delegator = makeAddr("delegator");
    address internal redeemer = makeAddr("redeemer");

    uint256 internal constant CURVE_ID = 1;

    bytes32 internal predicate;
    // chain[0] is the root; chain[i+1] — is a sub-domain of → chain[i].
    bytes32[6] internal chain;

    ModeCode internal singleMode;

    function setUp() public {
        vault = new MockMultiVault();
        governor = new MockGovernor();
        enforcer = new GraphDomainCaveatEnforcer(
            IMultiVault(address(vault)), address(governor), MockGovernor.propose.selector
        );

        predicate = vault.createAtom("is a sub-domain of");
        chain[0] = vault.createAtom("d0-root");
        for (uint256 i = 1; i < 6; i++) {
            chain[i] = vault.createAtom(abi.encodePacked("d", i));
            bytes32 tripleId = vault.createTriple(chain[i], predicate, chain[i - 1]);
            vault.setShares(delegator, tripleId, CURVE_ID, 1e15);
        }

        singleMode = ModeLib.encodeSimpleSingle();
    }

    function _measure(uint256 depth) internal view returns (uint256 gasUsed) {
        bytes memory terms = abi.encode(
            GraphDomainCaveatEnforcer.Terms({
                rootDomainId: chain[0],
                predicateId: predicate,
                maxDepth: 5,
                expiry: 0,
                attestor: address(0)
            })
        );
        bytes32[] memory path = new bytes32[](depth + 1);
        for (uint256 i = 0; i <= depth; i++) {
            path[i] = chain[depth - i];
        }
        bytes memory exec = abi.encodePacked(
            address(governor), uint256(0), abi.encodeCall(MockGovernor.propose, (chain[depth], "bench"))
        );

        uint256 before = gasleft();
        enforcer.beforeHook(terms, abi.encode(path), singleMode, exec, bytes32(0), delegator, redeemer);
        gasUsed = before - gasleft();
    }

    // One test per depth: each runs in a fresh transaction context, so every
    // measurement pays clean cold-access costs (a shared loop would warm storage
    // between depths and understate the marginal hop cost).

    function test_Gas_Depth0() public view {
        console2.log("beforeHook gas at depth 0:", _measure(0));
    }

    function test_Gas_Depth1() public view {
        console2.log("beforeHook gas at depth 1:", _measure(1));
    }

    function test_Gas_Depth2() public view {
        console2.log("beforeHook gas at depth 2:", _measure(2));
    }

    function test_Gas_Depth3() public view {
        console2.log("beforeHook gas at depth 3:", _measure(3));
    }

    function test_Gas_Depth4() public view {
        console2.log("beforeHook gas at depth 4:", _measure(4));
    }

    function test_Gas_Depth5() public view {
        console2.log("beforeHook gas at depth 5:", _measure(5));
    }
}
