// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

/// @title IDomainResolver
/// @notice Maps a proposal to the governance domain it is scoped to.
/// @dev The enforcer needs this because vote calldata carries a proposal id and nothing
///      else. Our DemoGovernor answers it from a field on the proposal; OpenZeppelin's
///      `propose(targets, values, calldatas, description)` has no such field, so the
///      association lives beside the governor instead of inside it.
///
///      Keeping it behind an interface is what lets one enforcer serve both: it is pinned
///      to a resolver at construction, not to a governor.
interface IDomainResolver {
    /// @notice The governance domain a proposal is scoped to.
    /// @param proposalId Id of the proposal, as the governor numbers it.
    /// @return domainId_ Term id of the proposal's domain, or zero when unknown.
    function proposalDomain(uint256 proposalId) external view returns (bytes32 domainId_);
}
