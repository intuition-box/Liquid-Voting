// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

/// @title MockGovernor
/// @notice Minimal proposal recorder for the POC — the bounty explicitly allows a mock;
///         there is no voting logic. Proposals carry the domain id the delegation-chain
///         caveats are checked against.
contract MockGovernor {
    ////////////////////////////// Custom errors //////////////////////////////

    /// @notice The requested proposal id does not exist.
    error ProposalNotFound(uint256 proposalId);

    ////////////////////////////// Events //////////////////////////////

    /// @notice Emitted for every recorded proposal.
    /// @param proposalId Sequential id of the proposal.
    /// @param domainId Term id of the governance domain the proposal claims.
    /// @param proposer The address the proposal was executed from (the root delegator
    ///        when submitted through a delegation chain).
    /// @param description Free-text description (not indexed).
    event ProposalCreated(uint256 indexed proposalId, bytes32 indexed domainId, address indexed proposer, string description);

    ////////////////////////////// Types / state //////////////////////////////

    /// @notice A recorded proposal.
    struct Proposal {
        bytes32 domainId;
        address proposer;
        string description;
    }

    Proposal[] private _proposals;

    ////////////////////////////// External functions //////////////////////////////

    /// @notice Records a proposal scoped to a governance domain.
    /// @param domainId Term id of the domain atom this proposal belongs to.
    /// @param description Human-readable proposal text.
    /// @return proposalId Sequential id of the recorded proposal.
    function propose(bytes32 domainId, string calldata description) external returns (uint256 proposalId) {
        proposalId = _proposals.length;
        _proposals.push(Proposal({ domainId: domainId, proposer: msg.sender, description: description }));
        emit ProposalCreated(proposalId, domainId, msg.sender, description);
    }

    /// @notice Number of recorded proposals.
    /// @return count_ The proposal count.
    function proposalCount() external view returns (uint256 count_) {
        count_ = _proposals.length;
    }

    /// @notice Reads a recorded proposal.
    /// @param proposalId Sequential id of the proposal.
    /// @return proposal_ The stored proposal.
    function getProposal(uint256 proposalId) external view returns (Proposal memory proposal_) {
        if (proposalId >= _proposals.length) revert ProposalNotFound(proposalId);
        proposal_ = _proposals[proposalId];
    }
}
