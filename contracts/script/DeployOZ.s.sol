// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";

import { DemoVotes } from "../src/token/DemoVotes.sol";
import { OZGovernor } from "../src/governance/OZGovernor.sol";
import { ProposalDomains } from "../src/resolvers/ProposalDomains.sol";
import { GraphDomainScope } from "../src/enforcers/GraphDomainScope.sol";
import { IMultiVault } from "../src/interfaces/IMultiVault.sol";

/// @title DeployOZ
/// @notice Deploys the OpenZeppelin-based chain: a votes token, the proposal-domain
///         resolver, an unmodified-OZ governor with per-domain votes, and an enforcer
///         bound to that governor.
/// @dev Separate from Deploy.s.sol, which puts the demo's own governor on chain. Both can
///      run side by side: the enforcer is bound to one governor at construction, so each
///      chain gets its own.
///
///      forge script script/DeployOZ.s.sol --rpc-url intuition_testnet --broadcast
contract DeployOZ is Script {
    /// @notice Deployment attempted on a chain other than Intuition testnet.
    error WrongChain(uint256 chainId);

    address internal constant MULTIVAULT = 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91;
    /// @dev "is a sub-domain of" — the predicate the demo graph is wired with (ADR 0008).
    bytes32 internal constant SUB_DOMAIN = 0x9c2e2f2018dbfaa74fd3fd86cd54a62b16e771936f5d342e3751db8d0c046f80;
    uint256 internal constant INTUITION_TESTNET_CHAIN_ID = 13579;

    function run() external {
        if (block.chainid != INTUITION_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        DemoVotes token = new DemoVotes();
        ProposalDomains resolver = new ProposalDomains();
        OZGovernor governor = new OZGovernor(IVotes(address(token)), IMultiVault(MULTIVAULT), SUB_DOMAIN, resolver, false);
        // The enforcer allows one selector on one governor. Delegated votes go through
        // castVoteFor, the entry point that takes the voter explicitly, because OZ's public
        // ones read it from `_msgSender()`, which under a redemption is the root delegator
        // rather than the delegate. The enforcer also refuses a voter who is not the
        // redeemer, so a delegation cannot be used to vote under someone else's name.
        GraphDomainScope enforcer = new GraphDomainScope(
            IMultiVault(MULTIVAULT), address(governor), OZGovernor.castVoteFor.selector, address(resolver)
        );
        vm.stopBroadcast();

        console2.log("DemoVotes:        ", address(token));
        console2.log("ProposalDomains:  ", address(resolver));
        console2.log("OZGovernor:       ", address(governor));
        console2.log("GraphDomainScope: ", address(enforcer));
    }
}
