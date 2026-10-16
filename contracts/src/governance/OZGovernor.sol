// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Governor } from "@openzeppelin/contracts/governance/Governor.sol";
import { GovernorCountingSimple } from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import { GovernorSettings } from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import { GovernorVotes } from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";

import { DomainVotes } from "./DomainVotes.sol";
import { IDomainResolver } from "../interfaces/IDomainResolver.sol";

/// @notice The resolver's write side, kept out of `IDomainResolver` on purpose.
/// @dev `IDomainResolver` is what the enforcer is pinned to, and the enforcer only ever
///      reads. A resolver that answered `proposalDomain` from a field on its own
///      proposals would have nothing to implement here, so widening the read interface
///      would make every implementer carry a writer it does not want.
interface IProposalScoper {
    function scopeProposal(uint256 proposalId, bytes32 domainId) external;
}
import { IMultiVault } from "../interfaces/IMultiVault.sol";

/// @title OZGovernor
/// @notice A stock OpenZeppelin Governor that also honours per-domain delegation.
/// @dev Everything a DAO already expects is inherited unmodified: the proposal lifecycle,
///      For/Against/Abstain counting, the settings module, and `GovernorVotes` reading an
///      `ERC20Votes` snapshot — audited code, deployed at scale, taken as published.
///
///      Two things are added, and neither touches the inherited code. `_getVotes` is
///      overridden, which `Governor` declares virtual for exactly this purpose, so weight
///      still comes from the token and the domain register only decides who may exercise it
///      where. And `castVoteFor` is added, because OZ's public entry points read the voter
///      from `_msgSender()` while an ERC-7710 redemption executes from the root delegator's
///      account: without it a delegated vote would be recorded under the wrong name. It
///      hands the voter to OZ's own internal `_castVote`, so the state check, the counting,
///      the double-vote guard and the event are all the audited ones.
///
///      The domain of a proposal lives in a `ProposalDomains` beside this contract rather
///      than on the proposal, because OZ's `propose` has no field for it and adding one
///      would mean forking the audited contract.
contract OZGovernor is GovernorSettings, GovernorCountingSimple, DomainVotes {
    /// @notice A vote was asked to be recorded under nobody.
    error ZeroAddress();
    /// @notice Only a proposal's own proposer may say which domain it belongs to.
    error NotTheProposer(address caller, address proposer);

    /// @param token_ The `ERC20Votes` token weight is read from.
    /// @param multiVault_ The Intuition MultiVault (graph authority).
    /// @param subDomainPredicate_ Term id of the "is a sub-domain of" predicate.
    /// @param resolver_ Where each proposal's domain is recorded.
    /// @param snapshotWeight_ True to read weight at the proposal's snapshot, as stock
    ///        OpenZeppelin does; false to read it live, so a delegation made after a
    ///        proposal opened still counts on it.
    constructor(
        IVotes token_,
        IMultiVault multiVault_,
        bytes32 subDomainPredicate_,
        IDomainResolver resolver_,
        bool snapshotWeight_
    )
        Governor("OZGovernor")
        GovernorSettings(1, 30_000, 0)
        GovernorVotes(token_)
        DomainVotes(multiVault_, subDomainPredicate_, resolver_, snapshotWeight_)
    { }

    /// @inheritdoc Governor
    function quorum(uint256) public pure override returns (uint256) {
        return 1;
    }

    /// @notice Cast a vote on behalf of `voter`, for a delegation being redeemed.
    /// @dev The public `castVote*` family reads the voter from `_msgSender()`, which under
    ///      ERC-7710 is the root delegator's account rather than the delegate doing the
    ///      voting. This entry point takes the voter explicitly so the vote is recorded
    ///      under the delegate's own name, carrying the principals it was lent.
    ///
    ///      Authorization is this function's job, which it did not used to do. The claim
    ///      here was that it is "reachable only through a delegation whose caveat has
    ///      already been enforced" — and that was simply untrue. It is an ordinary
    ///      external function: a direct call never touches the DelegationManager, so
    ///      `GraphDomainScope`'s `voter == redeemer` check never runs. Any address could
    ///      name any holder and spend its whole weight, in whichever direction it chose,
    ///      and the holder could then never vote on that proposal. Proven against the
    ///      deployed governor from an address holding nothing.
    ///
    ///      The caveat still does the work it is for — proving the proposal's domain sits
    ///      under the delegated one — but it cannot be the only thing standing here, so
    ///      the governor asks the register the question it can answer on its own: has the
    ///      caller routed its weight to this voter? That is true of every legitimate
    ///      redemption, which reaches the governor from the root delegator's account, and
    ///      false for anybody else.
    /// @param proposalId The proposal being voted on.
    /// @param support Against, For or Abstain, as `GovernorCountingSimple` defines them.
    /// @param voter The account the vote is recorded under.
    /// @param principals The accounts whose weight is being carried, the caller included.
    /// @param domainPath Child to ancestor, the path `DomainVotes` rechecks hop by hop.
    /// @return weight_ The weight counted for this vote.
    function castVoteFor(
        uint256 proposalId,
        uint8 support,
        address voter,
        address[] calldata principals,
        bytes32[] calldata domainPath
    ) external returns (uint256 weight_) {
        if (voter == address(0)) revert ZeroAddress();
        if (!_mayVoteFor(msg.sender, voter, proposalId, domainPath)) {
            revert NotEntitledToVoteFor(msg.sender, voter);
        }
        bytes memory params_ = abi.encode(proposalId, domainPath, principals);
        weight_ = _castVote(proposalId, voter, support, "", params_);
    }

    /// @notice Records which domain a proposal belongs to. Its proposer only, once.
    /// @dev The resolver holds the mapping and this holds the authorization, because only
    ///      the governor knows who proposed what. The resolver's writer used to be anyone
    ///      at all: ids are derived from the proposal's own contents, so they are known
    ///      before the proposal exists, and scoping is a second transaction after
    ///      `propose`. A watcher could scope first, write-once would make it permanent,
    ///      and the proposal would be decided by the delegates of a domain it has nothing
    ///      to do with.
    ///
    ///      `proposalProposer` returns the zero address for a proposal that was never
    ///      made, and `msg.sender` cannot be zero, so this also refuses to scope ahead of
    ///      a proposal rather than merely refusing the wrong caller.
    /// @param proposalId Id of the proposal, as `propose` returned it.
    /// @param domainId Term id of the domain the proposal belongs to.
    function scopeProposal(uint256 proposalId, bytes32 domainId) external {
        address proposer_ = proposalProposer(proposalId);
        if (msg.sender != proposer_) revert NotTheProposer(msg.sender, proposer_);
        IProposalScoper(address(DOMAIN_RESOLVER)).scopeProposal(proposalId, domainId);
    }

    // ── Overrides required because two inherited modules declare the same member ──

    function votingDelay() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    function _getVotes(
        address account,
        uint256 timepoint,
        bytes memory params
    ) internal view override(Governor, DomainVotes) returns (uint256) {
        return super._getVotes(account, timepoint, params);
    }

    /// @dev OZ tallies the vote, then `DomainVotes` says whose voices it just spent —
    ///      and refuses the ones already on the ballot, which rolls the tally back.
    function _countVote(
        uint256 proposalId,
        address account,
        uint8 support,
        uint256 weight,
        bytes memory params
    ) internal override(Governor, GovernorCountingSimple) {
        super._countVote(proposalId, account, support, weight, params);
        _spendVoices(proposalId, account, weight, params);
    }

}
