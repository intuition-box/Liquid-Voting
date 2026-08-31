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
contract ProposalDomains is IDomainResolver {
    /// @notice The proposal already has a domain, and a domain is written once.
    error DomainAlreadySet(uint256 proposalId, bytes32 domainId);
    /// @notice A proposal cannot be scoped to the zero domain.
    error ZeroDomain(uint256 proposalId);

    /// @notice Emitted when a proposal is scoped to a domain.
    event ProposalScoped(uint256 indexed proposalId, bytes32 indexed domainId, address indexed scopedBy);

    mapping(uint256 proposalId => bytes32 domainId) private _domains;

    /// @notice Records the domain a proposal is scoped to.
    /// @dev Permissionless, like proposing itself. What a delegate may do with the domain
    ///      is the caveat's question, and the caveat verifies it against the graph rather
    ///      than trusting whoever wrote here.
    /// @param proposalId Id of the proposal, as the governor assigned it.
    /// @param domainId Term id of the domain the proposal belongs to.
    function scopeProposal(uint256 proposalId, bytes32 domainId) external {
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
