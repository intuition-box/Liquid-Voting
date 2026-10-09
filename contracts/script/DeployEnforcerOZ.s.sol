// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { GraphDomainScope } from "../src/enforcers/GraphDomainScope.sol";
import { OZGovernor } from "../src/governance/OZGovernor.sol";
import { IMultiVault } from "../src/interfaces/IMultiVault.sol";

/// @title DeployEnforcerOZ
/// @notice Redeploys just the enforcer against an existing OZ governor and resolver.
/// @dev The enforcer binds its governor, selector and resolver at construction, so any
///      change to those means a new deployment. The governor and the token are untouched,
///      which keeps the balances, the self-delegations and the open proposals alive.
///
///      forge script script/DeployEnforcerOZ.s.sol --rpc-url intuition_testnet --broadcast
contract DeployEnforcerOZ is Script {
    address internal constant MULTIVAULT = 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91;

    function run() external {
        address governor = vm.envAddress("OZ_GOVERNOR");
        address resolver = vm.envAddress("OZ_RESOLVER");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        GraphDomainScope enforcer =
            new GraphDomainScope(IMultiVault(MULTIVAULT), governor, OZGovernor.castVoteFor.selector, resolver);
        vm.stopBroadcast();

        console2.log("GraphDomainScope: ", address(enforcer));
    }
}
