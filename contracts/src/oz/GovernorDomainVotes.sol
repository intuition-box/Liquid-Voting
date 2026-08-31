// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Governor } from "@openzeppelin/contracts/governance/Governor.sol";
import { GovernorVotes } from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";

import { IDomainResolver } from "./IDomainResolver.sol";
import { IMultiVault } from "../interfaces/IMultiVault.sol";

/// @title GovernorDomainVotes
/// @notice Adds per-domain delegation to an OpenZeppelin Governor, without touching it.
/// @dev OpenZeppelin's own `delegate()` moves an account's entire weight to one delegate.
///      Delegating by *domain* is finer: A can hand the treasury to B and keep its vote on
///      everything else. That is what this module adds, and it adds it the way OZ intends
///      one to — by overriding `_getVotes`, which `Governor` declares virtual precisely so
///      a counting scheme can be substituted.
///
///      Nothing in the OpenZeppelin package is modified or copied. The audited code is
///      inherited as published; this contract is the extension point it exposes.
///
///      Two registers therefore coexist, and they answer different questions. The token
///      says how much weight an account holds — that stays OZ's, snapshot and all. This
///      register says who may exercise it on a given domain.
abstract contract GovernorDomainVotes is GovernorVotes {
    /// @notice MultiVault term classifier for a positive triple.
    uint8 internal constant VAULT_TYPE_TRIPLE = 1;
    /// @notice Longest domain path a voter may present.
    uint256 public constant MAX_DOMAIN_PATH = 6;

    /// @notice The graph this governor resolves sub-domain relations against.
    IMultiVault public immutable MULTI_VAULT;
    /// @notice Term id of the "is a sub-domain of" predicate.
    bytes32 public immutable SUB_DOMAIN_PREDICATE;
    /// @notice Where a proposal's domain is recorded, since OZ proposals carry no domain.
    IDomainResolver public immutable DOMAIN_RESOLVER;

    /// @notice The account delegated this domain away, so it cannot vote on it itself.
    error WeightDelegatedAway(address account, bytes32 domainId, address delegate);
    /// @notice This domain is already delegated; take it back before granting it elsewhere.
    error AlreadyDelegated(address delegator, bytes32 domainId, address delegate);
    /// @notice Delegating here would send the weight in a circle.
    error CircularDelegation(address delegator, address delegate, bytes32 domainId);
    /// @notice The domain path does not start at the proposal's own domain.
    error DomainPathMismatch(bytes32 pathStart, bytes32 domainId);
    /// @notice The domain path claims an edge the graph does not carry.
    error DomainPathBroken(bytes32 child, bytes32 parent);
    /// @notice The domain path exceeds the hop cap.
    error DomainPathTooLong(uint256 hops);

    /// @notice Emitted when an account hands its weight on a domain to someone else.
    event WeightDelegated(address indexed delegator, address indexed delegate, bytes32 indexed domainId);

    /// @dev Who an account handed its weight to, per domain. Zero means it kept it.
    mapping(address delegator => mapping(bytes32 domainId => address delegate)) private _delegatedTo;

    constructor(IMultiVault multiVault_, bytes32 subDomainPredicate_, IDomainResolver resolver_) {
        MULTI_VAULT = multiVault_;
        SUB_DOMAIN_PREDICATE = subDomainPredicate_;
        DOMAIN_RESOLVER = resolver_;
    }

    /// @notice Hands the caller's weight on one domain to another account.
    /// @dev A domain has one holder at a time: granting one already given reverts, so the
    ///      weight cannot be moved out from under a delegate silently. Passing the zero
    ///      address takes it back.
    function delegateWeight(address delegate, bytes32 domainId) external {
        address held_ = _delegatedTo[msg.sender][domainId];
        if (delegate != address(0) && held_ != address(0)) {
            revert AlreadyDelegated(msg.sender, domainId, held_);
        }
        if (delegate == msg.sender) revert CircularDelegation(msg.sender, delegate, domainId);
        _delegatedTo[msg.sender][domainId] = delegate;
        emit WeightDelegated(msg.sender, delegate, domainId);
    }

    /// @notice Who an account handed its weight to on a domain.
    function delegatedTo(address delegator, bytes32 domainId) public view returns (address delegate_) {
        delegate_ = _delegatedTo[delegator][domainId];
    }

    /// @dev The weight an account casts, given who delegated what on this proposal's domain.
    ///
    ///      `params` carries the domain path — the proposal's domain and its parents — and
    ///      the principals whose weight is being claimed. It reaches here untouched from
    ///      `castVoteWithReasonAndParams`, which is the channel OZ provides for a counting
    ///      scheme that needs more than an address and a timepoint.
    ///
    ///      The path is untrusted and verified hop by hop against the graph, exactly as the
    ///      caveat enforcer verifies its own witness. An unverified path would let a voter
    ///      claim a grant made on an unrelated domain.
    function _getVotes(
        address account,
        uint256 timepoint,
        bytes memory params
    ) internal view virtual override returns (uint256) {
        uint256 own_ = super._getVotes(account, timepoint, "");
        if (params.length == 0) return own_;

        (uint256 proposalId_, bytes32[] memory domainPath_, address[] memory principals_) =
            abi.decode(params, (uint256, bytes32[], address[]));

        bytes32 domainId_ = DOMAIN_RESOLVER.proposalDomain(proposalId_);
        if (domainId_ == bytes32(0)) return own_;

        _verifyPath(domainId_, domainPath_);
        bytes32[] memory domains_ = _domainsFor(domainId_, domainPath_);

        // Delegating transfers weight rather than copying it: an account that handed this
        // domain over casts nothing on it.
        address handedTo_ = _delegatedAny(account, domains_);
        if (handedTo_ != address(0)) revert WeightDelegatedAway(account, domainId_, handedTo_);

        uint256 total_ = own_;
        uint256 count_ = principals_.length;
        for (uint256 i_; i_ < count_; ++i_) {
            // Only weight actually routed to this account counts — the claim is checked,
            // not believed.
            if (_delegatedAny(principals_[i_], domains_) == account) {
                total_ += super._getVotes(principals_[i_], timepoint, "");
            }
        }
        return total_;
    }

    /// @dev The domain itself plus every parent on the verified path — a grant on any of
    ///      them reaches this proposal.
    function _domainsFor(bytes32 domainId, bytes32[] memory path) private pure returns (bytes32[] memory domains_) {
        if (path.length == 0) {
            domains_ = new bytes32[](1);
            domains_[0] = domainId;
            return domains_;
        }
        return path;
    }

    /// @dev Whether `account` handed any domain in `domains` away, and to whom.
    function _delegatedAny(address account, bytes32[] memory domains) private view returns (address delegate_) {
        uint256 count_ = domains.length;
        for (uint256 d_; d_ < count_; ++d_) {
            address to_ = _delegatedTo[account][domains[d_]];
            if (to_ != address(0)) return to_;
        }
        return address(0);
    }

    /// @dev Confirms `path` is a real chain of sub-domain edges, starting at the proposal's
    ///      domain. Each hop is checked against the MultiVault as the enforcer checks it:
    ///      the triple must exist as a positive assertion.
    function _verifyPath(bytes32 domainId, bytes32[] memory path) private view {
        uint256 hops_ = path.length;
        if (hops_ == 0) return;
        if (hops_ > MAX_DOMAIN_PATH) revert DomainPathTooLong(hops_);
        if (path[0] != domainId) revert DomainPathMismatch(path[0], domainId);

        for (uint256 i_; i_ + 1 < hops_; ++i_) {
            bytes32 tripleId_ = MULTI_VAULT.calculateTripleId(path[i_], SUB_DOMAIN_PREDICATE, path[i_ + 1]);
            try MULTI_VAULT.getVaultType(tripleId_) returns (uint8 vaultType_) {
                if (vaultType_ != VAULT_TYPE_TRIPLE) revert DomainPathBroken(path[i_], path[i_ + 1]);
            } catch {
                revert DomainPathBroken(path[i_], path[i_ + 1]);
            }
        }
    }
}
