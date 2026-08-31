// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { Nonces } from "@openzeppelin/contracts/utils/Nonces.sol";

import { OZGovernor } from "../../src/governance/OZGovernor.sol";
import { ProposalDomains } from "../../src/resolvers/ProposalDomains.sol";
import { DomainVotes } from "../../src/governance/DomainVotes.sol";
import { MockMultiVault } from "../mocks/MockMultiVault.sol";

/// @dev The smallest ERC20Votes that OZ's GovernorVotes will accept.
contract VoteToken is ERC20, ERC20Permit, ERC20Votes {
    constructor() ERC20("Vote", "VOTE") ERC20Permit("Vote") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}

/// @notice Per-domain delegation on a stock OpenZeppelin Governor.
///
/// @dev What these prove is that the scheme does not need our own governor: weight still
///      comes from an ERC20Votes snapshot, the lifecycle is OZ's, and the only thing added
///      is which domain an account may exercise its weight on.
contract DomainScopedGovernorTest is Test {
    VoteToken internal token;
    MockMultiVault internal vault;
    ProposalDomains internal resolver;
    OZGovernor internal governor;

    address internal alice = address(0xA);
    address internal bob = address(0xB);

    bytes32 internal constant PREDICATE = keccak256("is a sub-domain of");
    bytes32 internal constant TREASURY = keccak256("treasury");
    bytes32 internal constant GRANTS = keccak256("grants");
    bytes32 internal constant COMMUNITY = keccak256("community");

    function setUp() public {
        token = new VoteToken();
        vault = new MockMultiVault();
        resolver = new ProposalDomains();
        governor = new OZGovernor(IVotes(address(token)), vault, PREDICATE, resolver, false);

        // grants sits under treasury; community does not.
        vault.createTriple(GRANTS, PREDICATE, TREASURY);

        token.mint(alice, 1);
        token.mint(bob, 1);
        vm.prank(alice);
        token.delegate(alice);
        vm.prank(bob);
        token.delegate(bob);
        vm.roll(block.number + 1);
    }

    /// @dev A proposal on `domainId`, recorded in the resolver and moved to Active.
    function _propose(bytes32 domainId) internal returns (uint256 proposalId) {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        targets[0] = address(governor);
        calldatas[0] = "";

        vm.prank(alice);
        proposalId = governor.propose(targets, values, calldatas, vm.toString(domainId));
        resolver.scopeProposal(proposalId, domainId);
        vm.roll(block.number + governor.votingDelay() + 1);
    }

    /// @dev The params an account passes to claim delegated weight on a domain.
    function _params(uint256 proposalId, bytes32[] memory path, address[] memory principals)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(proposalId, path, principals);
    }

    function _path(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory path) {
        path = new bytes32[](2);
        path[0] = a;
        path[1] = b;
    }

    function _only(address account) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = account;
    }

    function test_WithoutDelegation_EachAccountVotesItsOwn() public {
        uint256 id = _propose(GRANTS);
        vm.prank(bob);
        uint256 weight = governor.castVote(id, 1);
        assertEq(weight, 1, "bob votes with its own token weight");
    }

    function test_DelegatedDomain_CarriesThePrincipalsWeight() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY);

        uint256 id = _propose(GRANTS);
        vm.prank(bob);
        // `grants` sits under `treasury`, so alice's grant reaches this proposal.
        uint256 weight = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, _path(GRANTS, TREASURY), _only(alice))
        );
        assertEq(weight, 2, "bob's own vote plus alice's");
    }

    function test_RevertWhen_DomainIsOutsideTheGrant() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY);

        uint256 id = _propose(COMMUNITY);
        vm.prank(bob);
        // No attested edge connects community to treasury: the claimed path is refused.
        vm.expectRevert(
            abi.encodeWithSelector(DomainVotes.DomainPathBroken.selector, COMMUNITY, TREASURY)
        );
        governor.castVoteWithReasonAndParams(id, 1, "", _params(id, _path(COMMUNITY, TREASURY), _only(alice)));
    }

    function test_RevertWhen_DelegatorVotesOnADomainItGaveAway() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY);

        uint256 id = _propose(GRANTS);
        vm.prank(alice);
        bytes32[] memory path = _path(GRANTS, TREASURY);
        address[] memory none = new address[](0);
        vm.expectRevert(
            abi.encodeWithSelector(DomainVotes.WeightDelegatedAway.selector, alice, GRANTS, bob)
        );
        governor.castVoteWithReasonAndParams(id, 1, "", _params(id, path, none));
    }

    function test_UnclaimedPrincipalIsIgnored() public {
        // Nobody delegated to bob, so naming alice buys nothing.
        uint256 id = _propose(GRANTS);
        vm.prank(bob);
        uint256 weight = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, _path(GRANTS, TREASURY), _only(alice))
        );
        assertEq(weight, 1, "a claim that is not backed by a delegation counts for nothing");
    }

    function test_DelegationIsPerDomain_OtherDomainsStay() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY);

        uint256 id = _propose(COMMUNITY);
        vm.prank(alice);
        address[] memory none = new address[](0);
        bytes32[] memory justCommunity = new bytes32[](1);
        justCommunity[0] = COMMUNITY;
        uint256 weight = governor.castVoteWithReasonAndParams(id, 1, "", _params(id, justCommunity, none));
        assertEq(weight, 1, "giving treasury away leaves community alone");
    }

    /// @dev The reason this governor reads weight live rather than at the snapshot.
    ///
    ///      Stock OpenZeppelin reads an account's balance as it stood when the proposal was
    ///      created, so a delegation made afterwards counts for nothing on it. Delegating is
    ///      supposed to take effect now, which would otherwise mean recreating every open
    ///      proposal after each handover.
    function test_DelegationAppliesToAProposalAlreadyOpen() public {
        // The proposal is created and opens with nothing delegated.
        uint256 id = _propose(GRANTS);

        // Only now does alice hand the treasury over, well after that snapshot was taken.
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY);

        vm.prank(bob);
        uint256 weight = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, _path(GRANTS, TREASURY), _only(alice))
        );
        assertEq(weight, 2, "a delegation made after the proposal opened still counts on it");
    }

    /// @dev What the UI reads to show each identity's weight on a domain.
    function test_WeightForReflectsTheRegister() public {
        bytes32[] memory path = _path(GRANTS, TREASURY);
        assertEq(governor.weightFor(bob, GRANTS, _only(alice), path), 1, "bob alone before any handover");

        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY);

        assertEq(governor.weightFor(bob, GRANTS, _only(alice), path), 2, "bob carries alice's too");
        address[] memory none = new address[](0);
        assertEq(governor.weightFor(alice, GRANTS, none, path), 0, "alice handed this domain away");
    }

    function test_ResolverRecordsADomainOnce() public {
        uint256 id = _propose(GRANTS);
        vm.expectRevert(abi.encodeWithSelector(ProposalDomains.DomainAlreadySet.selector, id, GRANTS));
        resolver.scopeProposal(id, COMMUNITY);
    }
}
