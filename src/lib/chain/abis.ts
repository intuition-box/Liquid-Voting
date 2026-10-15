/** Shared ABI fragments — the single source for both the CLI scripts and the frontend. */

export const multiVaultAbi = [
  { type: "function", name: "calculateAtomId", stateMutability: "pure", inputs: [{ name: "data", type: "bytes" }], outputs: [{ type: "bytes32" }] },
  {
    type: "function",
    name: "calculateTripleId",
    stateMutability: "pure",
    inputs: [
      { name: "subjectId", type: "bytes32" },
      { name: "predicateId", type: "bytes32" },
      { name: "objectId", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  { type: "function", name: "getTriple", stateMutability: "view", inputs: [{ name: "tripleId", type: "bytes32" }], outputs: [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }] },
  { type: "function", name: "getCounterIdFromTripleId", stateMutability: "pure", inputs: [{ name: "tripleId", type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "isTermCreated", stateMutability: "view", inputs: [{ name: "termId", type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isTriple", stateMutability: "view", inputs: [{ name: "termId", type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "getVaultType", stateMutability: "view", inputs: [{ name: "termId", type: "bytes32" }], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "getShares",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "termId", type: "bytes32" },
      { name: "curveId", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "getVault", stateMutability: "view", inputs: [{ name: "termId", type: "bytes32" }, { name: "curveId", type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "getBondingCurveConfig", stateMutability: "view", inputs: [], outputs: [{ type: "address" }, { type: "uint256" }] },
  { type: "function", name: "getAtomCost", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getTripleCost", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "termId", type: "bytes32" },
      { name: "curveId", type: "uint256" },
      { name: "minShares", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "createAtoms", stateMutability: "payable", inputs: [{ name: "atomDatas", type: "bytes[]" }, { name: "assets", type: "uint256[]" }], outputs: [{ type: "bytes32[]" }] },
  {
    type: "function",
    name: "createTriples",
    stateMutability: "payable",
    inputs: [
      { name: "subjectIds", type: "bytes32[]" },
      { name: "predicateIds", type: "bytes32[]" },
      { name: "objectIds", type: "bytes32[]" },
      { name: "assets", type: "uint256[]" },
    ],
    outputs: [{ type: "bytes32[]" }],
  },
] as const;

const delegationTuple = {
  type: "tuple",
  components: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    {
      name: "caveats",
      type: "tuple[]",
      components: [
        { name: "enforcer", type: "address" },
        { name: "terms", type: "bytes" },
        { name: "args", type: "bytes" },
      ],
    },
    { name: "salt", type: "uint256" },
    { name: "signature", type: "bytes" },
  ],
} as const;

export const delegationManagerAbi = [
  {
    type: "function",
    name: "redeemDelegations",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_permissionContexts", type: "bytes[]" },
      { name: "_modes", type: "bytes32[]" },
      { name: "_executionCallDatas", type: "bytes[]" },
    ],
    outputs: [],
  },
  { type: "function", name: "disableDelegation", stateMutability: "nonpayable", inputs: [{ ...delegationTuple, name: "_delegation" }], outputs: [] },
  { type: "function", name: "getDelegationHash", stateMutability: "pure", inputs: [{ ...delegationTuple, name: "_input" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "getDomainHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "disabledDelegations", stateMutability: "view", inputs: [{ name: "", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

export const revertAbi = [
  { type: "error", name: "NotATriple", inputs: [{ name: "tripleId", type: "bytes32" }] },
  { type: "error", name: "NotAttested", inputs: [{ name: "tripleId", type: "bytes32" }, { name: "attestor", type: "address" }] },
  { type: "error", name: "PathTooLong", inputs: [{ name: "hops", type: "uint256" }, { name: "maxDepth", type: "uint8" }] },
  { type: "error", name: "PathStartMismatch", inputs: [{ name: "pathStart", type: "bytes32" }, { name: "proposalDomain", type: "bytes32" }] },
  { type: "error", name: "PathEndMismatch", inputs: [{ name: "pathEnd", type: "bytes32" }, { name: "rootDomainId", type: "bytes32" }] },
  { type: "error", name: "DelegationExpired", inputs: [{ name: "expiry", type: "uint64" }, { name: "currentTimestamp", type: "uint256" }] },
  { type: "error", name: "MalformedVoteCalldata", inputs: [{ name: "length", type: "uint256" }] },
  { type: "error", name: "UnresolvedProposalDomain", inputs: [{ name: "proposalId", type: "uint256" }] },
  { type: "error", name: "AlreadyVoted", inputs: [{ name: "proposalId", type: "uint256" }, { name: "account", type: "address" }] },
  { type: "error", name: "VotingNotActive", inputs: [{ name: "proposalId", type: "uint256" }, { name: "state", type: "uint8" }] },
  { type: "error", name: "NoVotingPower", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "WeightDelegatedAway", inputs: [{ name: "account", type: "address" }, { name: "domainId", type: "bytes32" }, { name: "delegate", type: "address" }] },
  { type: "error", name: "NotDelegatedToVoter", inputs: [{ name: "principal", type: "address" }, { name: "voter", type: "address" }, { name: "domainId", type: "bytes32" }] },
  { type: "error", name: "AlreadyDelegated", inputs: [{ name: "delegator", type: "address" }, { name: "domainId", type: "bytes32" }, { name: "delegate", type: "address" }] },
  { type: "error", name: "CoveredByParent", inputs: [{ name: "delegator", type: "address" }, { name: "parentId", type: "bytes32" }, { name: "delegate", type: "address" }] },
  { type: "error", name: "CircularDelegation", inputs: [{ name: "delegator", type: "address" }, { name: "delegate", type: "address" }, { name: "domainId", type: "bytes32" }] },
  { type: "error", name: "EmptyPath", inputs: [] },
  { type: "error", name: "InvalidTarget", inputs: [{ name: "actual", type: "address" }, { name: "expected", type: "address" }] },
  { type: "error", name: "InvalidSelector", inputs: [{ name: "actual", type: "bytes4" }, { name: "expected", type: "bytes4" }] },
  { type: "error", name: "NotSingleExecutionMode", inputs: [{ name: "mode", type: "bytes32" }] },
  { type: "error", name: "CannotUseADisabledDelegation", inputs: [] },
  { type: "error", name: "InvalidERC1271Signature", inputs: [] },
  { type: "error", name: "InvalidEOASignature", inputs: [] },
  { type: "error", name: "InvalidDelegate", inputs: [] },
  { type: "error", name: "InvalidAuthority", inputs: [] },

  // OpenZeppelin's own reverts. Without them a refused vote came back as "no revert
  // reason", which is the least helpful thing a demo aimed at developers can say.
  { type: "error", name: "GovernorAlreadyCastVote", inputs: [{ name: "voter", type: "address" }] },
  { type: "error", name: "GovernorNonexistentProposal", inputs: [{ name: "proposalId", type: "uint256" }] },
  {
    type: "error",
    name: "GovernorUnexpectedProposalState",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "current", type: "uint8" },
      { name: "expectedStates", type: "bytes32" },
    ],
  },
  { type: "error", name: "GovernorInvalidVoteType", inputs: [] },
  { type: "error", name: "GovernorInvalidSignature", inputs: [{ name: "voter", type: "address" }] },

  // And this governor's own, which the register raises.
  { type: "error", name: "DomainNotNamed", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "DomainPathMismatch", inputs: [{ name: "pathStart", type: "bytes32" }, { name: "domainId", type: "bytes32" }] },
  { type: "error", name: "DomainPathBroken", inputs: [{ name: "child", type: "bytes32" }, { name: "parent", type: "bytes32" }] },
  { type: "error", name: "DomainPathTooLong", inputs: [{ name: "hops", type: "uint256" }] },
  { type: "error", name: "AmountExceedsBalance", inputs: [{ name: "delegator", type: "address" }, { name: "amount", type: "uint256" }, { name: "balance", type: "uint256" }] },
  { type: "error", name: "ZeroAmount", inputs: [{ name: "delegator", type: "address" }, { name: "domainId", type: "bytes32" }] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "DomainAlreadySet", inputs: [{ name: "proposalId", type: "uint256" }, { name: "domainId", type: "bytes32" }] },
] as const;

export const entryPointAbi = [
  {
    type: "function",
    name: "handleOps",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "ops",
        type: "tuple[]",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "UserOperationEvent",
    inputs: [
      { name: "userOpHash", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "paymaster", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "success", type: "bool", indexed: false },
      { name: "actualGasCost", type: "uint256", indexed: false },
      { name: "actualGasUsed", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UserOperationRevertReason",
    inputs: [
      { name: "userOpHash", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "revertReason", type: "bytes", indexed: false },
    ],
  },
] as const;

/**
 * The OpenZeppelin governor, and the token it reads weight from.
 *
 * Separate from `governorAbi` because the two governors genuinely differ. OZ has no
 * proposal counter and no stored proposal struct: ids are hashes and the details live in
 * events, so listing proposals means reading `ProposalCreated` rather than counting up
 * from zero. Voting goes through `castVoteWithReasonAndParams`, which is the entry point
 * that carries the `params` our domain register needs.
 */
export const ozGovernorAbi = [
  {
    type: "function",
    name: "propose",
    stateMutability: "nonpayable",
    inputs: [
      { name: "targets", type: "address[]" },
      { name: "values", type: "uint256[]" },
      { name: "calldatas", type: "bytes[]" },
      { name: "description", type: "string" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "castVoteWithReasonAndParams",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "support", type: "uint8" },
      { name: "reason", type: "string" },
      { name: "params", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "delegateWeight",
    stateMutability: "nonpayable",
    inputs: [
      { name: "delegate", type: "address" },
      { name: "domainId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "lendingOf",
    stateMutability: "view",
    inputs: [{ name: "delegator", type: "address" }, { name: "domainId", type: "bytes32" }],
    outputs: [{ name: "delegate", type: "address" }, { name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "delegatedTo",
    stateMutability: "view",
    inputs: [{ name: "delegator", type: "address" }, { name: "domainId", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "weightFor",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "domainId", type: "bytes32" },
      { name: "principals", type: "address[]" },
      { name: "domainPath", type: "bytes32[]" },
    ],
    outputs: [{ type: "uint256" }],
  },
  // The entry point a redeemed delegation votes through. OZ's public castVote family
  // reads the voter from `_msgSender()`, which under a redemption is the root delegator
  // rather than the delegate, so the voter is named explicitly here.
  {
    type: "function",
    name: "castVoteFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "support", type: "uint8" },
      { name: "voter", type: "address" },
      { name: "principals", type: "address[]" },
      { name: "domainPath", type: "bytes32[]" },
    ],
    outputs: [{ type: "uint256" }],
  },
  // What an account may still cast on one open proposal: `weightFor` less every voice
  // already on that ballot. This is what a vote button should read.
  {
    type: "function",
    name: "weightOn",
    stateMutability: "view",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "account", type: "address" },
      { name: "principals", type: "address[]" },
      { name: "domainPath", type: "bytes32[]" },
    ],
    outputs: [{ type: "uint256" }],
  },
  // How much of an account's weight is already on a proposal, whoever put it there.
  {
    type: "function",
    name: "voiceCast",
    stateMutability: "view",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  // OpenZeppelin's own reverts, so a direct call decodes them. `revertAbi` carries these
  // too, but that one is only consulted for a user operation's inner revert — viem
  // decodes a `writeContract` failure against the ABI it was handed, which is this one.
  // Without them a collided proposal id came back as a bare `0x31b75e4d`.
  { type: "error", name: "GovernorAlreadyCastVote", inputs: [{ name: "voter", type: "address" }] },
  { type: "error", name: "GovernorNonexistentProposal", inputs: [{ name: "proposalId", type: "uint256" }] },
  {
    type: "error",
    name: "GovernorUnexpectedProposalState",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "current", type: "uint8" },
      { name: "expectedStates", type: "bytes32" },
    ],
  },
  { type: "error", name: "GovernorInvalidVoteType", inputs: [] },
  { type: "error", name: "GovernorRestrictedProposer", inputs: [{ name: "proposer", type: "address" }] },
  {
    type: "error",
    name: "GovernorInsufficientProposerVotes",
    inputs: [
      { name: "proposer", type: "address" },
      { name: "votes", type: "uint256" },
      { name: "threshold", type: "uint256" },
    ],
  },
  { type: "error", name: "DomainNotNamed", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "AlreadyDelegated", inputs: [{ name: "delegator", type: "address" }, { name: "domainId", type: "bytes32" }, { name: "delegate", type: "address" }] },
  { type: "error", name: "CircularDelegation", inputs: [{ name: "delegator", type: "address" }, { name: "delegate", type: "address" }, { name: "domainId", type: "bytes32" }] },
  { type: "error", name: "AmountExceedsBalance", inputs: [{ name: "delegator", type: "address" }, { name: "amount", type: "uint256" }, { name: "balance", type: "uint256" }] },

  // One per voice a vote carried, indexed by principal — which is what turns "what was
  // cast in my name?" into a single filtered query instead of a scan of every vote.
  {
    type: "event",
    name: "VoteCastOnBehalf",
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "principal", type: "address", indexed: true },
      { name: "voter", type: "address", indexed: true },
      { name: "weight", type: "uint256", indexed: false },
    ],
  },
  { type: "function", name: "state", stateMutability: "view", inputs: [{ name: "proposalId", type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "hasVoted", stateMutability: "view", inputs: [{ name: "proposalId", type: "uint256" }, { name: "account", type: "address" }], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "proposalVotes",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
  },
  { type: "function", name: "votingDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MAX_DOMAIN_PATH", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/** Records which domain a proposal belongs to, since an OZ proposal carries none. */
export const proposalDomainsAbi = [
  {
    type: "function",
    name: "scopeProposal",
    stateMutability: "nonpayable",
    inputs: [{ name: "proposalId", type: "uint256" }, { name: "domainId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "proposalDomain",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

/** The ERC20Votes weight is read from. A balance only counts once self-delegated. */
export const votesTokenAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getVotes", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "delegate", stateMutability: "nonpayable", inputs: [{ name: "delegatee", type: "address" }], outputs: [] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  // What the governor actually reads. `getVotes` is the current value and ERC-5805 refuses
  // to answer for the current block, so a checkpoint written in the newest block is
  // invisible here until the next one exists — which is the difference between the token
  // saying an account has weight and the governor agreeing.
  // The token's own clock, which is the only timepoint `getPastVotes` will accept. On this
  // chain it is NOT `eth_blockNumber`: see ADR 0026.
  { type: "function", name: "clock", stateMutability: "view", inputs: [], outputs: [{ type: "uint48" }] },
  {
    type: "function",
    name: "getPastVotes",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }, { name: "timepoint", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
