// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Governor } from "@openzeppelin/contracts/governance/Governor.sol";
import { GovernorCountingSimple } from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import { GovernorSettings } from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import { GovernorVotes } from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";

import { GovernorDomainVotes } from "./GovernorDomainVotes.sol";
import { IDomainResolver } from "./IDomainResolver.sol";
import { IMultiVault } from "../interfaces/IMultiVault.sol";

/// @title DomainScopedGovernor
/// @notice A stock OpenZeppelin Governor that also honours per-domain delegation.
/// @dev Everything a DAO already expects is inherited unmodified: the proposal lifecycle,
///      For/Against/Abstain counting, the settings module, and `GovernorVotes` reading an
///      `ERC20Votes` snapshot — audited code, deployed at scale, taken as published.
///
///      One method is overridden, `_getVotes`, which `Governor` declares virtual for this
///      purpose. That is the whole integration: weight still comes from the token, and the
///      domain register decides who may exercise it where.
///
///      The domain of a proposal lives in a `DomainResolver` beside this contract rather
///      than on the proposal, because OZ's `propose` has no field for it and adding one
///      would mean forking the audited contract.
contract DomainScopedGovernor is GovernorSettings, GovernorCountingSimple, GovernorDomainVotes {
    /// @param token_ The `ERC20Votes` token weight is read from.
    /// @param multiVault_ The Intuition MultiVault (graph authority).
    /// @param subDomainPredicate_ Term id of the "is a sub-domain of" predicate.
    /// @param resolver_ Where each proposal's domain is recorded.
    constructor(
        IVotes token_,
        IMultiVault multiVault_,
        bytes32 subDomainPredicate_,
        IDomainResolver resolver_
    )
        Governor("DomainScopedGovernor")
        GovernorSettings(1, 30_000, 0)
        GovernorVotes(token_)
        GovernorDomainVotes(multiVault_, subDomainPredicate_, resolver_)
    { }

    /// @inheritdoc Governor
    function quorum(uint256) public pure override returns (uint256) {
        return 1;
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
    ) internal view override(Governor, GovernorDomainVotes) returns (uint256) {
        return super._getVotes(account, timepoint, params);
    }
}
