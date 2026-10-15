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
///
///      Keeping them apart is what costs something. In stock OpenZeppelin a delegation
///      moves the token's own checkpoint, so an account that has delegated simply has no
///      weight left to cast and double counting is arithmetically impossible. Here the
///      weight never moves, so nothing in the token notices that a voice has been spent.
///      That bookkeeping has to be done here instead, and `_spent` is where it lives.
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
    /// @notice This account has weight on loan, so it must say which domain it is voting on.
    error DomainNotNamed(address account);

    /// @notice Emitted when an account hands weight on a domain to someone else.
    /// @param amount How much was lent. Zero on a withdrawal.
    event WeightDelegated(
        address indexed delegator, address indexed delegate, bytes32 indexed domainId, uint256 amount
    );

    /// @notice Emitted once per voice a vote carried, the voter's own included.
    /// @dev The whole proposition of delegating by domain is that a delegator stays
    ///      accountable for what was done with its voice, and that is only true if the
    ///      chain says so in a way anyone can read back. OZ's `VoteCast` indexes the
    ///      account that *submitted* the vote, so asking "what was cast in my name?"
    ///      meant fetching every vote ever cast and decoding its params. Indexing the
    ///      principal turns that question into one filtered query.
    /// @param proposalId The proposal voted on.
    /// @param principal Whose voice this share of the vote was.
    /// @param voter Who carried it to the governor. The principal itself when it voted
    ///        for itself.
    /// @param weight How much that voice counted for.
    event VoteCastOnBehalf(
        uint256 indexed proposalId, address indexed principal, address indexed voter, uint256 weight
    );

    /// @dev A lending: who holds the weight, and how much of it.
    struct Lending {
        address delegate;
        uint256 amount;
    }

    /// @dev What an account lent on a domain, and to whom. A zero delegate means it kept
    ///      everything.
    mapping(address delegator => mapping(bytes32 domainId => Lending)) private _lent;

    /// @dev How much of each account's weight is already on a proposal's ballot, whoever
    ///      put it there.
    ///
    ///      OpenZeppelin's double-vote guard is keyed on the account that submits a vote,
    ///      which is all stock OZ needs: delegating moves the token checkpoint, so a
    ///      delegator has nothing left to cast. A lending here leaves the checkpoint
    ///      alone, so without this ledger a delegator could take its domain back after
    ///      the delegate had voted and cast the same weight a second time — the register
    ///      would say it kept everything, and the token would agree. That is the 300 out
    ///      of 200 the demo produced.
    ///
    ///      An amount rather than a flag, because a lending can be partial: a lender who
    ///      handed over a quarter of its weight has three quarters left to cast itself,
    ///      and a flag would silence it. The invariant this maintains is the one that
    ///      matters — across a whole proposal, no more weight is ever counted in an
    ///      account's name than it holds.
    mapping(uint256 proposalId => mapping(address principal => uint256 weight)) private _cast;

    /// @dev How many domains an account currently has on loan.
    ///
    ///      A stock `castVote` names no domain, so there is no way to read the register
    ///      for the one being voted on — not even to ask whether this account lent it
    ///      away. Rather than let that entry point quietly bypass the register, an
    ///      account with anything on loan must vote through the params path and say which
    ///      domain it means. An account that has lent nothing has nothing to bypass, so
    ///      it keeps the plain interface a stock front end like Tally calls.
    mapping(address delegator => uint256 count) private _lendingCount;

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
    ///
    ///      Taking a lending back does not un-cast a vote the delegate already made with
    ///      it. `_spent` holds that line; see `_countVote`.
    /// @param delegate Who receives the weight. Zero takes the whole lending back.
    /// @param domainId The domain being lent.
    /// @param amount How much weight to lend.
    function delegateWeight(address delegate, bytes32 domainId, uint256 amount) external {
        Lending memory held_ = _lent[msg.sender][domainId];
        if (delegate == address(0)) {
            if (held_.delegate != address(0)) _lendingCount[msg.sender] -= 1;
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
        _lendingCount[msg.sender] += 1;
        emit WeightDelegated(msg.sender, delegate, domainId, amount);
    }

    /// @notice The weight an account holds on a domain, given who delegated to whom.
    /// @dev The standing figure: what this account could bring to a *fresh* proposal on
    ///      this domain. Zero once it has handed the domain away; otherwise its own
    ///      weight plus every principal whose weight routes to it.
    ///
    ///      It deliberately knows nothing about any particular ballot, so it keeps
    ///      answering the same thing after a vote is cast. For what an account may still
    ///      cast on a proposal that is open, ask `weightOn`.
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
        // The last completed block, which is the most recent one the token can answer for.
        weight_ = _share(0, account, domains_, clock() - 1, principals);
    }

    /// @notice The weight an account may still cast on one open proposal.
    /// @dev `weightFor` less every voice already on this proposal's ballot — the voter's
    ///      own if it has voted, and each principal whose weight somebody already carried.
    ///      This is the number a vote button should show: the one the governor will
    ///      actually count, rather than the one the register would allow on a clean slate.
    ///
    ///      The domain comes from the resolver rather than the caller, since the proposal
    ///      already fixes it and a second copy is only an opportunity to disagree.
    /// @param proposalId The proposal being voted on.
    /// @param account The prospective voter.
    /// @param principals The accounts the voter would name.
    /// @param domainPath The proposal's domain and its parents, verified against the graph.
    function weightOn(
        uint256 proposalId,
        address account,
        address[] calldata principals,
        bytes32[] calldata domainPath
    ) external view returns (uint256 weight_) {
        bytes32 domainId_ = DOMAIN_RESOLVER.proposalDomain(proposalId);
        if (domainId_ == bytes32(0)) return 0;
        _verifyPath(domainId_, domainPath);
        bytes32[] memory domains_ = _domainsFor(domainId_, domainPath);
        weight_ = _share(proposalId, account, domains_, _weightAt(proposalSnapshot(proposalId)), principals);
    }

    /// @notice Who an account handed weight to on a domain.
    function delegatedTo(address delegator, bytes32 domainId) public view returns (address delegate_) {
        delegate_ = _lent[delegator][domainId].delegate;
    }

    /// @notice How much of this account's weight has already been cast on this proposal.
    /// @dev Counts what the account cast itself and what delegates carried for it, which
    ///      is what makes it the companion to `hasVoted` rather than a copy: `hasVoted`
    ///      answers the narrower question of whether this account *submitted* a vote, and
    ///      a delegator whose weight a delegate carried submitted nothing.
    ///
    ///      Deliberately not folded into `hasVoted`. A lender who handed over a quarter
    ///      of its weight has had something cast in its name and may still vote with the
    ///      rest, so a boolean there would be a lie in both directions. `weightOn` is
    ///      what a vote button should read.
    function voiceCast(uint256 proposalId, address account) public view returns (uint256) {
        return _cast[proposalId][account];
    }

    /// @notice What an account lent on a domain, and to whom.
    /// @dev A display cannot work this out from balances: a lending moves no token, so the
    ///      difference between what someone holds and what they cast says nothing about
    ///      how much they lent. This is the only honest source.
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
        if (params.length == 0) return super._getVotes(account, at_, "");

        (uint256 proposalId_, bytes32[] memory domainPath_, address[] memory principals_) =
            abi.decode(params, (uint256, bytes32[], address[]));

        bytes32 domainId_ = DOMAIN_RESOLVER.proposalDomain(proposalId_);
        if (domainId_ == bytes32(0)) return super._getVotes(account, at_, "");

        _verifyPath(domainId_, domainPath_);
        bytes32[] memory domains_ = _domainsFor(domainId_, domainPath_);
        return _share(proposalId_, account, domains_, at_, principals_);
    }

    /// @dev Refuses a voice already on the ballot, then writes down the ones this vote
    ///      spends. Called from the final contract's `_countVote`, after OZ has tallied:
    ///      a revert here rolls that tally back with everything else, and `Governor`
    ///      declares `_countVote` without a body, so this module cannot reach OZ's own
    ///      implementation through `super` and does not try to.
    ///
    ///      The half OZ cannot do is exactly this one. It has no notion that an account's
    ///      weight might be cast by somebody else, so its guard — keyed on whoever
    ///      submitted the vote — cannot see that a delegator's voice is already spent.
    /// @param weight What the tally received, used only on the path where no domain is
    ///        named and the whole vote is the account's own voice.
    function _spendVoices(uint256 proposalId, address account, uint256 weight, bytes memory params) internal {
        bytes32 domainId_ = DOMAIN_RESOLVER.proposalDomain(proposalId);
        if (params.length == 0 || domainId_ == bytes32(0)) {
            // Nothing names a domain, so the register cannot be read for one. Safe only
            // while this account has nothing on loan anywhere.
            if (_lendingCount[account] != 0) revert DomainNotNamed(account);
            if (_cast[proposalId][account] != 0) revert GovernorAlreadyCastVote(account);
            _spend(proposalId, account, account, weight);
            return;
        }
        _recordVoices(proposalId, account, domainId_, params);
    }

    /// @dev Marks every voice this vote carried, the voter's own included, and logs each.
    ///
    ///      Recomputed from the same state and the same timepoint `_getVotes` used, so the
    ///      shares logged here add up to the weight the tally received. Deriving them from
    ///      the vote's total instead would be a guess, and a guess is exactly what the
    ///      frontend was reduced to before this event existed.
    function _recordVoices(uint256 proposalId, address account, bytes32 domainId, bytes memory params) private {
        (, bytes32[] memory domainPath_, address[] memory principals_) =
            abi.decode(params, (uint256, bytes32[], address[]));
        bytes32[] memory domains_ = _domainsFor(domainId, domainPath_);
        uint256 at_ = _weightAt(proposalSnapshot(proposalId));

        uint256 own_ = _ownShare(proposalId, account, domains_, at_);
        uint256 total_ = own_;
        if (own_ != 0) _spend(proposalId, account, account, own_);

        uint256 count_ = principals_.length;
        for (uint256 i_; i_ < count_; ++i_) {
            uint256 carried_ = _carriedShare(proposalId, principals_[i_], account, domains_, at_);
            if (carried_ == 0) continue;
            total_ += carried_;
            _spend(proposalId, principals_[i_], account, carried_);
        }

        // Nothing left to cast *and* something already cast in this account's name is
        // the double vote: a lender taking its domain back after the delegate voted, or
        // claiming a voice a delegate has already carried. Saying so is kinder than
        // recording a vote worth zero, and it is what OZ says when an account votes twice.
        //
        // Carrying nothing for any other reason is not an error and is not treated as
        // one: an account that lent its whole weight away, or holds none, casts zero and
        // stock OpenZeppelin records exactly that.
        if (total_ == 0 && _cast[proposalId][account] != 0) revert GovernorAlreadyCastVote(account);
    }

    /// @dev One voice, spent and announced.
    function _spend(uint256 proposalId, address principal, address voter, uint256 weight) private {
        _cast[proposalId][principal] += weight;
        emit VoteCastOnBehalf(proposalId, principal, voter, weight);
    }

    /// @dev What `account` casts on this proposal: what it kept of its own, plus every
    ///      claimed voice that actually routes to it and has not been cast already.
    ///
    ///      The same routine answers for the vote path and for the display, which is the
    ///      point of it being one routine: a UI that computed this differently was free to
    ///      promise a weight the governor would refuse.
    /// @dev Proposal id zero means "no ballot in mind", which `weightFor` relies on. A
    ///      real id is a hash of the call a proposal would execute, so zero is not one.
    function _share(
        uint256 proposalId,
        address account,
        bytes32[] memory domains,
        uint256 at,
        address[] memory principals
    ) private view returns (uint256 total_) {
        total_ = _ownShare(proposalId, account, domains, at);
        uint256 count_ = principals.length;
        for (uint256 i_; i_ < count_; ++i_) {
            total_ += _carriedShare(proposalId, principals[i_], account, domains, at);
        }
    }

    /// @dev What an account still has of its own on this proposal: what it kept of its
    ///      balance, less anything already cast in its name.
    function _ownShare(
        uint256 proposalId,
        address account,
        bytes32[] memory domains,
        uint256 at
    ) private view returns (uint256) {
        return _min(_keptBy(account, domains, at), _unspent(proposalId, account, at));
    }

    /// @dev What `account` may claim of `principal`'s voice on this proposal: what was
    ///      lent to it, less anything already cast in the principal's name — by the
    ///      principal itself, or by a delegate before the lending moved.
    function _carriedShare(
        uint256 proposalId,
        address principal,
        address account,
        bytes32[] memory domains,
        uint256 at
    ) private view returns (uint256) {
        if (principal == account) return 0;
        return _min(_lentTo(principal, account, domains, at), _unspent(proposalId, principal, at));
    }

    /// @dev What is left of an account's weight on this proposal: its balance, less
    ///      whatever has already been cast in its name.
    function _unspent(uint256 proposalId, address principal, uint256 at) private view returns (uint256) {
        uint256 balance_ = super._getVotes(principal, at, "");
        uint256 cast_ = _cast[proposalId][principal];
        return cast_ >= balance_ ? 0 : balance_ - cast_;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
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
    ///      principal actually holds. Zero unless the chain of lendings ends at `account`.
    function _lentTo(
        address principal,
        address account,
        bytes32[] memory domains,
        uint256 at
    ) private view returns (uint256) {
        if (_terminalHolder(principal, domains) != account) return 0;
        (, uint256 amount_) = _lentAny(principal, domains);
        uint256 balance_ = super._getVotes(principal, at, "");
        return amount_ > balance_ ? balance_ : amount_;
    }

    /// @dev Who ends up holding a voice: the last account in the chain of lendings that
    ///      starts at `from`. Zero when `from` lent nothing, or when the chain comes back
    ///      round to it.
    ///
    ///      A lending is a hand-over, and a hand-over can be passed on: A lends
    ///      `treasury` to B, B lends it to C, and it is C who votes with A's weight.
    ///      Following one hop only — which is what this did — stranded A's weight at B and
    ///      dropped it from C's ballot without a word, so a three-level chain counted two
    ///      voices where it should have counted three.
    ///
    ///      Bounded by `MAX_DOMAIN_PATH`, so a cycle in the register costs a fixed number
    ///      of reads rather than every drop of gas available.
    function _terminalHolder(address from, bytes32[] memory domains) private view returns (address holder_) {
        (address next_,) = _lentAny(from, domains);
        if (next_ == address(0)) return address(0);
        holder_ = next_;
        for (uint256 hop_ = 1; hop_ < MAX_DOMAIN_PATH; ++hop_) {
            (address onward_,) = _lentAny(holder_, domains);
            if (onward_ == address(0)) return holder_;
            if (onward_ == from) return address(0);
            holder_ = onward_;
        }
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
