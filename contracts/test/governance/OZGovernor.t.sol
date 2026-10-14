// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { IGovernor } from "@openzeppelin/contracts/governance/IGovernor.sol";
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
    address internal carol = address(0xC);

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
        address[3] memory holders_ = [alice, bob, carol];
        for (uint256 i_; i_ < holders_.length; ++i_) {
            token.mint(holders_[i_], 100);
            vm.prank(holders_[i_]);
            token.delegate(holders_[i_]);
        }
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

    function _list(address a, address b) internal pure returns (address[] memory list) {
        list = new address[](2);
        list[0] = a;
        list[1] = b;
    }

    function _list(address a, address b, address c) internal pure returns (address[] memory list) {
        list = new address[](3);
        list[0] = a;
        list[1] = b;
        list[2] = c;
    }

    /// @dev The For tally, which is all these tests vote into.
    function _forVotes(uint256 proposalId) internal view returns (uint256 forVotes_) {
        (, forVotes_,) = governor.proposalVotes(proposalId);
    }

    /// @dev `support = For`, with the params this governor's counting scheme needs.
    function _voteFor(uint256 proposalId, address voter, address[] memory principals)
        internal
        returns (uint256 weight_)
    {
        vm.prank(voter);
        weight_ = governor.castVoteWithReasonAndParams(
            proposalId, 1, "", _params(proposalId, _path(GRANTS, TREASURY), principals)
        );
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

    // ── Weight is spent once, whoever spends it ──────────────────────────────────────
    //
    // These cover what the Intuition Box review found on 2026-10-13, plus what looking
    // for it turned up. Both failures came from the same place: a lending moves no token,
    // so nothing in OpenZeppelin's accounting notices that a voice has been used.

    /// The reported bug. B votes carrying A, A takes the domain back and votes again, and
    /// a proposal with 200 weight behind it reported 300.
    function test_RevertWhen_LenderRevotesAfterTakingItBack() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);
        uint256 id = _propose(GRANTS);

        assertEq(_voteFor(id, bob, _list(bob, alice)), 200, "bob's own plus alice's");
        assertEq(_forVotes(id), 200);

        // Alice takes her domain back mid-ballot. The lending is gone, so the register
        // says she kept everything — which is exactly the state that used to let her
        // cast weight bob had already spent.
        vm.prank(alice);
        governor.delegateWeight(address(0), TREASURY, 0);
        assertEq(governor.delegatedTo(alice, TREASURY), address(0), "the lending really is gone");

        vm.expectRevert(abi.encodeWithSelector(IGovernor.GovernorAlreadyCastVote.selector, alice));
        _voteFor(id, alice, new address[](0));

        assertEq(_forVotes(id), 200, "and the tally never moved");
    }

    /// The same bug in the other order: A votes for itself, then lends, and the delegate
    /// tries to carry a voice that is already on the ballot.
    function test_DelegateCannotCarryAVoiceTheLenderAlreadyCast() public {
        uint256 id = _propose(GRANTS);
        assertEq(_voteFor(id, alice, new address[](0)), 100, "alice casts her own");

        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);

        assertEq(_voteFor(id, bob, _list(bob, alice)), 100, "bob gets his own voice and no more");
        assertEq(_forVotes(id), 200, "alice once, bob once");
    }

    /// A partial lender keeps the rest of its voice, even after the delegate has voted —
    /// which is why the ledger counts weight rather than raising a flag.
    function test_PartialLender_KeepsTheRestAfterTheDelegateVotes() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 25);
        uint256 id = _propose(GRANTS);

        assertEq(_voteFor(id, bob, _list(bob, alice)), 125, "bob's 100 plus the 25 lent");
        assertEq(governor.voiceCast(id, alice), 25, "only the quarter she lent is spent");
        assertEq(governor.weightOn(id, alice, new address[](0), _path(GRANTS, TREASURY)), 75);

        assertEq(_voteFor(id, alice, new address[](0)), 75, "she still has three quarters");
        assertEq(_forVotes(id), 200, "two accounts, 200 between them");
    }

    /// Taking back a partial lending does not resurrect the part already cast.
    function test_RevokingAPartialLendingDoesNotRestoreWhatWasCast() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 25);
        uint256 id = _propose(GRANTS);
        _voteFor(id, bob, _list(bob, alice));

        vm.prank(alice);
        governor.delegateWeight(address(0), TREASURY, 0);

        // The register now says she kept all 100, but 25 of it is already on this ballot.
        assertEq(_voteFor(id, alice, new address[](0)), 75, "100 held, 25 already spent");
        assertEq(_forVotes(id), 200, "never more than the three accounts hold");
    }

    /// A chain of lendings hands the voice along: A lends to B, B lends to C, and it is C
    /// who votes with all three. Reading one hop stranded A's weight at B and dropped it
    /// from C's ballot in silence — a three-level chain counted 200 instead of 300.
    function test_ThreeLevels_WeightReachesTheEndOfTheChain() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);
        vm.prank(bob);
        governor.delegateWeight(carol, TREASURY, 100);
        uint256 id = _propose(GRANTS);

        assertEq(_voteFor(id, carol, _list(carol, bob, alice)), 300, "all three voices");
        assertEq(_forVotes(id), 300);
    }

    /// And the middle of the chain holds nothing: B passed on what it held, its own voice
    /// included, so naming A buys B nothing.
    function test_ThreeLevels_TheMiddleOfTheChainHoldsNothing() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);
        vm.prank(bob);
        governor.delegateWeight(carol, TREASURY, 100);
        uint256 id = _propose(GRANTS);

        assertEq(_voteFor(id, bob, _list(bob, alice)), 0, "bob lent everything onward");
    }

    /// A lending that comes back round to its lender carries nothing, and costs a fixed
    /// number of reads rather than all the gas there is.
    function test_ACycleInTheRegisterCarriesNothing() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);
        vm.prank(bob);
        governor.delegateWeight(alice, TREASURY, 100);
        uint256 id = _propose(GRANTS);

        assertEq(_voteFor(id, alice, _list(alice, bob)), 0, "both lent, neither received");
    }

    // ── Accountability ──────────────────────────────────────────────────────────────

    /// Every voice a vote carried is logged under the principal, indexed, so a delegator
    /// can find what was cast in its name with one filtered query instead of decoding
    /// every vote the governor ever recorded.
    function test_VoteCastOnBehalf_NamesEveryVoiceAndItsShare() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 25);
        uint256 id = _propose(GRANTS);

        vm.expectEmit(true, true, true, true, address(governor));
        emit DomainVotes.VoteCastOnBehalf(id, bob, bob, 100);
        vm.expectEmit(true, true, true, true, address(governor));
        emit DomainVotes.VoteCastOnBehalf(id, alice, bob, 25);
        _voteFor(id, bob, _list(bob, alice));

        assertEq(governor.voiceCast(id, bob), 100);
        assertEq(governor.voiceCast(id, alice), 25, "and the shares add up to the 125 counted");
    }

    /// `weightOn` is what a vote button should read: the register's answer, less whatever
    /// is already on this particular ballot.
    function test_WeightOn_FallsToZeroOnceTheVoiceIsSpent() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);
        uint256 id = _propose(GRANTS);
        bytes32[] memory path = _path(GRANTS, TREASURY);

        assertEq(governor.weightOn(id, bob, _only(alice), path), 200, "before anyone votes");
        _voteFor(id, bob, _list(bob, alice));

        assertEq(governor.weightOn(id, bob, _only(alice), path), 0, "bob has spent it");
        vm.prank(alice);
        governor.delegateWeight(address(0), TREASURY, 0);
        assertEq(governor.weightOn(id, alice, new address[](0), path), 0, "and so has alice, through bob");

        // The standing figure is a different question and still answers 100: that is what
        // alice would bring to a proposal nobody has voted on yet.
        assertEq(governor.weightFor(alice, GRANTS, new address[](0), path), 100);
    }

    // ── The entry point that names no domain ────────────────────────────────────────

    /// A stock `castVote` carries no params, so there is no way to read the register for
    /// the domain being voted on — not even to ask whether this account lent it away.
    /// An account with anything on loan is told to use the entry point that says.
    function test_RevertWhen_NoDomainIsNamedWhileWeightIsLent() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);
        uint256 id = _propose(GRANTS);

        vm.expectRevert(abi.encodeWithSelector(DomainVotes.DomainNotNamed.selector, alice));
        vm.prank(alice);
        governor.castVote(id, 1);
    }

    /// An account that has lent nothing has nothing to bypass, so the plain interface a
    /// stock front end calls keeps working.
    function test_PlainCastVote_WorksForAnAccountThatLentNothing() public {
        uint256 id = _propose(GRANTS);

        vm.prank(carol);
        assertEq(governor.castVote(id, 1), 100, "carol lent nothing and votes normally");
        assertEq(_forVotes(id), 100);

        // Including the guard against voting twice through that door.
        vm.expectRevert(abi.encodeWithSelector(IGovernor.GovernorAlreadyCastVote.selector, carol));
        vm.prank(carol);
        governor.castVote(id, 1);
    }

    /// Taking a lending back restores the plain interface, since there is again nothing
    /// the register could be hiding.
    function test_PlainCastVote_ComesBackWhenTheLendingDoes() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);
        vm.prank(alice);
        governor.delegateWeight(address(0), TREASURY, 0);

        uint256 id = _propose(GRANTS);
        vm.prank(alice);
        assertEq(governor.castVote(id, 1), 100);
    }

    /// The same double vote, tried through the door that names no domain. Taking the
    /// lending back clears the gate that sends a lender to the params entry point, so
    /// the ledger is the only thing left standing between alice and a second ballot.
    function test_PlainCastVote_RefusesAVoiceADelegateAlreadyCast() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);
        uint256 id = _propose(GRANTS);
        _voteFor(id, bob, _list(bob, alice));

        vm.prank(alice);
        governor.delegateWeight(address(0), TREASURY, 0);

        vm.expectRevert(abi.encodeWithSelector(IGovernor.GovernorAlreadyCastVote.selector, alice));
        vm.prank(alice);
        governor.castVote(id, 1);

        assertEq(_forVotes(id), 200, "still only what the two of them hold");
    }

    /// A vote that announces no path reaches grants made on the proposal's own domain,
    /// and no further — there is nothing to prove a parent relation with.
    function test_NoPath_SeesOnlyGrantsOnTheDomainItself() public {
        vm.prank(alice);
        governor.delegateWeight(bob, GRANTS, 100);
        vm.prank(carol);
        governor.delegateWeight(bob, TREASURY, 100);
        uint256 id = _propose(GRANTS);

        bytes32[] memory noPath = new bytes32[](0);
        vm.prank(bob);
        uint256 weight = governor.castVoteWithReasonAndParams(
            id, 1, "", _params(id, noPath, _list(alice, carol))
        );
        assertEq(weight, 200, "bob's own plus the grant on grants; carol's was on treasury");
    }

    /// A proposal nobody recorded a domain for falls back to stock OpenZeppelin: the
    /// register has no domain to be consulted about, so it stays out of the way.
    function test_UnscopedProposal_CountsPlainTokenWeight() public {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        targets[0] = address(governor);
        calldatas[0] = "";
        vm.prank(alice);
        uint256 id = governor.propose(targets, values, calldatas, "no domain recorded");
        vm.roll(block.number + governor.votingDelay() + 1);

        bytes32[] memory path = _path(GRANTS, TREASURY);
        assertEq(governor.weightOn(id, alice, new address[](0), path), 0, "weightOn needs a domain");
        assertEq(_voteFor(id, alice, new address[](0)), 100, "but the vote is OZ's own");
    }

    /// What the frontend reads to show a handover, since no balance moved to infer it from.
    function test_LendingOf_ReportsWhatWasLentAndToWhom() public {
        assertEq(_lendingDelegate(alice, TREASURY), address(0), "nothing lent yet");

        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 25);
        (address to_, uint256 amount_) = governor.lendingOf(alice, TREASURY);
        assertEq(to_, bob);
        assertEq(amount_, 25);
    }

    function _lendingDelegate(address delegator, bytes32 domainId) internal view returns (address to_) {
        (to_,) = governor.lendingOf(delegator, domainId);
    }

    // ── What a voter may not claim ───────────────────────────────────────────────────
    //
    // The announced path is supplied by whoever is voting and is therefore untrusted. It
    // is rechecked hop by hop against the graph here, exactly as the caveat enforcer
    // rechecks its own witness — otherwise naming a path would be enough to reach a grant
    // made on an unrelated domain.

    /// A path that does not start at the proposal's own domain proves nothing about it.
    function test_RevertWhen_ThePathStartsSomewhereElse() public {
        uint256 id = _propose(GRANTS);
        bytes32[] memory wrong = _path(COMMUNITY, TREASURY);

        vm.expectRevert(abi.encodeWithSelector(DomainVotes.DomainPathMismatch.selector, COMMUNITY, GRANTS));
        _voteFor2(id, bob, _only(alice), wrong);
    }

    /// A hop the graph does not carry is refused, so a voter cannot invent a parent to
    /// climb to a grant that was never meant to cover this proposal.
    function test_RevertWhen_ThePathClaimsAnEdgeTheGraphLacks() public {
        uint256 id = _propose(GRANTS);
        bytes32[] memory invented = _path(GRANTS, COMMUNITY);

        vm.expectRevert(abi.encodeWithSelector(DomainVotes.DomainPathBroken.selector, GRANTS, COMMUNITY));
        _voteFor2(id, bob, _only(alice), invented);
    }

    /// And the climb is capped, so a path cannot be padded until the reads cost more gas
    /// than a block holds.
    function test_RevertWhen_ThePathIsLongerThanTheCap() public {
        uint256 id = _propose(GRANTS);
        uint256 hops = governor.MAX_DOMAIN_PATH() + 1;
        bytes32[] memory tooLong = new bytes32[](hops);
        tooLong[0] = GRANTS;

        vm.expectRevert(abi.encodeWithSelector(DomainVotes.DomainPathTooLong.selector, hops));
        _voteFor2(id, bob, _only(alice), tooLong);
    }

    // ── What a lender may not do ─────────────────────────────────────────────────────

    /// A domain has one holder at a time, so weight cannot be moved out from under a
    /// delegate without taking it back first.
    function test_RevertWhen_ADomainIsLentTwice() public {
        vm.prank(alice);
        governor.delegateWeight(bob, TREASURY, 100);

        vm.expectRevert(abi.encodeWithSelector(DomainVotes.AlreadyDelegated.selector, alice, TREASURY, bob));
        vm.prank(alice);
        governor.delegateWeight(carol, TREASURY, 100);
    }

    /// Lending to yourself is not a lending.
    function test_RevertWhen_LendingToYourself() public {
        vm.expectRevert(abi.encodeWithSelector(DomainVotes.CircularDelegation.selector, alice, alice, TREASURY));
        vm.prank(alice);
        governor.delegateWeight(alice, TREASURY, 100);
    }

    /// @dev `_voteFor` with the path spelled out, for the cases that are about the path.
    function _voteFor2(uint256 proposalId, address voter, address[] memory principals, bytes32[] memory path)
        internal
        returns (uint256 weight_)
    {
        vm.prank(voter);
        weight_ = governor.castVoteWithReasonAndParams(proposalId, 1, "", _params(proposalId, path, principals));
    }
}
