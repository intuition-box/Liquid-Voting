// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { IMultiVault } from "../interfaces/IMultiVault.sol";

/// @title DemoGovernor
/// @notice Minimal governance recorder for the POC — the bounty explicitly allows a mock.
///         It reproduces the shape of an OpenZeppelin `Governor` (proposal lifecycle,
///         For/Against/Abstain counting, a voting delay and period, a quorum, weighted
///         votes) so the demo reads like real governance, while staying a mock: voting
///         power is assigned directly instead of snapshotted from an `ERC20Votes` token,
///         there is no timelock, and `execute` performs no calls.
/// @dev Two deliberate departures from OpenZeppelin, both in service of the POC's thesis:
///
///      1. `propose` carries the domain as its first argument. A production Governor takes
///         `(address[] targets, uint256[] values, bytes[] calldatas, string description)`
///         with no domain field, which is why a production deployment resolves the domain
///         another way (a resolver pinned in the signed caveat terms).
///      2. `castVoteFor` lets a caller cast a vote on behalf of principals it represents,
///         and records who was represented. OpenZeppelin aggregates delegated weight
///         invisibly at snapshot time; here the representation is explicit on-chain so a
///         delegation chain scoped by the knowledge graph can be audited vote by vote.
contract DemoGovernor {
    ////////////////////////////// Types //////////////////////////////

    /// @notice Lifecycle of a proposal, mirroring OpenZeppelin's `IGovernor.ProposalState`
    ///         minus the states this mock has no machinery for (Queued, Canceled, Expired).
    enum ProposalState {
        Pending,
        Active,
        Defeated,
        Succeeded,
        Executed
    }

    /// @notice Vote options, matching `GovernorCountingSimple`.
    enum VoteType {
        Against,
        For,
        Abstain
    }

    /// @notice A recorded proposal.
    /// @dev The first three fields are the POC's original shape and are consumed by the
    ///      frontend and the acceptance runner; lifecycle fields were appended after them.
    struct Proposal {
        bytes32 domainId;
        address proposer;
        string description;
        uint256 voteStart;
        uint256 voteEnd;
        uint256 againstVotes;
        uint256 forVotes;
        uint256 abstainVotes;
        bool executed;
    }

    ////////////////////////////// Custom errors //////////////////////////////

    /// @notice The requested proposal id does not exist.
    error ProposalNotFound(uint256 proposalId);
    /// @notice Voting is not open for this proposal.
    error VotingNotActive(uint256 proposalId, ProposalState state);
    /// @notice The account has already voted, directly or as a represented principal.
    error AlreadyVoted(uint256 proposalId, address account);
    /// @notice The vote option is outside `VoteType`.
    error InvalidVoteType(uint8 support);
    /// @notice The proposal is not in a state that allows execution.
    error ProposalNotSucceeded(uint256 proposalId, ProposalState state);
    /// @notice The caller holds no voting power and represents no principal with any.
    error NoVotingPower(address account);
    /// @notice Voting power was assigned to the zero address.
    error ZeroAddress();
    /// @notice The account delegated this domain away, so it cannot vote on it itself.
    error WeightDelegatedAway(address account, bytes32 domainId, address delegate);
    /// @notice The principal did not delegate this domain to the voter.
    error NotDelegatedToVoter(address principal, address voter, bytes32 domainId);
    /// @notice Delegating here would send the weight in a circle.
    error CircularDelegation(address delegator, address delegate, bytes32 domainId);
    /// @notice This domain is already delegated; revoke before granting it elsewhere.
    error AlreadyDelegated(address delegator, bytes32 domainId, address delegate);
    /// @notice A parent domain is already delegated, so this one went with it.
    error CoveredByParent(address delegator, bytes32 parentId, address delegate);
    /// @notice The domain path does not start at the proposal's own domain.
    error DomainPathMismatch(bytes32 pathStart, bytes32 domainId);
    /// @notice The domain path claims an edge the graph does not carry.
    error DomainPathBroken(bytes32 child, bytes32 parent);
    /// @notice The domain path exceeds the hop cap.
    error DomainPathTooLong(uint256 hops);

    ////////////////////////////// Events //////////////////////////////

    /// @notice Emitted for every recorded proposal.
    /// @param proposalId Sequential id of the proposal.
    /// @param domainId Term id of the governance domain the proposal claims.
    /// @param proposer The address the proposal was executed from (the root delegator
    ///        when submitted through a delegation chain).
    /// @param description Free-text description (not indexed).
    /// @param voteStart Block number at which voting opens.
    /// @param voteEnd Block number after which voting is closed.
    event ProposalCreated(
        uint256 indexed proposalId,
        bytes32 indexed domainId,
        address indexed proposer,
        string description,
        uint256 voteStart,
        uint256 voteEnd
    );

    /// @notice Emitted for every vote cast, carrying the total weight and who it covered.
    /// @param proposalId The proposal voted on.
    /// @param voter The account that submitted the vote.
    /// @param support The `VoteType` chosen, as its underlying uint8.
    /// @param weight Total weight applied: the voter's own power plus every principal's.
    /// @param principals The accounts represented besides the voter; empty for a self-vote.
    event VoteCast(
        uint256 indexed proposalId, address indexed voter, uint8 support, uint256 weight, address[] principals
    );

    /// @notice Emitted once per represented principal, so delegated weight is auditable.
    /// @param proposalId The proposal voted on.
    /// @param principal The account whose power was exercised.
    /// @param representative The account that exercised it.
    /// @param weight The principal's own voting power.
    event VoteCastOnBehalf(
        uint256 indexed proposalId, address indexed principal, address indexed representative, uint256 weight
    );

    /// @notice Emitted when a succeeded proposal is marked executed.
    /// @param proposalId The proposal that was executed.
    event ProposalExecuted(uint256 indexed proposalId);

    /// @notice Emitted when an account's voting power is set.
    /// @param account The account whose power changed.
    /// @param votingPower The new voting power.
    event VotingPowerSet(address indexed account, uint256 votingPower);

    /// @notice Emitted when an account hands its weight on a domain to someone else.
    /// @param delegator The account giving its weight away.
    /// @param delegate The account receiving it; zero clears the delegation.
    /// @param domainId The domain the transfer applies to.
    event WeightDelegated(address indexed delegator, address indexed delegate, bytes32 indexed domainId);

    ////////////////////////////// State //////////////////////////////

    /// @notice Blocks between a proposal's creation and the opening of its voting window.
    uint256 public constant VOTING_DELAY = 1;
    /// @notice Length of the voting window, in blocks. Chain 13579 produces roughly one
    ///         block per second, so this is about eight hours — long enough that a
    ///         proposal recorded before a session is still votable throughout it.
    uint256 public constant VOTING_PERIOD = 30_000;
    /// @notice Total weight required for a proposal to be able to succeed.
    uint256 public constant QUORUM = 1;
    /// @notice Voting power every account holds before any explicit assignment.
    uint256 public constant DEFAULT_VOTING_POWER = 1;

    /// @notice MultiVault term classifier for a positive triple, as the enforcer uses.
    uint8 internal constant VAULT_TYPE_TRIPLE = 1;
    /// @notice Longest domain path a voter may present.
    uint256 public constant MAX_DOMAIN_PATH = 6;

    /// @notice The graph this governor resolves sub-domain relations against.
    IMultiVault public immutable MULTI_VAULT;
    /// @notice Term id of the "is a sub-domain of" predicate.
    bytes32 public immutable SUB_DOMAIN_PREDICATE;

    /// @notice Longest delegation chain the circularity walk will follow.
    /// @dev Bounds the loop in `_wouldCircle`; a chain deeper than this is refused rather
    ///      than walked, so there is no unbounded traversal.
    uint256 public constant MAX_DELEGATION_DEPTH = 8;

    Proposal[] private _proposals;
    mapping(uint256 proposalId => mapping(address account => bool)) private _hasVoted;
    mapping(address account => uint256 power) private _votingPower;
    mapping(address account => bool assigned) private _powerAssigned;
    /// @dev Who an account handed its weight to, per domain. Zero means it kept it.
    mapping(address delegator => mapping(bytes32 domainId => address delegate)) private _delegatedTo;

    ////////////////////////////// Constructor //////////////////////////////

    /// @notice Binds the governor to the graph it reads sub-domain relations from.
    /// @param _multiVault The Intuition MultiVault.
    /// @param _subDomainPredicate Term id of the "is a sub-domain of" predicate.
    constructor(IMultiVault _multiVault, bytes32 _subDomainPredicate) {
        if (address(_multiVault) == address(0)) revert ZeroAddress();
        MULTI_VAULT = _multiVault;
        SUB_DOMAIN_PREDICATE = _subDomainPredicate;
    }

    ////////////////////////////// External functions //////////////////////////////

    /// @notice Assigns an account's voting power.
    /// @dev Permissionless, like `propose` — this is a mock, and the authority that matters
    ///      in this POC lives in the delegation chain, not in the governor. A production
    ///      Governor derives weight from an `ERC20Votes` snapshot instead.
    /// @param account The account to assign power to.
    /// @param power The power to assign.
    function setVotingPower(address account, uint256 power) external {
        if (account == address(0)) revert ZeroAddress();
        _votingPower[account] = power;
        _powerAssigned[account] = true;
        emit VotingPowerSet(account, power);
    }

    /// @notice Hands the caller's weight on one domain to another account.
    /// @dev Delegating **transfers** weight rather than copying it: the delegator stops
    ///      counting on that domain and the delegate counts for both. It is per domain, so
    ///      an account that delegated `design` still votes on everything else itself.
    ///
    ///      Whether the delegate may then use that weight on a given proposal is not this
    ///      contract's question — the ERC-7710 caveat answers it by checking the proposal's
    ///      domain against the Intuition graph before the vote reaches here.
    ///      A domain has one holder at a time: granting one already given reverts, so the
    ///      weight cannot be moved out from under a delegate silently. Passing the zero
    ///      address revokes, which is the way back.
    ///      Granting a domain gives away its sub-domains with it, so a domain whose parent
    ///      is already delegated cannot be granted again — that would hand the same weight
    ///      to two accounts. The caller supplies the path to the root and every hop of it
    ///      is verified against the graph, since the governor cannot walk there itself.
    /// @param delegate The account receiving the weight; zero clears the delegation.
    /// @param domainId The domain the transfer applies to.
    /// @param domainPath The domain and its parents, up the graph; empty for a root domain.
    function delegateWeight(address delegate, bytes32 domainId, bytes32[] calldata domainPath) external {
        address held_ = _delegatedTo[msg.sender][domainId];
        if (delegate != address(0) && held_ != address(0)) {
            revert AlreadyDelegated(msg.sender, domainId, held_);
        }
        if (delegate == msg.sender) revert CircularDelegation(msg.sender, delegate, domainId);

        if (delegate != address(0)) {
            _verifyPath(domainId, domainPath);
            // Skip the domain itself: only its ancestors can already carry it away.
            for (uint256 i_ = 1; i_ < domainPath.length; ++i_) {
                address parentHolder_ = _delegatedTo[msg.sender][domainPath[i_]];
                if (parentHolder_ != address(0)) {
                    revert CoveredByParent(msg.sender, domainPath[i_], parentHolder_);
                }
            }
            if (_wouldCircle(msg.sender, delegate, domainId)) {
                revert CircularDelegation(msg.sender, delegate, domainId);
            }
        }

        _delegatedTo[msg.sender][domainId] = delegate;
        emit WeightDelegated(msg.sender, delegate, domainId);
    }

    /// @notice Records a proposal scoped to a governance domain and opens its lifecycle.
    /// @param domainId Term id of the domain atom this proposal belongs to.
    /// @param description Human-readable proposal text.
    /// @return proposalId Sequential id of the recorded proposal.
    function propose(bytes32 domainId, string calldata description) external returns (uint256 proposalId) {
        proposalId = _proposals.length;
        uint256 voteStart_ = block.number + VOTING_DELAY;
        uint256 voteEnd_ = voteStart_ + VOTING_PERIOD;
        _proposals.push(
            Proposal({
                domainId: domainId,
                proposer: msg.sender,
                description: description,
                voteStart: voteStart_,
                voteEnd: voteEnd_,
                againstVotes: 0,
                forVotes: 0,
                abstainVotes: 0,
                executed: false
            })
        );
        emit ProposalCreated(proposalId, domainId, msg.sender, description, voteStart_, voteEnd_);
    }

    /// @notice Casts a vote carrying only the caller's own voting power.
    /// @param proposalId The proposal to vote on.
    /// @param support The `VoteType`: 0 Against, 1 For, 2 Abstain.
    /// @return weight The voting weight applied.
    function castVote(uint256 proposalId, uint8 support) external returns (uint256 weight) {
        address[] memory none_ = new address[](0);
        bytes32[] memory noPath_ = new bytes32[](0);
        weight = _castVote(proposalId, support, msg.sender, none_, noPath_);
    }

    /// @notice Casts one vote in `voter`'s name, carrying `voter`'s own power plus that of
    ///         every principal that delegated to it — the delegated-voting path.
    /// @dev Under ERC-7710 the delegator's account is what executes, so `msg.sender` here
    ///      is the principal, not the delegate. The delegate is named explicitly as
    ///      `voter`, and the enforcer binds that field to the redeemer of the delegation:
    ///      only the account that actually redeemed can be named. The vote is therefore
    ///      recorded as the delegate's, weighted by everyone whose authority it carries.
    ///
    ///      The governor does not verify the delegation itself — authority comes from the
    ///      ERC-7710 chain, whose caveats verified each principal's domain scope against
    ///      the Intuition graph before this call could happen. What the governor
    ///      guarantees is that no account's power is counted twice on a proposal.
    /// @param proposalId The proposal to vote on.
    /// @param support The `VoteType`: 0 Against, 1 For, 2 Abstain.
    /// @param voter The account the vote is recorded for — the delegate.
    /// @param principals The accounts whose voting power `voter` carries.
    /// @return weight The total voting weight applied.
    function castVoteFor(
        uint256 proposalId,
        uint8 support,
        address voter,
        address[] calldata principals,
        bytes32[] calldata domainPath
    ) external returns (uint256 weight) {
        if (voter == address(0)) revert ZeroAddress();
        weight = _castVote(proposalId, support, voter, principals, domainPath);
    }

    /// @notice Marks a succeeded proposal as executed.
    /// @dev The mock records the transition only; it performs no external calls. A
    ///      production Governor would execute the proposal's `(targets, values, calldatas)`
    ///      here, usually behind a `TimelockController`.
    /// @param proposalId The proposal to execute.
    function execute(uint256 proposalId) external {
        Proposal storage proposal_ = _requireProposal(proposalId);
        ProposalState state_ = _state(proposal_);
        if (state_ != ProposalState.Succeeded) revert ProposalNotSucceeded(proposalId, state_);
        proposal_.executed = true;
        emit ProposalExecuted(proposalId);
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
        proposal_ = _requireProposalView(proposalId);
    }

    /// @notice The governance domain a proposal is scoped to.
    /// @dev This is the resolver the caveat enforcer calls when the execution is a vote:
    ///      `castVote` calldata carries a proposal id, not a domain, so the domain has to
    ///      be read back from the governor before the graph can be traversed.
    /// @param proposalId Sequential id of the proposal.
    /// @return domainId_ Term id of the proposal's domain.
    function proposalDomain(uint256 proposalId) external view returns (bytes32 domainId_) {
        domainId_ = _requireProposalView(proposalId).domainId;
    }

    /// @notice Current lifecycle state of a proposal.
    /// @param proposalId Sequential id of the proposal.
    /// @return state_ The proposal's state.
    function state(uint256 proposalId) external view returns (ProposalState state_) {
        state_ = _state(_requireProposalView(proposalId));
    }

    /// @notice Vote tallies for a proposal.
    /// @param proposalId Sequential id of the proposal.
    /// @return againstVotes_ Weight voted against.
    /// @return forVotes_ Weight voted in favour.
    /// @return abstainVotes_ Weight abstaining.
    function proposalVotes(uint256 proposalId)
        external
        view
        returns (uint256 againstVotes_, uint256 forVotes_, uint256 abstainVotes_)
    {
        Proposal memory proposal_ = _requireProposalView(proposalId);
        return (proposal_.againstVotes, proposal_.forVotes, proposal_.abstainVotes);
    }

    /// @notice Whether an account's power has already been counted on a proposal, whether
    ///         it voted itself or was represented.
    /// @param proposalId Sequential id of the proposal.
    /// @param account The account to check.
    /// @return voted_ True when the account's power is already counted.
    function hasVoted(uint256 proposalId, address account) external view returns (bool voted_) {
        voted_ = _hasVoted[proposalId][account];
    }

    ////////////////////////////// Public functions //////////////////////////////

    /// @notice Voting power of an account.
    /// @param account The account to read.
    /// @return power_ The account's voting power, or `DEFAULT_VOTING_POWER` if unassigned.
    function votingPower(address account) public view returns (uint256 power_) {
        power_ = _powerAssigned[account] ? _votingPower[account] : DEFAULT_VOTING_POWER;
    }

    /// @notice Who an account handed its weight to on a domain.
    /// @param delegator The account to read.
    /// @param domainId The domain in question.
    /// @return delegate_ The delegate, or the zero address when the account kept its weight.
    function delegatedTo(address delegator, bytes32 domainId) public view returns (address delegate_) {
        delegate_ = _delegatedTo[delegator][domainId];
    }

    /// @notice The weight an account would cast on a domain, given who delegated to whom.
    /// @dev Zero once the account has delegated the domain away. Otherwise its own power
    ///      plus every principal whose weight routes to it. This is the number the UI
    ///      displays, read from the same state the vote path enforces.
    /// @param account The prospective voter.
    /// @param domainId The domain in question.
    /// @param principals The accounts the voter would name.
    /// @return weight_ The total weight, zero when the account cannot vote on this domain.
    function weightFor(
        address account,
        bytes32 domainId,
        address[] calldata principals,
        bytes32[] calldata domainPath
    ) public view returns (uint256 weight_) {
        _verifyPath(domainId, domainPath);
        bytes32[] memory domains_ = _domainsFor(domainId, domainPath);
        if (_delegatedAny(account, domains_) != address(0)) return 0;
        weight_ = votingPower(account);
        uint256 count_ = principals.length;
        for (uint256 i_; i_ < count_; ++i_) {
            if (_routesTo(principals[i_], account, domains_)) weight_ += votingPower(principals[i_]);
        }
    }

    ////////////////////////////// Private functions //////////////////////////////

    /// @dev Shared vote path. Counts `voter`'s own power plus each principal's, marking
    ///      every counted account so its power cannot be spent twice on this proposal.
    function _castVote(
        uint256 proposalId,
        uint8 support,
        address voter,
        address[] memory principals,
        bytes32[] memory domainPath
    ) private returns (uint256 weight) {
        bytes32[] memory domains_ = _checkVotable(proposalId, support, voter, domainPath);

        _hasVoted[proposalId][voter] = true;
        weight = votingPower(voter);

        uint256 count_ = principals.length;
        for (uint256 i_; i_ < count_; ++i_) {
            address principal_ = principals[i_];
            // The claim must be real: only weight actually routed to this voter counts,
            // whether granted directly or passed along a chain of delegations.
            if (!_routesTo(principal_, voter, domains_)) {
                revert NotDelegatedToVoter(principal_, voter, domains_[0]);
            }
            if (_hasVoted[proposalId][principal_]) revert AlreadyVoted(proposalId, principal_);
            _hasVoted[proposalId][principal_] = true;
            uint256 principalWeight_ = votingPower(principal_);
            weight += principalWeight_;
            emit VoteCastOnBehalf(proposalId, principal_, voter, principalWeight_);
        }

        if (weight == 0) revert NoVotingPower(voter);

        Proposal storage tally_ = _proposals[proposalId];
        if (support == uint8(VoteType.Against)) tally_.againstVotes += weight;
        else if (support == uint8(VoteType.For)) tally_.forVotes += weight;
        else tally_.abstainVotes += weight;

        emit VoteCast(proposalId, voter, support, weight, principals);
    }

    /// @dev Everything that must hold before a vote is counted: the proposal is open, the
    ///      option is real, nobody has already voted, the domain path is genuine, and the
    ///      voter has not handed any of those domains away. Returns the domains a grant may
    ///      have been made on — the proposal's own, plus every parent on the path.
    function _checkVotable(uint256 proposalId, uint8 support, address voter, bytes32[] memory domainPath)
        private
        view
        returns (bytes32[] memory domains_)
    {
        Proposal memory proposal_ = _requireProposalView(proposalId);
        ProposalState state_ = _state(proposal_);
        if (state_ != ProposalState.Active) revert VotingNotActive(proposalId, state_);
        if (support > uint8(VoteType.Abstain)) revert InvalidVoteType(support);
        if (_hasVoted[proposalId][voter]) revert AlreadyVoted(proposalId, voter);

        _verifyPath(proposal_.domainId, domainPath);
        domains_ = _domainsFor(proposal_.domainId, domainPath);

        address voterDelegate_ = _delegatedAny(voter, domains_);
        if (voterDelegate_ != address(0)) revert WeightDelegatedAway(voter, proposal_.domainId, voterDelegate_);
    }

    /// @dev Whether `principal`'s weight reaches `voter` on any domain in `domains`,
    ///      following the delegation chain. Bounded by `MAX_DELEGATION_DEPTH` per domain.
    ///
    ///      A grant on `design` covers a proposal on `branding`, because `branding` sits
    ///      under `design` in the graph. The governor does not walk the graph itself —
    ///      the MultiVault has no reverse index — so the caller supplies the domain path
    ///      and `_verifyPath` checks every hop of it before the weight is counted.
    function _routesTo(address principal, address voter, bytes32[] memory domains) private view returns (bool) {
        address current_ = principal;
        for (uint256 i_; i_ < MAX_DELEGATION_DEPTH; ++i_) {
            // A hop may have been granted on any domain covering this proposal, and the
            // next hop on a different one: A hands `design` to B, B hands `UX` to C, and a
            // `UX` proposal carries all three. So each step tries every covering domain.
            address next_ = _delegatedAny(current_, domains);
            if (next_ == address(0)) return false;
            if (next_ == voter) return true;
            current_ = next_;
        }
        return false;
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

    /// @dev Confirms `path` is a real chain of sub-domain edges in the graph, starting at
    ///      the proposal's domain. Each hop is checked against the MultiVault exactly as
    ///      the caveat enforcer checks it: the triple must exist as a positive assertion.
    ///      An unverified path would let a voter claim a grant on an unrelated domain.
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

    /// @dev Whether delegating to `delegate` would route `delegator`'s weight back to
    ///      itself. Bounded by `MAX_DELEGATION_DEPTH`; a longer chain is treated as
    ///      circular rather than walked further.
    function _wouldCircle(address delegator, address delegate, bytes32 domainId) private view returns (bool) {
        address current_ = delegate;
        for (uint256 i_; i_ < MAX_DELEGATION_DEPTH; ++i_) {
            if (current_ == address(0)) return false;
            if (current_ == delegator) return true;
            current_ = _delegatedTo[current_][domainId];
        }
        return true;
    }

    /// @dev Storage handle to an existing proposal, reverting on an unknown id.
    function _requireProposal(uint256 proposalId) private view returns (Proposal storage proposal_) {
        if (proposalId >= _proposals.length) revert ProposalNotFound(proposalId);
        proposal_ = _proposals[proposalId];
    }

    /// @dev Memory copy of an existing proposal, reverting on an unknown id.
    function _requireProposalView(uint256 proposalId) private view returns (Proposal memory proposal_) {
        if (proposalId >= _proposals.length) revert ProposalNotFound(proposalId);
        proposal_ = _proposals[proposalId];
    }

    /// @dev Lifecycle derived from block number and tallies, in OpenZeppelin's order:
    ///      before `voteStart` it is Pending, through `voteEnd` it is Active, and after
    ///      that it succeeded when quorum was met and For strictly beats Against.
    function _state(Proposal memory proposal_) private view returns (ProposalState) {
        if (proposal_.executed) return ProposalState.Executed;
        if (block.number < proposal_.voteStart) return ProposalState.Pending;
        if (block.number <= proposal_.voteEnd) return ProposalState.Active;
        uint256 cast_ = proposal_.forVotes + proposal_.againstVotes + proposal_.abstainVotes;
        if (cast_ < QUORUM || proposal_.forVotes <= proposal_.againstVotes) return ProposalState.Defeated;
        return ProposalState.Succeeded;
    }
}
