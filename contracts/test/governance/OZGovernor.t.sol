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

        // The same footing for both, which is what the demo hands out. A hundred divides
        // into readable parts, so a lending of 25 is a quarter rather than a rounding.
        token.mint(alice, 100);
        token.mint(bob, 100);
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
        assertEq(weight, 100, "bob votes with its own token weight");
    }

    function test_DelegatedDomain_CarriesThePrincipalsWeight() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);

        uint256 id = _propose(GRANTS);
        vm.prank(bob);
        // `grants` sits under `treasury`, so alice's grant reaches this proposal.
        uint256 weight = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, _path(GRANTS, TREASURY), _only(alice))
        );
        assertEq(weight, 200, "bob's 100 plus alice's 100");
    }

    /// Lending part of a balance leaves the rest where it was.
    function test_PartialLending_SplitsTheWeight() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 25);

        uint256 id = _propose(GRANTS);

        vm.prank(bob);
        uint256 borrowed = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, _path(GRANTS, TREASURY), _only(alice))
        );
        assertEq(borrowed, 125, "bob's 100 plus the 25 alice lent");

        // Alice keeps what she did not lend, and can still cast it herself.
        vm.prank(alice);
        uint256 kept = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, _path(GRANTS, TREASURY), new address[](0))
        );
        assertEq(kept, 75, "alice keeps 100 less the 25 she lent");
    }

    /// A lending is capped by what the lender still holds when the vote is counted.
    function test_LendingIsCappedByTheBalanceAtVoteTime() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);

        // Alice sends most of her tokens away after lending all 12 of them.
        vm.prank(alice);
        token.transfer(address(0xCAFE), 90);
        vm.roll(block.number + 1);

        uint256 id = _propose(GRANTS);
        vm.prank(bob);
        uint256 weight = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, _path(GRANTS, TREASURY), _only(alice))
        );
        assertEq(weight, 110, "bob's 100 plus the 10 alice still holds, not the 100 she promised");
    }

    function test_RevertWhen_LendingMoreThanHeld() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DomainVotes.AmountExceedsBalance.selector, alice, 101, 100));
        governor.delegateWeight(bob, TREASURY, 101);
    }

    function test_RevertWhen_LendingNothing() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DomainVotes.ZeroAmount.selector, alice, TREASURY));
        governor.delegateWeight(bob, TREASURY, 0);
    }

    function test_RevertWhen_DomainIsOutsideTheGrant() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);

        uint256 id = _propose(COMMUNITY);
        vm.prank(bob);
        // No attested edge connects community to treasury: the claimed path is refused.
        vm.expectRevert(
            abi.encodeWithSelector(DomainVotes.DomainPathBroken.selector, COMMUNITY, TREASURY)
        );
        governor.castVoteWithReasonAndParams(id, 1, "", _params(id, _path(COMMUNITY, TREASURY), _only(alice)));
    }

    function test_CastVoteFor_RecordsTheVoteUnderTheNamedVoter() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);

        uint256 id = _propose(GRANTS);
        // The DelegationManager executes from the root delegator's account, so alice is
        // the caller here even though the vote is bob's. That is the whole reason this
        // entry point exists: OZ's public ones would record the vote as alice's.
        vm.prank(alice);
        uint256 weight = governor.castVoteFor(id, 1, bob, _only(alice), _path(GRANTS, TREASURY));

        assertEq(weight, 200, "bob's 100 plus alice's 100");
        assertTrue(governor.hasVoted(id, bob), "the vote is bob's");
        assertFalse(governor.hasVoted(id, alice), "alice only carried the call");
    }

    function test_RevertWhen_CastVoteForNamesNobody() public {
        uint256 id = _propose(GRANTS);
        vm.expectRevert(OZGovernor.ZeroAddress.selector);
        governor.castVoteFor(id, 1, address(0), _only(alice), _path(GRANTS, TREASURY));
    }

    function test_CastVoteFor_StillRefusesADomainOutsideTheGrant() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);

        uint256 id = _propose(COMMUNITY);
        // Naming the voter explicitly buys no authority: the path is checked all the same.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DomainVotes.DomainPathBroken.selector, COMMUNITY, TREASURY));
        governor.castVoteFor(id, 1, bob, _only(alice), _path(COMMUNITY, TREASURY));
    }

    /// Lending the whole balance leaves nothing behind, which is the old all-or-nothing
    /// behaviour arrived at from the other direction: it is now a lending of everything
    /// rather than a special case in the contract.
    function test_LendingEverythingLeavesTheLenderWithNothing() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);

        uint256 id = _propose(GRANTS);
        vm.prank(alice);
        uint256 weight = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, _path(GRANTS, TREASURY), new address[](0))
        );
        assertEq(weight, 0, "alice lent all of it");
    }

    function test_UnclaimedPrincipalIsIgnored() public {
        // Nobody delegated to bob, so naming alice buys nothing.
        uint256 id = _propose(GRANTS);
        vm.prank(bob);
        uint256 weight = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, _path(GRANTS, TREASURY), _only(alice))
        );
        assertEq(weight, 100, "a claim that is not backed by a delegation counts for nothing");
    }

    function test_DelegationIsPerDomain_OtherDomainsStay() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);

        uint256 id = _propose(COMMUNITY);
        vm.prank(alice);
        address[] memory none = new address[](0);
        bytes32[] memory justCommunity = new bytes32[](1);
        justCommunity[0] = COMMUNITY;
        uint256 weight = governor.castVoteWithReasonAndParams(id, 1, "", _params(id, justCommunity, none));
        assertEq(weight, 100, "giving treasury away leaves community alone");
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
        governor.delegateWeight(bob, TREASURY, 100);

        vm.prank(bob);
        uint256 weight = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, _path(GRANTS, TREASURY), _only(alice))
        );
        assertEq(weight, 200, "a delegation made after the proposal opened still counts on it");
    }

    /// @dev What the UI reads to show each identity's weight on a domain.
    function test_WeightForReflectsTheRegister() public {
        bytes32[] memory path = _path(GRANTS, TREASURY);
        assertEq(governor.weightFor(bob, GRANTS, _only(alice), path), 100, "bob alone before any handover");

        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 25);

        assertEq(governor.weightFor(bob, GRANTS, _only(alice), path), 125, "bob carries the 25 alice lent");
        address[] memory none = new address[](0);
        assertEq(governor.weightFor(alice, GRANTS, none, path), 75, "alice keeps what she did not lend");
    }

    function test_ResolverRecordsADomainOnce() public {
        uint256 id = _propose(GRANTS);
        vm.expectRevert(abi.encodeWithSelector(ProposalDomains.DomainAlreadySet.selector, id, GRANTS));
        resolver.scopeProposal(id, COMMUNITY);
    }
}
