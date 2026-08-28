// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { GraphDomainCaveatEnforcer } from "../src/GraphDomainCaveatEnforcer.sol";
import { MockGovernor } from "../src/MockGovernor.sol";
import { IMultiVault } from "../src/interfaces/IMultiVault.sol";

/// @title Deploy
/// @notice Deploys MockGovernor + GraphDomainCaveatEnforcer to Intuition testnet.
/// @dev Refuses to run on any chain but 13579 (mainnet requires explicit user
///      confirmation and is out of scope — see .claude/rules/security.md).
///      PRIVATE_KEY comes from the environment and fails loudly if missing.
///
///      forge script script/Deploy.s.sol --rpc-url intuition_testnet --broadcast
contract Deploy is Script {
    /// @notice Deployment attempted on a chain other than Intuition testnet.
    error WrongChain(uint256 chainId);

    address internal constant MULTIVAULT = 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91;
    /// @dev "is a sub-domain of" — the predicate the demo graph is wired with (ADR 0008).
    bytes32 internal constant SUB_DOMAIN = 0x9c2e2f2018dbfaa74fd3fd86cd54a62b16e771936f5d342e3751db8d0c046f80;
    uint256 internal constant INTUITION_TESTNET_CHAIN_ID = 13579;

    /// @notice Runs the deployment and logs the addresses to record in the manifest.
    function run() external {
        if (block.chainid != INTUITION_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        MockGovernor governor = new MockGovernor(IMultiVault(MULTIVAULT), SUB_DOMAIN);
        GraphDomainCaveatEnforcer enforcer =
            new GraphDomainCaveatEnforcer(IMultiVault(MULTIVAULT), address(governor), MockGovernor.castVoteFor.selector);
        vm.stopBroadcast();

        console2.log("MockGovernor:              ", address(governor));
        console2.log("GraphDomainCaveatEnforcer: ", address(enforcer));
    }
}
