// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Governor } from "@openzeppelin/contracts/governance/Governor.sol";
import { GovernorVotes } from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";

import { IDomainResolver } from "../interfaces/IDomainResolver.sol";
import { IMultiVault } from "../interfaces/IMultiVault.sol";

/// @title DomainVotes
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
abstract contract DomainVotes is GovernorVotes {
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

    /// @notice Whether weight is read at the proposal's snapshot or at the current block.
    /// @dev OpenZeppelin reads an account's balance as it stood when the proposal was
    ///      created. That is what makes a flash loan pointless: the past balance is already
    ///      written, so borrowing now cannot change it.
    ///
    ///      It also means weight moved after a proposal opened does not count on it, which
    ///      is wrong for delegation that is meant to take effect immediately. Set false and
    ///      weight is read live, so handing a domain over applies to proposals already
    ///      open. Fixed at construction: a governor that could switch this mid-life would
    ///      let anyone change the rules under a vote in progress.
    bool public immutable SNAPSHOT_WEIGHT;

    /// @notice The account delegated this domain away, so it cannot vote on it itself.
    error WeightDelegatedAway(address account, bytes32 domainId, address delegate);
    /// @notice This domain is already delegated; take it back before granting it elsewhere.
    error AlreadyDelegated(address delegator, bytes32 domainId, address delegate);
    /// @notice Delegating here would send the weight in a circle.
    error CircularDelegation(address delegator, address delegate, bytes32 domainId);
    /// @notice More weight was lent than the account holds.
    error AmountExceedsBalance(address delegator, uint256 amount, uint256 balance);
    /// @notice A delegation of nothing is not a delegation.
    error ZeroAmount(address delegator, bytes32 domainId);
    /// @notice The domain path does not start at the proposal's own domain.
    error DomainPathMismatch(bytes32 pathStart, bytes32 domainId);
    /// @notice The domain path claims an edge the graph does not carry.
    error DomainPathBroken(bytes32 child, bytes32 parent);
    /// @notice The domain path exceeds the hop cap.
    error DomainPathTooLong(uint256 hops);

    /// @notice Emitted when an account hands weight on a domain to someone else.
    /// @param amount How much was lent. Zero on a withdrawal.
    event WeightDelegated(
        address indexed delegator, address indexed delegate, bytes32 indexed domainId, uint256 amount
    );

    /// @dev A lending: who holds the weight, and how much of it.
    struct Lending {
        address delegate;
        uint256 amount;
    }

    /// @dev What an account lent on a domain, and to whom. A zero delegate means it kept
    ///      everything.
    mapping(address delegator => mapping(bytes32 domainId => Lending)) private _lent;

    constructor(
        IMultiVault multiVault_,
        bytes32 subDomainPredicate_,
        IDomainResolver resolver_,
        bool snapshotWeight_
    ) {
        MULTI_VAULT = multiVault_;
        SUB_DOMAIN_PREDICATE = subDomainPredicate_;
        DOMAIN_RESOLVER = resolver_;
        SNAPSHOT_WEIGHT = snapshotWeight_;
    }

    /// @dev The timepoint weight is read at. The proposal's snapshot when that is what the
    ///      deployment wants, otherwise the last completed block, which is the most recent
    ///      one the token can answer for.
    function _weightAt(uint256 snapshot) private view returns (uint256) {
        return SNAPSHOT_WEIGHT ? snapshot : clock() - 1;
    }

    /// @notice Hands part of the caller's weight on one domain to another account.
    /// @dev A domain has one holder at a time: granting one already given reverts, so the
    ///      weight cannot be moved out from under a delegate silently. Passing the zero
    ///      address takes it back.
    ///
    ///      The amount is checked against the balance when it is lent, and again when a
    ///      vote is counted. Both matter: the first refuses an obvious mistake at the
    ///      moment someone makes it, and the second is what actually binds, since a
    ///      balance can fall after a delegation is signed and a promise of weight nobody
    ///      holds any more must not be honoured.
    /// @param delegate Who receives the weight. Zero takes the whole lending back.
    /// @param domainId The domain being lent.
    /// @param amount How much weight to lend.
    function delegateWeight(address delegate, bytes32 domainId, uint256 amount) external {
        Lending memory held_ = _lent[msg.sender][domainId];
        if (delegate == address(0)) {
            delete _lent[msg.sender][domainId];
            emit WeightDelegated(msg.sender, address(0), domainId, 0);
            return;
        }
        if (held_.delegate != address(0)) revert AlreadyDelegated(msg.sender, domainId, held_.delegate);
        if (delegate == msg.sender) revert CircularDelegation(msg.sender, delegate, domainId);
        if (amount == 0) revert ZeroAmount(msg.sender, domainId);

        uint256 balance_ = super._getVotes(msg.sender, clock() - 1, "");
        if (amount > balance_) revert AmountExceedsBalance(msg.sender, amount, balance_);

        _lent[msg.sender][domainId] = Lending(delegate, amount);
        emit WeightDelegated(msg.sender, delegate, domainId, amount);
    }

    /// @notice The weight an account would cast on a domain, given who delegated to whom.
    /// @dev What the UI displays, read from the same state the vote path enforces. Zero
    ///      once the account has handed the domain away; otherwise its own weight plus
    ///      every principal whose weight routes to it.
    /// @param account The prospective voter.
    /// @param domainId The domain in question.
    /// @param principals The accounts the voter would name.
    /// @param domainPath The domain and its parents, verified against the graph.
    function weightFor(
        address account,
        bytes32 domainId,
        address[] calldata principals,
        bytes32[] calldata domainPath
    ) external view returns (uint256 weight_) {
        _verifyPath(domainId, domainPath);
        bytes32[] memory domains_ = _domainsFor(domainId, domainPath);
        // The last completed block, which is the most recent one the token can answer
        // for. A display never asks about a proposal, so there is no snapshot to honour.
        uint256 at_ = clock() - 1;
        weight_ = _keptBy(account, domains_, at_);
        uint256 count_ = principals.length;
        for (uint256 i_; i_ < count_; ++i_) {
            weight_ += _lentTo(principals[i_], account, domains_, at_);
        }
    }

    /// @notice Who an account handed weight to on a domain.
    function delegatedTo(address delegator, bytes32 domainId) public view returns (address delegate_) {
        delegate_ = _lent[delegator][domainId].delegate;
    }

    /// @notice What an account lent on a domain, and to whom.
    /// @dev A display cannot work this out from balances any more: since a lending can be
    ///      partial, the difference between what someone holds and what they cast says
    ///      nothing about how much they lent. This is the only honest source.
    /// @param delegator The account that lent.
    /// @param domainId The domain it lent on.
    /// @return delegate_ Who holds it. Zero if nothing was lent.
    /// @return amount_ How much was lent, uncapped by the current balance.
    function lendingOf(address delegator, bytes32 domainId)
        external
        view
        returns (address delegate_, uint256 amount_)
    {
        Lending memory held_ = _lent[delegator][domainId];
        return (held_.delegate, held_.amount);
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
        uint256 at_ = _weightAt(timepoint);
        uint256 own_ = super._getVotes(account, at_, "");
        if (params.length == 0) return own_;

        (uint256 proposalId_, bytes32[] memory domainPath_, address[] memory principals_) =
            abi.decode(params, (uint256, bytes32[], address[]));

        bytes32 domainId_ = DOMAIN_RESOLVER.proposalDomain(proposalId_);
        if (domainId_ == bytes32(0)) return own_;

        _verifyPath(domainId_, domainPath_);
        bytes32[] memory domains_ = _domainsFor(domainId_, domainPath_);

        // Lending moves weight rather than copying it: what an account lent here is gone
        // from its own vote, and what it kept is still its own to cast.
        uint256 total_ = _keptBy(account, domains_, at_);
        uint256 count_ = principals_.length;
        for (uint256 i_; i_ < count_; ++i_) {
            // Only weight actually routed to this account counts — the claim is checked,
            // not believed.
            total_ += _lentTo(principals_[i_], account, domains_, at_);
        }
        return total_;
    }

    /// @dev What an account may still cast itself: its balance, less anything it lent on
    ///      this domain. A lending larger than the balance it is drawn against takes the
    ///      whole balance and no more, which is what keeps the two sides adding up when a
    ///      balance falls after the delegation was made.
    function _keptBy(address account, bytes32[] memory domains, uint256 at) private view returns (uint256) {
        uint256 own_ = super._getVotes(account, at, "");
        (, uint256 lent_) = _lentAny(account, domains);
        return lent_ >= own_ ? 0 : own_ - lent_;
    }

    /// @dev What `principal` lent to `account` on this domain, capped at what the
    ///      principal actually holds. Zero if the lending went to somebody else.
    function _lentTo(
        address principal,
        address account,
        bytes32[] memory domains,
        uint256 at
    ) private view returns (uint256) {
        (address to_, uint256 amount_) = _lentAny(principal, domains);
        if (to_ != account) return 0;
        uint256 balance_ = super._getVotes(principal, at, "");
        return amount_ > balance_ ? balance_ : amount_;
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
    function _lentAny(address account, bytes32[] memory domains)
        private
        view
        returns (address delegate_, uint256 amount_)
    {
        uint256 count_ = domains.length;
        for (uint256 d_; d_ < count_; ++d_) {
            Lending memory held_ = _lent[account][domains[d_]];
            if (held_.delegate != address(0)) return (held_.delegate, held_.amount);
        }
        return (address(0), 0);
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
