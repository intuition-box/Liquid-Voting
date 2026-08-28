// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Test } from "forge-std/Test.sol";

import { MockGovernor } from "../../src/MockGovernor.sol";
import { IMultiVault } from "../../src/interfaces/IMultiVault.sol";
import { MockMultiVault } from "../mocks/MockMultiVault.sol";

/// @notice Unit suite for the MockGovernor: the proposal record the enforcer targets,
///         plus the OpenZeppelin-shaped lifecycle around it.
contract MockGovernorTest is Test {
    MockGovernor internal governor;
    MockMultiVault internal vault;

    bytes32 internal DOMAIN;
    bytes32 internal OTHER_DOMAIN;
    bytes32 internal predicate;

    event ProposalCreated(
        uint256 indexed proposalId,
        bytes32 indexed domainId,
        address indexed proposer,
        string description,
        uint256 voteStart,
        uint256 voteEnd
    );
    event VoteCast(
        uint256 indexed proposalId, address indexed voter, uint8 support, uint256 weight, address[] principals
    );
    event VoteCastOnBehalf(
        uint256 indexed proposalId, address indexed principal, address indexed representative, uint256 weight
    );
    event ProposalExecuted(uint256 indexed proposalId);
    event WeightDelegated(address indexed delegator, address indexed delegate, bytes32 indexed domainId);

    function setUp() public {
        vault = new MockMultiVault();
        predicate = vault.createAtom("is a sub-domain of");
        DOMAIN = vault.createAtom("domain");
        OTHER_DOMAIN = vault.createAtom("other");
        governor = new MockGovernor(IMultiVault(address(vault)), predicate);
        // Start above block 0 so `voteStart` is never reached by an unrelated roll.
        vm.roll(100);
    }

    /// @dev Moves into the proposal's voting window.
    function _openVoting() private {
        vm.roll(block.number + governor.VOTING_DELAY());
    }

    /// @dev Moves past the proposal's voting window.
    function _closeVoting() private {
        vm.roll(block.number + governor.VOTING_DELAY() + governor.VOTING_PERIOD() + 1);
    }

    ////////////////////////////// propose //////////////////////////////

    function test_Propose_RecordsAndEmits() public {
        uint256 voteStart = block.number + governor.VOTING_DELAY();
        uint256 voteEnd = voteStart + governor.VOTING_PERIOD();

        vm.expectEmit(true, true, true, true);
        emit ProposalCreated(0, DOMAIN, address(this), "first", voteStart, voteEnd);
        uint256 id = governor.propose(DOMAIN, "first");

        assertEq(id, 0);
        assertEq(governor.proposalCount(), 1);
        MockGovernor.Proposal memory p = governor.getProposal(0);
        assertEq(p.domainId, DOMAIN);
        assertEq(p.proposer, address(this));
        assertEq(p.description, "first");
        assertEq(p.voteStart, voteStart);
        assertEq(p.voteEnd, voteEnd);
        assertFalse(p.executed);
    }

    function test_Propose_SequentialIds() public {
        assertEq(governor.propose(DOMAIN, "a"), 0);
        assertEq(governor.propose(DOMAIN, "b"), 1);
        assertEq(governor.proposalCount(), 2);
    }

    function test_RevertWhen_ProposalNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.ProposalNotFound.selector, 0));
        governor.getProposal(0);
    }

    ////////////////////////////// lifecycle //////////////////////////////

    function test_State_PendingBeforeVoteStart() public {
        governor.propose(DOMAIN, "p");
        assertEq(uint8(governor.state(0)), uint8(MockGovernor.ProposalState.Pending));
    }

    function test_State_ActiveInsideWindow() public {
        governor.propose(DOMAIN, "p");
        _openVoting();
        assertEq(uint8(governor.state(0)), uint8(MockGovernor.ProposalState.Active));
    }

    function test_State_DefeatedWhenNoQuorum() public {
        governor.propose(DOMAIN, "p");
        _closeVoting();
        assertEq(uint8(governor.state(0)), uint8(MockGovernor.ProposalState.Defeated));
    }

    function test_State_DefeatedWhenAgainstWins() public {
        governor.propose(DOMAIN, "p");
        _openVoting();
        vm.prank(address(0xA11CE));
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
        vm.prank(address(0xB0B));
        governor.castVote(0, uint8(MockGovernor.VoteType.Against));
        vm.prank(address(0xCAFE));
        governor.castVote(0, uint8(MockGovernor.VoteType.Against));
        _closeVoting();
        assertEq(uint8(governor.state(0)), uint8(MockGovernor.ProposalState.Defeated));
    }

    function test_State_SucceededWhenForWins() public {
        governor.propose(DOMAIN, "p");
        _openVoting();
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
        _closeVoting();
        assertEq(uint8(governor.state(0)), uint8(MockGovernor.ProposalState.Succeeded));
    }

    function test_State_AbstainCountsForQuorumButNotForSuccess() public {
        governor.propose(DOMAIN, "p");
        _openVoting();
        governor.castVote(0, uint8(MockGovernor.VoteType.Abstain));
        _closeVoting();
        // Quorum is met, but For does not beat Against (0 vs 0).
        assertEq(uint8(governor.state(0)), uint8(MockGovernor.ProposalState.Defeated));
    }

    ////////////////////////////// castVote //////////////////////////////

    function test_CastVote_TalliesAndEmits() public {
        governor.propose(DOMAIN, "p");
        _openVoting();

        vm.expectEmit(true, true, true, true);
        emit VoteCast(0, address(this), uint8(MockGovernor.VoteType.For), 1, new address[](0));
        uint256 weight = governor.castVote(0, uint8(MockGovernor.VoteType.For));

        assertEq(weight, 1);
        assertTrue(governor.hasVoted(0, address(this)));
        (uint256 against, uint256 forVotes, uint256 abstain) = governor.proposalVotes(0);
        assertEq(against, 0);
        assertEq(forVotes, 1);
        assertEq(abstain, 0);
    }

    function test_CastVote_EachOptionLandsInItsTally() public {
        governor.propose(DOMAIN, "p");
        _openVoting();
        vm.prank(address(0xA11CE));
        governor.castVote(0, uint8(MockGovernor.VoteType.Against));
        vm.prank(address(0xB0B));
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
        vm.prank(address(0xCAFE));
        governor.castVote(0, uint8(MockGovernor.VoteType.Abstain));

        (uint256 against, uint256 forVotes, uint256 abstain) = governor.proposalVotes(0);
        assertEq(against, 1);
        assertEq(forVotes, 1);
        assertEq(abstain, 1);
    }

    function test_RevertWhen_VotingBeforeStart() public {
        governor.propose(DOMAIN, "p");
        vm.expectRevert(
            abi.encodeWithSelector(MockGovernor.VotingNotActive.selector, 0, MockGovernor.ProposalState.Pending)
        );
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
    }

    function test_RevertWhen_VotingAfterEnd() public {
        governor.propose(DOMAIN, "p");
        _closeVoting();
        vm.expectRevert(
            abi.encodeWithSelector(MockGovernor.VotingNotActive.selector, 0, MockGovernor.ProposalState.Defeated)
        );
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
    }

    function test_RevertWhen_VotingTwice() public {
        governor.propose(DOMAIN, "p");
        _openVoting();
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.AlreadyVoted.selector, 0, address(this)));
        governor.castVote(0, uint8(MockGovernor.VoteType.Against));
    }

    function test_RevertWhen_VoteTypeOutOfRange() public {
        governor.propose(DOMAIN, "p");
        _openVoting();
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.InvalidVoteType.selector, uint8(3)));
        governor.castVote(0, 3);
    }

    function test_RevertWhen_VotingOnUnknownProposal() public {
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.ProposalNotFound.selector, 7));
        governor.castVote(7, uint8(MockGovernor.VoteType.For));
    }

    ////////////////////////////// weighted + delegated votes //////////////////////////////

    function test_VotingPower_DefaultsThenAssigns() public {
        assertEq(governor.votingPower(address(0xA11CE)), governor.DEFAULT_VOTING_POWER());
        governor.setVotingPower(address(0xA11CE), 7);
        assertEq(governor.votingPower(address(0xA11CE)), 7);
    }

    function test_VotingPower_CanBeSetToZero() public {
        governor.setVotingPower(address(0xA11CE), 0);
        assertEq(governor.votingPower(address(0xA11CE)), 0);
    }

    function test_RevertWhen_VotingPowerForZeroAddress() public {
        vm.expectRevert(MockGovernor.ZeroAddress.selector);
        governor.setVotingPower(address(0), 1);
    }

    function test_CastVote_AppliesAssignedWeight() public {
        governor.setVotingPower(address(0xA11CE), 5);
        governor.propose(DOMAIN, "p");
        _openVoting();

        vm.prank(address(0xA11CE));
        uint256 weight = governor.castVote(0, uint8(MockGovernor.VoteType.For));

        assertEq(weight, 5);
        (, uint256 forVotes,) = governor.proposalVotes(0);
        assertEq(forVotes, 5);
    }

    /// @dev The demo's headline: B casts one vote carrying its own power and A's.
    function test_CastVoteFor_AggregatesPrincipalWeight() public {
        address a = address(0xA);
        address b = address(0xB);
        governor.setVotingPower(a, 1);
        governor.setVotingPower(b, 1);
        vm.prank(a);
        governor.delegateWeight(b, DOMAIN);
        governor.propose(DOMAIN, "p");
        _openVoting();

        address[] memory principals = new address[](1);
        principals[0] = a;

        vm.expectEmit(true, true, true, true);
        emit VoteCastOnBehalf(0, a, b, 1);
        vm.expectEmit(true, true, true, true);
        emit VoteCast(0, b, uint8(MockGovernor.VoteType.For), 2, principals);

        vm.prank(b);
        uint256 weight = governor.castVoteFor(0, uint8(MockGovernor.VoteType.For), b, principals, new bytes32[](0));

        assertEq(weight, 2, "B votes with its own weight plus A's");
        (, uint256 forVotes,) = governor.proposalVotes(0);
        assertEq(forVotes, 2);
        assertTrue(governor.hasVoted(0, a), "A's power is spent");
        assertTrue(governor.hasVoted(0, b), "B's power is spent");
    }

    function test_CastVoteFor_SeveralPrincipals() public {
        address b = address(0xB);
        address[] memory principals = new address[](2);
        principals[0] = address(0xA);
        principals[1] = address(0xC);
        governor.setVotingPower(b, 2);
        governor.setVotingPower(principals[0], 3);
        governor.setVotingPower(principals[1], 4);
        vm.prank(principals[0]);
        governor.delegateWeight(b, DOMAIN);
        vm.prank(principals[1]);
        governor.delegateWeight(b, DOMAIN);
        governor.propose(DOMAIN, "p");
        _openVoting();

        vm.prank(b);
        assertEq(governor.castVoteFor(0, uint8(MockGovernor.VoteType.For), b, principals, new bytes32[](0)), 9);
    }

    function test_RevertWhen_PrincipalAlreadyVotedItself() public {
        address a = address(0xA);
        address b = address(0xB);
        governor.propose(DOMAIN, "p");
        _openVoting();

        vm.prank(a);
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
        // Delegating after voting: the weight is already spent on this proposal.
        vm.prank(a);
        governor.delegateWeight(b, DOMAIN);

        address[] memory principals = new address[](1);
        principals[0] = a;
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.AlreadyVoted.selector, 0, a));
        vm.prank(b);
        governor.castVoteFor(0, uint8(MockGovernor.VoteType.For), b, principals, new bytes32[](0));
    }

    function test_RevertWhen_PrincipalRepresentedTwiceInOneCall() public {
        address[] memory principals = new address[](2);
        principals[0] = address(0xA);
        principals[1] = address(0xA);
        vm.prank(address(0xA));
        governor.delegateWeight(address(0xB), DOMAIN);
        governor.propose(DOMAIN, "p");
        _openVoting();

        vm.expectRevert(abi.encodeWithSelector(MockGovernor.AlreadyVoted.selector, 0, address(0xA)));
        vm.prank(address(0xB));
        governor.castVoteFor(0, uint8(MockGovernor.VoteType.For), address(0xB), principals, new bytes32[](0));
    }

    function test_RevertWhen_RepresentativeAlreadyVoted() public {
        address b = address(0xB);
        vm.prank(address(0xA));
        governor.delegateWeight(b, DOMAIN);
        governor.propose(DOMAIN, "p");
        _openVoting();

        vm.prank(b);
        governor.castVote(0, uint8(MockGovernor.VoteType.For));

        address[] memory principals = new address[](1);
        principals[0] = address(0xA);
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.AlreadyVoted.selector, 0, b));
        vm.prank(b);
        governor.castVoteFor(0, uint8(MockGovernor.VoteType.For), b, principals, new bytes32[](0));
    }

    function test_RevertWhen_NoVotingPowerAtAll() public {
        address b = address(0xB);
        governor.setVotingPower(b, 0);
        governor.propose(DOMAIN, "p");
        _openVoting();

        vm.expectRevert(abi.encodeWithSelector(MockGovernor.NoVotingPower.selector, b));
        vm.prank(b);
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
    }

    ////////////////////////////// weight transfer //////////////////////////////


    function test_DelegateWeight_RecordsAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit WeightDelegated(address(this), address(0xB), DOMAIN);
        governor.delegateWeight(address(0xB), DOMAIN);
        assertEq(governor.delegatedTo(address(this), DOMAIN), address(0xB));
    }

    /// Delegating transfers weight: the delegator stops counting on that domain.
    function test_RevertWhen_VotingAfterDelegatingTheDomain() public {
        address a = address(0xA);
        vm.prank(a);
        governor.delegateWeight(address(0xB), DOMAIN);
        governor.propose(DOMAIN, "p");
        _openVoting();

        vm.expectRevert(
            abi.encodeWithSelector(MockGovernor.WeightDelegatedAway.selector, a, DOMAIN, address(0xB))
        );
        vm.prank(a);
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
    }

    /// Transfer is per domain: delegating one leaves the others untouched.
    function test_DelegatingOneDomainLeavesOthers() public {
        address a = address(0xA);
        vm.prank(a);
        governor.delegateWeight(address(0xB), DOMAIN);
        governor.propose(OTHER_DOMAIN, "p");
        _openVoting();

        vm.prank(a);
        assertEq(governor.castVote(0, uint8(MockGovernor.VoteType.For)), 1, "A still votes elsewhere");
    }

    /// Weight is conserved: what A loses, B gains — the total never grows.
    function test_WeightIsTransferredNotDuplicated() public {
        address a = address(0xA);
        address b = address(0xB);
        vm.prank(a);
        governor.delegateWeight(b, DOMAIN);
        governor.propose(DOMAIN, "p");
        _openVoting();

        address[] memory principals = new address[](1);
        principals[0] = a;
        vm.prank(b);
        governor.castVoteFor(0, uint8(MockGovernor.VoteType.For), b, principals, new bytes32[](0));

        (, uint256 forVotes,) = governor.proposalVotes(0);
        assertEq(forVotes, 2, "A's one plus B's one, no more");
    }

    /// Weight passed along a chain reaches the far end: A -> B -> C means C carries both.
    function test_WeightRoutesAlongAChain() public {
        address a = address(0xA);
        address b = address(0xB);
        address c = address(0xC);
        vm.prank(a);
        governor.delegateWeight(b, DOMAIN);
        vm.prank(b);
        governor.delegateWeight(c, DOMAIN);
        governor.propose(DOMAIN, "p");
        _openVoting();

        address[] memory principals = new address[](2);
        principals[0] = a;
        principals[1] = b;
        vm.prank(c);
        assertEq(governor.castVoteFor(0, uint8(MockGovernor.VoteType.For), c, principals, new bytes32[](0)), 3);
    }

    function test_RevertWhen_ClaimingWeightNobodyDelegated() public {
        governor.propose(DOMAIN, "p");
        _openVoting();

        address[] memory principals = new address[](1);
        principals[0] = address(0xA);
        vm.expectRevert(
            abi.encodeWithSelector(
                MockGovernor.NotDelegatedToVoter.selector, address(0xA), address(0xB), DOMAIN
            )
        );
        vm.prank(address(0xB));
        governor.castVoteFor(0, uint8(MockGovernor.VoteType.For), address(0xB), principals, new bytes32[](0));
    }

    function test_RevertWhen_DelegatingToSelf() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                MockGovernor.CircularDelegation.selector, address(this), address(this), DOMAIN
            )
        );
        governor.delegateWeight(address(this), DOMAIN);
    }

    /// A -> B, then B -> A on the same domain would send the weight in a circle.
    function test_RevertWhen_DelegationWouldCircle() public {
        address a = address(0xA);
        address b = address(0xB);
        vm.prank(a);
        governor.delegateWeight(b, DOMAIN);

        vm.expectRevert(abi.encodeWithSelector(MockGovernor.CircularDelegation.selector, b, a, DOMAIN));
        vm.prank(b);
        governor.delegateWeight(a, DOMAIN);
    }

    /// The circle check is per domain: a disjoint domain is free to go the other way.
    function test_ReverseDelegationOnAnotherDomainIsAllowed() public {
        address a = address(0xA);
        address b = address(0xB);
        vm.prank(a);
        governor.delegateWeight(b, DOMAIN);

        vm.prank(b);
        governor.delegateWeight(a, OTHER_DOMAIN);
        assertEq(governor.delegatedTo(b, OTHER_DOMAIN), a);
    }

    function test_DelegateWeight_CanBeCleared() public {
        governor.delegateWeight(address(0xB), DOMAIN);
        governor.delegateWeight(address(0), DOMAIN);
        assertEq(governor.delegatedTo(address(this), DOMAIN), address(0));
    }

    function test_WeightFor_MatchesWhatAVoteWouldCount() public {
        address a = address(0xA);
        address b = address(0xB);
        vm.prank(a);
        governor.delegateWeight(b, DOMAIN);

        address[] memory principals = new address[](1);
        principals[0] = a;
        assertEq(governor.weightFor(b, DOMAIN, principals, new bytes32[](0)), 2);
        assertEq(governor.weightFor(a, DOMAIN, principals, new bytes32[](0)), 0, "A gave this domain away");
    }

    ////////////////////////////// domain resolver //////////////////////////////

    function test_ProposalDomain_ReturnsTheScopedDomain() public {
        governor.propose(DOMAIN, "p");
        assertEq(governor.proposalDomain(0), DOMAIN);
    }

    function test_RevertWhen_ProposalDomainUnknownProposal() public {
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.ProposalNotFound.selector, 4));
        governor.proposalDomain(4);
    }

    ////////////////////////////// execute //////////////////////////////

    function test_Execute_MarksExecutedAndEmits() public {
        governor.propose(DOMAIN, "p");
        _openVoting();
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
        _closeVoting();

        vm.expectEmit(true, true, true, true);
        emit ProposalExecuted(0);
        governor.execute(0);

        assertTrue(governor.getProposal(0).executed);
        assertEq(uint8(governor.state(0)), uint8(MockGovernor.ProposalState.Executed));
    }

    function test_RevertWhen_ExecutingDefeated() public {
        governor.propose(DOMAIN, "p");
        _closeVoting();
        vm.expectRevert(
            abi.encodeWithSelector(MockGovernor.ProposalNotSucceeded.selector, 0, MockGovernor.ProposalState.Defeated)
        );
        governor.execute(0);
    }

    function test_RevertWhen_ExecutingTwice() public {
        governor.propose(DOMAIN, "p");
        _openVoting();
        governor.castVote(0, uint8(MockGovernor.VoteType.For));
        _closeVoting();
        governor.execute(0);
        vm.expectRevert(
            abi.encodeWithSelector(MockGovernor.ProposalNotSucceeded.selector, 0, MockGovernor.ProposalState.Executed)
        );
        governor.execute(0);
    }

    function test_RevertWhen_ExecutingUnknownProposal() public {
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.ProposalNotFound.selector, 3));
        governor.execute(3);
    }

    function test_RevertWhen_ProposalVotesUnknownProposal() public {
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.ProposalNotFound.selector, 1));
        governor.proposalVotes(1);
    }

    function test_RevertWhen_StateUnknownProposal() public {
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.ProposalNotFound.selector, 2));
        governor.state(2);
    }

    ////////////////////////////// fuzz //////////////////////////////

    function testFuzz_ProposeRoundtrip(bytes32 domainId, string calldata description) public {
        uint256 id = governor.propose(domainId, description);
        MockGovernor.Proposal memory p = governor.getProposal(id);
        assertEq(p.domainId, domainId);
        assertEq(p.description, description);
        assertEq(p.proposer, address(this));
    }

    function testFuzz_VoteTypeAboveAbstainAlwaysReverts(uint8 support) public {
        support = uint8(bound(support, 3, type(uint8).max));
        governor.propose(DOMAIN, "p");
        _openVoting();
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.InvalidVoteType.selector, support));
        governor.castVote(0, support);
    }
}
