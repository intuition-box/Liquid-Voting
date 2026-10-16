// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { IDomainResolver } from "../interfaces/IDomainResolver.sol";

/// @title ProposalDomains
/// @notice Records which governance domain each proposal belongs to, for a governor that
///         has nowhere to keep it.
/// @dev Deployed alongside an unmodified OpenZeppelin `Governor`. The proposer records the
///      domain here using the id the governor assigned, and the caveat enforcer reads it
///      back at vote time.
///
///      A domain is written once and never changes: a proposal that could be re-scoped
///      after votes were cast would let anyone widen or narrow what a delegation covers
///      retroactively.
///
///      Only the governor may write, and it only lets a proposal's own proposer do so.
///      This used to be open to anyone, which write-once turned from a gap into a trap:
///      an OZ proposal id is `hashProposal(targets, values, calldatas, descriptionHash)`,
///      so it is known before the proposal is made, and recording a proposal takes two
///      transactions. Anybody could scope a proposal first — to a domain whose delegates
///      are not the ones it concerns — and the real proposer could never correct it. The
///      caveat would still check that domain against the graph, so it was never a way to
///      vote without authority; it was a way to choose the electorate, permanently.
contract ProposalDomains is IDomainResolver {
    /// @notice The proposal already has a domain, and a domain is written once.
    error DomainAlreadySet(uint256 proposalId, bytes32 domainId);
    /// @notice A proposal cannot be scoped to the zero domain.
    error ZeroDomain(uint256 proposalId);
    /// @notice Only the governor writes here, and only for a proposal's own proposer.
    error NotTheGovernor(address caller);
    /// @notice The governor is set once, by whoever deployed this.
    error AlreadyBound(address governor);
    /// @notice Only the deployer binds the governor.
    error NotTheInitializer(address caller);

    /// @notice Emitted when a proposal is scoped to a domain.
    event ProposalScoped(uint256 indexed proposalId, bytes32 indexed domainId, address indexed scopedBy);

    mapping(uint256 proposalId => bytes32 domainId) private _domains;

    /// @notice Who may bind the governor — the account that deployed this.
    address public immutable INITIALIZER;
    /// @notice The only account allowed to record a domain.
    /// @dev Not immutable, and it has to not be: the governor takes this resolver as a
    ///      constructor argument, so one of the two must exist first. The deployer binds
    ///      it immediately after, once and never again, which leaves no window anyone
    ///      else can use — unlike a `setGovernor` open to the first caller, which would
    ///      only have moved the race from scoping to binding.
    address public governor;

    constructor() {
        INITIALIZER = msg.sender;
    }

    /// @notice Names the governor that may record domains here. Once.
    function bindGovernor(address governor_) external {
        if (msg.sender != INITIALIZER) revert NotTheInitializer(msg.sender);
        if (governor != address(0)) revert AlreadyBound(governor);
        governor = governor_;
    }

    /// @notice Records the domain a proposal is scoped to.
    /// @dev Reachable only through the governor's own `scopeProposal`, which is what
    ///      checks that the caller is the proposal's proposer. The split is deliberate:
    ///      the governor is the only contract that knows who proposed what, and this one
    ///      is the only place with somewhere to keep a domain.
    /// @param proposalId Id of the proposal, as the governor assigned it.
    /// @param domainId Term id of the domain the proposal belongs to.
    function scopeProposal(uint256 proposalId, bytes32 domainId) external {
        if (msg.sender != governor) revert NotTheGovernor(msg.sender);
        if (domainId == bytes32(0)) revert ZeroDomain(proposalId);
        bytes32 existing_ = _domains[proposalId];
        if (existing_ != bytes32(0)) revert DomainAlreadySet(proposalId, existing_);
        _domains[proposalId] = domainId;
        emit ProposalScoped(proposalId, domainId, msg.sender);
    }

    /// @inheritdoc IDomainResolver
    function proposalDomain(uint256 proposalId) external view returns (bytes32 domainId_) {
        domainId_ = _domains[proposalId];
    }
}
