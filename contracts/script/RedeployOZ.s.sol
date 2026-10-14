// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";

import { OZGovernor } from "../src/governance/OZGovernor.sol";
import { ProposalDomains } from "../src/resolvers/ProposalDomains.sol";
import { GraphDomainScope } from "../src/enforcers/GraphDomainScope.sol";
import { IMultiVault } from "../src/interfaces/IMultiVault.sol";

/// @title RedeployOZ
/// @notice Puts a new governor, resolver and enforcer on chain against the existing token.
/// @dev Changing the governor means changing the enforcer too, since an enforcer binds its
///      governor, selector and resolver at construction. The resolver goes with them
///      rather than being reused: an OZ proposal id is a hash of the call it would
///      execute, and that call targets the governor, so ids from the old governor cannot
///      collide — but a fresh register costs nothing and leaves no room to find out
///      otherwise.
///
///      The token is deliberately kept. Balances and self-delegations live there, and a
///      new one would mean minting and self-delegating all over again for nothing: it
///      answers how much weight an account holds, which this change does not touch.
///
///      OZ_TOKEN=0x… forge script script/RedeployOZ.s.sol --rpc-url intuition_testnet --broadcast
contract RedeployOZ is Script {
    /// @notice Deployment attempted on a chain other than Intuition testnet.
    error WrongChain(uint256 chainId);

    address internal constant MULTIVAULT = 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91;
    /// @dev "is a sub-domain of" — the predicate the demo graph is wired with (ADR 0008).
    bytes32 internal constant SUB_DOMAIN = 0x9c2e2f2018dbfaa74fd3fd86cd54a62b16e771936f5d342e3751db8d0c046f80;
    uint256 internal constant INTUITION_TESTNET_CHAIN_ID = 13579;

    function run() external {
        if (block.chainid != INTUITION_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        address token = vm.envAddress("OZ_TOKEN");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        ProposalDomains resolver = new ProposalDomains();
        // Weight read live rather than at the proposal's snapshot, so handing a domain
        // over reaches proposals that are already open (ADR 0015).
        OZGovernor governor =
            new OZGovernor(IVotes(token), IMultiVault(MULTIVAULT), SUB_DOMAIN, resolver, false);
        GraphDomainScope enforcer = new GraphDomainScope(
            IMultiVault(MULTIVAULT), address(governor), OZGovernor.castVoteFor.selector, address(resolver)
        );
        vm.stopBroadcast();

        console2.log("DemoVotes (kept):    ", token);
        console2.log("ProposalDomains:     ", address(resolver));
        console2.log("OZGovernor:          ", address(governor));
        console2.log("OZGraphDomainScope:  ", address(enforcer));
    }
}
