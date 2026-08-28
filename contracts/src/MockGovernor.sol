// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

/// @title MockGovernor
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
contract MockGovernor {
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
    /// @param delegate The account receiving the weight; zero clears the delegation.
    /// @param domainId The domain the transfer applies to.
    function delegateWeight(address delegate, bytes32 domainId) external {
        if (delegate == msg.sender) revert CircularDelegation(msg.sender, delegate, domainId);
        if (delegate != address(0) && _wouldCircle(msg.sender, delegate, domainId)) {
            revert CircularDelegation(msg.sender, delegate, domainId);
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
        weight = _castVote(proposalId, support, msg.sender, none_);
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
    function castVoteFor(uint256 proposalId, uint8 support, address voter, address[] calldata principals)
        external
        returns (uint256 weight)
    {
        if (voter == address(0)) revert ZeroAddress();
        weight = _castVote(proposalId, support, voter, principals);
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
    function weightFor(address account, bytes32 domainId, address[] calldata principals)
        public
        view
        returns (uint256 weight_)
    {
        if (_delegatedTo[account][domainId] != address(0)) return 0;
        weight_ = votingPower(account);
        uint256 count_ = principals.length;
        for (uint256 i_; i_ < count_; ++i_) {
            if (_routesTo(principals[i_], account, domainId)) weight_ += votingPower(principals[i_]);
        }
    }

    ////////////////////////////// Private functions //////////////////////////////

    /// @dev Shared vote path. Counts `voter`'s own power plus each principal's, marking
    ///      every counted account so its power cannot be spent twice on this proposal.
    function _castVote(uint256 proposalId, uint8 support, address voter, address[] memory principals)
        private
        returns (uint256 weight)
    {
        Proposal storage proposal_ = _requireProposal(proposalId);
        ProposalState state_ = _state(proposal_);
        if (state_ != ProposalState.Active) revert VotingNotActive(proposalId, state_);
        if (support > uint8(VoteType.Abstain)) revert InvalidVoteType(support);
        if (_hasVoted[proposalId][voter]) revert AlreadyVoted(proposalId, voter);

        // An account that handed this domain away no longer counts on it, not even for
        // itself — delegating transfers weight rather than copying it.
        bytes32 domainId_ = proposal_.domainId;
        address voterDelegate_ = _delegatedTo[voter][domainId_];
        if (voterDelegate_ != address(0)) revert WeightDelegatedAway(voter, domainId_, voterDelegate_);

        _hasVoted[proposalId][voter] = true;
        weight = votingPower(voter);

        uint256 count_ = principals.length;
        for (uint256 i_; i_ < count_; ++i_) {
            address principal_ = principals[i_];
            // The claim must be real: only weight actually routed to this voter counts,
            // whether granted directly or passed along a chain of delegations.
            if (!_routesTo(principal_, voter, domainId_)) {
                revert NotDelegatedToVoter(principal_, voter, domainId_);
            }
            if (_hasVoted[proposalId][principal_]) revert AlreadyVoted(proposalId, principal_);
            _hasVoted[proposalId][principal_] = true;
            uint256 principalWeight_ = votingPower(principal_);
            weight += principalWeight_;
            emit VoteCastOnBehalf(proposalId, principal_, voter, principalWeight_);
        }

        if (weight == 0) revert NoVotingPower(voter);

        if (support == uint8(VoteType.Against)) proposal_.againstVotes += weight;
        else if (support == uint8(VoteType.For)) proposal_.forVotes += weight;
        else proposal_.abstainVotes += weight;

        emit VoteCast(proposalId, voter, support, weight, principals);
    }

    /// @dev Whether `principal`'s weight on `domainId` reaches `voter`, following the
    ///      delegation chain. Bounded by `MAX_DELEGATION_DEPTH`.
    function _routesTo(address principal, address voter, bytes32 domainId) private view returns (bool) {
        address current_ = _delegatedTo[principal][domainId];
        for (uint256 i_; i_ < MAX_DELEGATION_DEPTH; ++i_) {
            if (current_ == address(0)) return false;
            if (current_ == voter) return true;
            current_ = _delegatedTo[current_][domainId];
        }
        return false;
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
