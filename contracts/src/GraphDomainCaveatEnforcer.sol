// SPDX-License-Identifier: MIT
// Pragma pinned to 0.8.23: the deployed Delegation Framework v1.3.0 pins this exact
// version in ICaveatEnforcer/Types and cannot satisfy the repo's ^0.8.24 rule (ADR 0006).
pragma solidity 0.8.23;

import { CaveatEnforcer } from "@delegation-framework/enforcers/CaveatEnforcer.sol";
import { ModeCode } from "@delegation-framework/utils/Types.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { ModeLib, CallType, ExecType, CALLTYPE_SINGLE, EXECTYPE_DEFAULT } from "@erc7579/lib/ModeLib.sol";

import { IMultiVault } from "./interfaces/IMultiVault.sol";

/// @notice The governor-side domain resolver: maps a proposal to the governance domain it
///         is scoped to. Vote entry points carry a proposal id rather than a domain, so
///         the enforcer reads the domain back from the governor before traversing.
interface IGovernorDomains {
    /// @notice The governance domain a proposal is scoped to.
    /// @param proposalId Sequential id of the proposal.
    /// @return domainId_ Term id of the proposal's domain.
    function proposalDomain(uint256 proposalId) external view returns (bytes32 domainId_);
}

/// @title GraphDomainCaveatEnforcer
/// @notice ERC-7710 caveat enforcer scoping a delegation to a governance *domain*,
///         where domain membership is resolved by verifying a redeemer-supplied path
///         witness hop-by-hop against the Intuition MultiVault (ADR 0003), and each
///         hop must additionally be attested by stake position (ADR 0004).
/// @dev Stateless: every check reads live MultiVault state, so extending the graph
///      (and staking) extends every delegation scoped above the new edge — no
///      redeploy, no re-signature. The enforcer never re-implements the vault's id
///      math: `calculateTripleId` is treated as an oracle-pure function of the vault.
contract GraphDomainCaveatEnforcer is CaveatEnforcer {
    using ModeLib for ModeCode;
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
    /// @notice The execution selector is not the delegated-vote selector.
    error InvalidSelector(bytes4 actual, bytes4 expected);
    /// @notice A vote execution did not carry a decodable proposal id and voter.
    error MalformedVoteCalldata(uint256 length);
    /// @notice The vote names a voter other than the account redeeming the delegation.
    error VoterIsNotRedeemer(address declared, address redeemer);
    /// @notice The governor could not resolve a domain for the proposal being voted on.
    error UnresolvedProposalDomain(uint256 proposalId);
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

    ////////////////////////////// State //////////////////////////////

    /// @notice MultiVault term classifier value for a positive triple (ADR 0005).
    uint8 internal constant VAULT_TYPE_TRIPLE = 1;

    /// @notice The Intuition MultiVault this enforcer reads graph state from.
    IMultiVault public immutable MULTI_VAULT;
    /// @notice The only execution target a scoped delegation may call.
    address public immutable GOVERNOR;
    /// @notice The only function selector a scoped delegation may invoke on the governor.
    /// @dev Voting is the only delegated action. Proposing needs no delegation — anyone
    ///      may propose in their own name — so it is deliberately outside this caveat.
    bytes4 public immutable VOTE_SELECTOR;

    ////////////////////////////// Constructor //////////////////////////////

    /// @notice Deploys the enforcer bound to one MultiVault and one governor endpoint.
    /// @param _multiVault The Intuition MultiVault (graph authority).
    /// @param _governor The governor contract votes must target.
    /// @param _voteSelector The delegated-vote selector on the governor.
    constructor(IMultiVault _multiVault, address _governor, bytes4 _voteSelector) {
        if (address(_multiVault) == address(0) || _governor == address(0)) revert ZeroAddress();
        MULTI_VAULT = _multiVault;
        GOVERNOR = _governor;
        VOTE_SELECTOR = _voteSelector;
    }

    ////////////////////////////// External functions //////////////////////////////

    /// @notice Verifies the domain-scope caveat for one delegation before its execution.
    /// @dev `beforeHook` (not `beforeAllHook`): this check is per-delegation — each level
    ///      of the chain carries its own terms and must be verified against its own
    ///      signer's scope, which is exactly the per-delegation hook. `beforeAllHook`
    ///      runs once per redemption and would collapse the per-level semantics that
    ///      make narrowing emergent (ADR 0007).
    ///
    ///      Order of operations (each step's failure carries a parameterized error):
    ///      1. only single default execution (batch and try modes revert);
    ///      2. expiry;
    ///      3. execution target + selector, then the proposal's domain id;
    ///      4. path witness shape (non-empty, hop count within `maxDepth` — this also
    ///         bounds the loop below, satisfying the bounded-loop rule);
    ///      5. path endpoints (`path[0]` = proposal domain, `path[end]` = root domain);
    ///      6. per hop: the computed triple id must classify as a positive triple
    ///         (`getVaultType == 1`; the vault REVERTS for never-created terms, which
    ///         the try/catch converts to `NotATriple` — and counter-triples return 2,
    ///         closing the `isTriple` trap, ADR 0005), and the attestor must hold a
    ///         position on it (ADR 0004). The default curve id is read live from
    ///         `getBondingCurveConfig()` — governance-configurable, never hardcoded.
    /// @param _terms abi-encoded `Terms` signed by the delegator.
    /// @param _args abi-encoded `bytes32[]` path witness supplied by the redeemer —
    ///        untrusted; every hop is verified against live MultiVault state.
    /// @param _mode Execution mode; only single default executions are allowed.
    /// @param _executionCalldata Encoded single execution (target, value, callData).
    /// @param _delegator The delegator of this delegation — the default attestor.
    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32,
        address _delegator,
        address _redeemer
    ) public view override {
        // 1. Reject anything that is not a single default execution.
        _validateMode(_mode);

        // 2. Terms + expiry.
        Terms memory terms_ = abi.decode(_terms, (Terms));
        if (terms_.expiry != 0 && block.timestamp > terms_.expiry) {
            revert DelegationExpired(terms_.expiry, block.timestamp);
        }

        // 3. Execution shape: target, selector, proposal domain.
        bytes32 domainId_ = _validateExecution(_executionCalldata, _redeemer);

        // 4–5. Witness shape + endpoints.
        bytes32[] memory path_ = _validatePath(_args, terms_.maxDepth, domainId_, terms_.rootDomainId);

        // Exact match: zero hops, nothing left to verify.
        if (path_.length == 1) return;

        // 6. Verify every hop against live vault state.
        _verifyHops(path_, terms_.predicateId, terms_.attestor == address(0) ? _delegator : terms_.attestor);
    }

    ////////////////////////////// Public functions //////////////////////////////

    /// @notice Decodes caveat terms bytes into the structured `Terms`.
    /// @param _terms abi-encoded `Terms`.
    /// @return terms_ The decoded terms.
    function getTermsInfo(bytes calldata _terms) public pure returns (Terms memory terms_) {
        terms_ = abi.decode(_terms, (Terms));
    }

    ////////////////////////////// Private functions //////////////////////////////

    /// @dev Step 1 — only single default executions; batch and try modes revert.
    function _validateMode(ModeCode _mode) private pure {
        (CallType callType_, ExecType execType_,,) = _mode.decode();
        if (!(callType_ == CALLTYPE_SINGLE) || !(execType_ == EXECTYPE_DEFAULT)) {
            revert NotSingleExecutionMode(_mode);
        }
    }

    /// @dev Step 3 — the execution must be a delegated vote on the bound governor. The
    ///      calldata carries a proposal id rather than a domain, so the domain is resolved
    ///      from the governor (`proposalDomain`). This is the resolver pattern a production
    ///      Governor requires for every entry point, since none of them carry a domain
    ///      field. The governor is immutable and bound at construction, so the resolver
    ///      cannot be swapped after a delegation is signed.
    function _validateExecution(bytes calldata _executionCalldata, address _redeemer)
        private
        view
        returns (bytes32 domainId_)
    {
        (address target_,, bytes calldata callData_) = ExecutionLib.decodeSingle(_executionCalldata);
        if (target_ != GOVERNOR) revert InvalidTarget(target_, GOVERNOR);
        // forge-lint: disable-next-line(unsafe-typecast) — selector extraction truncates by design
        bytes4 selector_ = bytes4(callData_);
        if (selector_ != VOTE_SELECTOR) revert InvalidSelector(selector_, VOTE_SELECTOR);
        domainId_ = _resolveVoteDomain(callData_, _redeemer);
    }

    /// @dev Vote path. Two things are established here.
    ///
    ///      **Who votes.** The framework executes from the root delegator's account, so
    ///      `msg.sender` at the governor is the principal, not the delegate. The delegate
    ///      names itself in the calldata's `voter` field, and this check binds that field
    ///      to `_redeemer` — the account the DelegationManager verified as the redeeming
    ///      delegate. The field cannot name anyone else, so a vote recorded for B is proof
    ///      that B redeemed.
    ///
    ///      **Which domain.** Vote calldata carries a proposal id, not a domain, so the
    ///      domain is read back from the governor. A proposal resolving to the zero domain
    ///      is rejected rather than treated as a wildcard.
    ///
    ///      Layout: selector(4) | proposalId(32) | support(32) | voter(32) | …
    function _resolveVoteDomain(bytes calldata _callData, address _redeemer) private view returns (bytes32 domainId_) {
        if (_callData.length < 100) revert MalformedVoteCalldata(_callData.length);
        address declaredVoter_ = address(uint160(uint256(bytes32(_callData[68:100]))));
        if (declaredVoter_ != _redeemer) revert VoterIsNotRedeemer(declaredVoter_, _redeemer);

        uint256 proposalId_ = uint256(bytes32(_callData[4:36]));
        domainId_ = IGovernorDomains(GOVERNOR).proposalDomain(proposalId_);
        if (domainId_ == bytes32(0)) revert UnresolvedProposalDomain(proposalId_);
    }

    /// @dev Steps 4–5 — witness shape (non-empty, hop count within the cap, which also
    ///      bounds the `_verifyHops` loop) and endpoint binding.
    function _validatePath(bytes calldata _args, uint8 _maxDepth, bytes32 _domainId, bytes32 _rootDomainId)
        private
        pure
        returns (bytes32[] memory path_)
    {
        path_ = abi.decode(_args, (bytes32[]));
        uint256 length_ = path_.length;
        if (length_ == 0) revert EmptyPath();
        if (length_ - 1 > _maxDepth) revert PathTooLong(length_ - 1, _maxDepth);
        if (path_[0] != _domainId) revert PathStartMismatch(path_[0], _domainId);
        if (path_[length_ - 1] != _rootDomainId) revert PathEndMismatch(path_[length_ - 1], _rootDomainId);
    }

    /// @dev Step 6 — every hop must exist as a positive triple (`getVaultType == 1`;
    ///      the vault reverts for never-created terms, converted to `NotATriple` by the
    ///      try/catch; counter-triples return 2 — ADR 0005) and carry the attestor's
    ///      stake (ADR 0004). The default curve id is read live (governance-configurable).
    function _verifyHops(bytes32[] memory _path, bytes32 _predicateId, address _attestor) private view {
        (, uint256 curveId_) = MULTI_VAULT.getBondingCurveConfig();
        uint256 hops_ = _path.length - 1;
        for (uint256 i_; i_ < hops_; ++i_) {
            bytes32 tripleId_ = MULTI_VAULT.calculateTripleId(_path[i_], _predicateId, _path[i_ + 1]);
            try MULTI_VAULT.getVaultType(tripleId_) returns (uint8 vaultType_) {
                if (vaultType_ != VAULT_TYPE_TRIPLE) revert NotATriple(tripleId_);
            } catch {
                revert NotATriple(tripleId_);
            }
            if (MULTI_VAULT.getShares(_attestor, tripleId_, curveId_) == 0) {
                revert NotAttested(tripleId_, _attestor);
            }
        }
    }
}
