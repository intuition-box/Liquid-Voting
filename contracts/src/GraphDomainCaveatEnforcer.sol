// SPDX-License-Identifier: MIT
// Pragma pinned to 0.8.23: the deployed Delegation Framework v1.3.0 pins this exact
// version in ICaveatEnforcer/Types and cannot satisfy the repo's ^0.8.24 rule (ADR 0006).
pragma solidity 0.8.23;

import { CaveatEnforcer } from "@delegation-framework/enforcers/CaveatEnforcer.sol";
import { ModeCode } from "@delegation-framework/utils/Types.sol";

import { IMultiVault } from "./interfaces/IMultiVault.sol";

/// @title GraphDomainCaveatEnforcer
/// @notice ERC-7710 caveat enforcer scoping a delegation to a governance *domain*,
///         where domain membership is resolved by verifying a redeemer-supplied path
///         witness hop-by-hop against the Intuition MultiVault (ADR 0003), and each
///         hop must additionally be attested by stake position (ADR 0004).
/// @dev PHASE 0 SKELETON — declares the full external shape (terms, args, errors,
///      constructor) so the test suite compiles and runs red; `beforeHook` reverts
///      `NotImplemented` until Phase 1.
contract GraphDomainCaveatEnforcer is CaveatEnforcer {
    ////////////////////////////// Types //////////////////////////////

    /// @notice Signed caveat terms — immutable once the delegation is signed.
    /// @param rootDomainId The delegation's domain scope (term id of the root domain atom).
    /// @param predicateId Term id of the edge predicate (e.g. "is a sub-domain of").
    /// @param maxDepth Maximum number of hops allowed in the path witness.
    /// @param expiry Unix timestamp after which the delegation is dead; 0 = no expiry.
    /// @param attestor Whose stake attests each hop; address(0) resolves to `_delegator`
    ///        at hook time (the liquid-democracy default — ADR 0004).
    struct Terms {
        bytes32 rootDomainId;
        bytes32 predicateId;
        uint8 maxDepth;
        uint64 expiry;
        address attestor;
    }

    ////////////////////////////// Custom errors //////////////////////////////

    /// @notice The execution mode is not a single default execution (batch and try modes are rejected).
    error NotSingleExecutionMode(ModeCode mode);
    /// @notice The delegation's expiry has passed.
    error DelegationExpired(uint64 expiry, uint256 currentTimestamp);
    /// @notice The execution target is not the allowed governor.
    error InvalidTarget(address actual, address expected);
    /// @notice The execution selector is not the allowed propose selector.
    error InvalidSelector(bytes4 actual, bytes4 expected);
    /// @notice The path witness is empty.
    error EmptyPath();
    /// @notice The path witness exceeds the hop cap.
    error PathTooLong(uint256 hops, uint8 maxDepth);
    /// @notice path[0] does not match the proposal's domain.
    error PathStartMismatch(bytes32 pathStart, bytes32 proposalDomain);
    /// @notice path[end] does not match the delegation's root domain.
    error PathEndMismatch(bytes32 pathEnd, bytes32 rootDomainId);
    /// @notice The computed hop id is not a positive triple (missing, an atom, or a
    ///         counter-triple — ADR 0005: `getVaultType == 1`, never `isTriple`).
    error NotATriple(bytes32 tripleId);
    /// @notice The attestor holds no position on the hop triple (ADR 0004).
    error NotAttested(bytes32 tripleId, address attestor);
    /// @notice Constructor argument was zero.
    error ZeroAddress();
    /// @notice Phase 0 placeholder — removed by the Phase 1 implementation.
    error NotImplemented();

    ////////////////////////////// State //////////////////////////////

    /// @notice The Intuition MultiVault this enforcer reads graph state from.
    IMultiVault public immutable MULTI_VAULT;
    /// @notice The only execution target a scoped delegation may call.
    address public immutable GOVERNOR;
    /// @notice The only function selector a scoped delegation may invoke on the governor.
    bytes4 public immutable ALLOWED_SELECTOR;

    ////////////////////////////// Constructor //////////////////////////////

    /// @notice Deploys the enforcer bound to one MultiVault and one governor endpoint.
    /// @param _multiVault The Intuition MultiVault (graph authority).
    /// @param _governor The governor contract proposals must target.
    /// @param _allowedSelector The propose function selector on the governor.
    constructor(IMultiVault _multiVault, address _governor, bytes4 _allowedSelector) {
        if (address(_multiVault) == address(0) || _governor == address(0)) revert ZeroAddress();
        MULTI_VAULT = _multiVault;
        GOVERNOR = _governor;
        ALLOWED_SELECTOR = _allowedSelector;
    }

    ////////////////////////////// External functions //////////////////////////////

    /// @notice Verifies the domain-scope caveat for one delegation before its execution.
    /// @dev `beforeHook` (not `beforeAllHook`): this check is per-delegation — each level
    ///      of the chain carries its own terms and must be verified against its own
    ///      signer's scope, which is exactly the per-delegation hook. `beforeAllHook`
    ///      runs once per redemption and would collapse the per-level semantics that
    ///      make narrowing emergent (ADR 0007).
    /// @param _terms abi-encoded `Terms` signed by the delegator.
    /// @param _args abi-encoded `bytes32[]` path witness supplied by the redeemer —
    ///        untrusted; every hop is verified against live MultiVault state.
    /// @param _mode Execution mode; only single default executions are allowed.
    /// @param _executionCalldata Encoded single execution (target, value, callData).
    /// @param _delegationHash Hash of the delegation being redeemed (unused).
    /// @param _delegator The delegator of this delegation — the default attestor.
    /// @param _redeemer The redeeming address (unused; authority comes from the chain).
    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) public override {
        _terms;
        _args;
        _mode;
        _executionCalldata;
        _delegationHash;
        _delegator;
        _redeemer;
        revert NotImplemented();
    }

    ////////////////////////////// Public functions //////////////////////////////

    /// @notice Decodes caveat terms bytes into the structured `Terms`.
    /// @param _terms abi-encoded `Terms`.
    /// @return terms_ The decoded terms.
    function getTermsInfo(bytes calldata _terms) public pure returns (Terms memory terms_) {
        terms_ = abi.decode(_terms, (Terms));
    }
}
