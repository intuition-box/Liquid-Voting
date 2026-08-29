/**
 * Demo actions — the service layer behind the panels. No React, no DOM: every function
 * takes the config plus its inputs and returns data. Hooks own the lifecycle.
 */
import { createWalletClient, encodeFunctionData, http, parseAbiItem, stringToHex, toHex, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";

import { delegationManagerAbi, governorAbi, multiVaultAbi } from "./abis";
import { FRAMEWORK, intuitionTestnet } from "./chain";
import {
  buildDisableCalldata,
  buildVoteCalldata,
  encodeTerms,
  preflightRedeem,
  type Delegation,
  type PreflightResult,
} from "./delegation";
import type { DemoConfig, Role } from "./demo-config";
import type { RedeemableChain } from "./delegation-set";
import { ROLES } from "./grants";

/** The governor's vote logs, as parsed items — getLogs infers its arg types from these. */
const VOTE_CAST = parseAbiItem(
  "event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 weight, address[] principals)",
);
const VOTE_ON_BEHALF = parseAbiItem(
  "event VoteCastOnBehalf(uint256 indexed proposalId, address indexed principal, address indexed representative, uint256 weight)",
);
import { DomainGraph, type GraphLimits } from "./domain-graph";
import { type PathResult } from "./graph";
import { toHybridAccount } from "./smart-accounts";
import { sendUserOp, type UserOpResult } from "./user-op";

/**
 * Narrows an owner key at the point of use. Lives here rather than in demo-config so this
 * module stays importable from Node/bun scripts — demo-config is browser-only.
 */
function requireOwnerKey(config: DemoConfig, role: Role): `0x${string}` {
  const key = config.ownerKeys[role];
  if (!key) throw new Error(`no ${role} owner key — this is a read-only build (see ADR 0011)`);
  return key;
}

export { VOTE_AGAINST, VOTE_FOR, VOTE_ABSTAIN } from "./delegation";

/** Hop cap written into every delegation signed from the UI — deep enough for the demo graph. */
const DEFAULT_MAX_DEPTH = 3;

export interface VotePlan {
  /** The account that must be `msg.sender` at the DelegationManager, and the recorded voter. */
  redeemer: Role;
  /** One chain per voice carried, each with a witness per link. */
  chains: { chain: Delegation[]; witnesses: Hex[][] }[];
  /** Per-link path computation, flattened across voices, for the UI to show its work. */
  paths: { rootLabel: string; result: PathResult }[];
  /** Whose voting power rides along with the redeemer's own. */
  principals: Role[];
  calldata: Hex | null;
  /** Set when a link could not produce a witness — nothing to submit. */
  blocked: string | null;
}

/**
 * Plans a delegated vote through the delegations that were actually signed.
 *
 * A holder carrying two voices redeems two chains, not one. Each is planned on its own —
 * its own links, its own witnesses — because the DelegationManager validates each
 * permission context independently. That independence is the point: a voice whose
 * upstream was revoked drops out without taking the others with it.
 *
 * One witness is computed per link, each against its own scope, since every level carries
 * its own caveat and is verified against its own signer's scope (ADR 0007). Path
 * discovery is client-side (ADR 0003) and surfaced step by step so the UI can show it
 * rather than hide it behind a spinner.
 */
export function planVote(
  config: DemoConfig,
  graph: DomainGraph,
  resolved: RedeemableChain,
  domainLabel: string,
  proposalId: bigint,
  support: number,
): VotePlan {
  const { redeemer, voices, principals } = resolved;
  const planned = voices.map((voice) => ({
    voice,
    paths: voice.scopes.map((rootLabel) => ({ rootLabel, result: graph.pathTo(domainLabel, rootLabel) })),
  }));
  const paths = planned.flatMap((entry) => entry.paths);
  const chains = planned.map((entry) => ({
    chain: entry.voice.chain as Delegation[],
    witnesses: entry.paths.map((path) => (path.result.found ? path.result.path : [])),
  }));
  const base = { redeemer, chains, paths, principals };

  const blockedAt = paths.find((entry) => !entry.result.found);
  if (blockedAt && !blockedAt.result.found) {
    return { ...base, calldata: null, blocked: `no witness up to “${blockedAt.rootLabel}”: ${blockedAt.result.reason}` };
  }
  return { ...base, calldata: encodeVote(config, chains, redeemer, principals, proposalId, support), blocked: null };
}

/** Encodes the redemption of a delegated vote for the given chains and witnesses. */
function encodeVote(
  config: DemoConfig,
  chains: { chain: Delegation[]; witnesses: Hex[][] }[],
  redeemer: Role,
  principals: Role[],
  proposalId: bigint,
  support: number,
): Hex {
  // The governor needs the same path the caveats verify: a grant on a parent domain
  // covers this proposal, and the path is what proves the parent relation. Every chain
  // climbs to the same proposal domain, so the first one's top witness speaks for all.
  const witnesses = chains[0]?.witnesses ?? [];
  return buildVoteCalldata({
    chains,
    governor: config.governor,
    proposalId,
    support,
    voter: config.accounts[redeemer].smartAccount,
    principals: principals.map((role) => config.accounts[role].smartAccount),
    domainPath: witnesses[witnesses.length - 1] ?? [],
  });
}

/**
 * Builds a vote even when a level has no witness, by falling back to a direct
 * [domain, root] guess. Used to demonstrate live failures (`legal`, narrowing): the
 * chain still gets a syntactically valid witness, and the enforcer rejects it on chain
 * for the real reason instead of the UI refusing to try.
 */
export function planVoteForcingWitness(
  config: DemoConfig,
  graph: DomainGraph,
  resolved: RedeemableChain,
  domainLabel: string,
  proposalId: bigint,
  support: number,
): VotePlan {
  const plan = planVote(config, graph, resolved, domainLabel, proposalId, support);
  if (!plan.blocked) return plan;

  const domainId = graph.termId(domainLabel);
  if (!domainId) return plan;

  const forced = (entry: { rootLabel: string; result: PathResult }): Hex[] => {
    if (entry.result.found) return entry.result.path;
    const rootId = graph.termId(entry.rootLabel);
    return rootId && rootId !== domainId ? [domainId, rootId] : [domainId];
  };
  // Rebuild each chain's witnesses in place, so a voice that has one keeps it and only
  // the missing ones are guessed at.
  let cursor = 0;
  const chains = plan.chains.map(({ chain }) => {
    const witnesses = chain.map(() => forced(plan.paths[cursor++]!));
    return { chain, witnesses };
  });
  return {
    ...plan,
    chains,
    calldata: encodeVote(config, chains, plan.redeemer, plan.principals, proposalId, support),
  };
}

export async function preflightVote(
  client: PublicClient,
  config: DemoConfig,
  plan: VotePlan,
): Promise<PreflightResult> {
  if (!plan.calldata) return { ok: false, revert: null, raw: plan.blocked ?? "no calldata" };
  return preflightRedeem(client, config.accounts[plan.redeemer].smartAccount, plan.calldata);
}

function submitterClient(config: DemoConfig) {
  return createWalletClient({
    chain: intuitionTestnet,
    transport: http(config.rpcUrl),
    account: privateKeyToAccount(config.submitterKey),
  });
}

export async function submitVote(
  client: PublicClient,
  config: DemoConfig,
  plan: VotePlan,
): Promise<UserOpResult> {
  if (!plan.calldata) throw new Error(plan.blocked ?? "nothing to submit");
  const account = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, plan.redeemer)));
  return sendUserOp(client, submitterClient(config), account, [
    { to: FRAMEWORK.delegationManager, value: 0n, data: plan.calldata },
  ]);
}

/**
 * Records a proposal from the submitter EOA. Proposing needs no delegation — anyone may
 * propose in their own name — so this is a plain transaction, deliberately outside the
 * caveat. It exists so the demo has something to vote on.
 */
export async function recordProposal(
  client: PublicClient,
  config: DemoConfig,
  domainLabel: string,
  description: string,
): Promise<{ txHash: Hex; proposalId: bigint }> {
  const domainId = config.nodes.find((node) => node.label === domainLabel)?.termId;
  if (!domainId) throw new Error(`unknown domain “${domainLabel}”`);
  const gov = { address: config.governor, abi: governorAbi } as const;
  const proposalId = await client.readContract({ ...gov, functionName: "proposalCount" });
  const wallet = submitterClient(config);
  const txHash = await wallet.writeContract({ ...gov, functionName: "propose", args: [domainId, description] });
  await client.waitForTransactionReceipt({ hash: txHash });

  // Voting opens VOTING_DELAY blocks after the proposal, so a fresh proposal is Pending
  // and cannot be voted on yet. Mine empty blocks until it turns Active.
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await client.readContract({ ...gov, functionName: "state", args: [proposalId] });
    if (state !== 0) break;
    const filler = await wallet.sendTransaction({ to: wallet.account.address, value: 0n });
    await client.waitForTransactionReceipt({ hash: filler });
  }
  return { txHash, proposalId };
}

/**
 * Signs a fresh delegation from one demo account to another, scoped to a domain.
 *
 * Nothing is sent to the chain: a delegation is a signed object, and it only reaches the
 * DelegationManager when someone redeems it. The signature is verified against the
 * delegator's account (EIP-1271) before it is returned, so an invalid grant fails here
 * rather than at redemption time.
 *
 * When the signer holds this domain through a delegation of its own, the new grant is
 * chained to it: `authority` carries the upstream hash instead of ROOT_AUTHORITY, which
 * is what makes the authority derive rather than stand on its own. The consequence is the
 * framework's, not ours — disabling a link kills everything below it, because every hash
 * beneath points at it.
 */
export async function signDelegation(
  client: PublicClient,
  config: DemoConfig,
  from: Role,
  to: Role,
  domainLabel: string,
  /** The domain and its parents, so the governor can refuse one already covered. */
  domainPath: Hex[] = [],
  /** The delegations the signer already holds on this domain, one per voice it carries. */
  upstream: (Delegation & { hash: Hex })[] = [],
): Promise<(Delegation & { hash: Hex })[]> {
  const domainId = config.nodes.find((node) => node.label === domainLabel)?.termId;
  if (!domainId) throw new Error(`unknown domain “${domainLabel}”`);

  const delegator = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, from)));
  const signerAccount = config.accounts[from].smartAccount;

  // The manager walks a chain leaf to root and requires each link's delegator to be the
  // next one's delegate, so only an upstream that hands over to this signer can be relayed.
  const relayable = upstream.filter(
    (held) => held.delegate.toLowerCase() === signerAccount.toLowerCase(),
  );

  // One delegation per voice: the signer's own, plus one relaying each voice it was
  // lent. Bundling them into a single object would tie the signer's own voice to
  // authority it merely borrowed — revoking upstream would then silence a voice that
  // was never the upstream's to take back. A voice keeps belonging to whoever cast it.
  const authorities: Hex[] = [ROOT_AUTHORITY, ...relayable.map((held) => held.hash)];

  const signed: (Delegation & { hash: Hex })[] = [];
  for (const [index, authority] of authorities.entries()) {
    const delegation: Delegation = {
      delegate: config.accounts[to].smartAccount,
      delegator: signerAccount,
      authority,
      caveats: [
        {
          enforcer: config.enforcer,
          terms: encodeTerms({
            rootDomainId: domainId,
            predicateId: config.predicate.termId,
            maxDepth: DEFAULT_MAX_DEPTH,
            expiry: 0n,
            attestor: config.attestor,
          }),
          args: "0x",
        },
      ],
      // disableDelegation blacklists a hash forever, so every delegation needs its own
      // salt — including the siblings signed in this same call.
      salt: toHex(BigInt(Date.now()) * 1000n + BigInt(index)),
      signature: "0x",
    };
    delegation.signature = await delegator.signDelegation({ delegation });
    const hash = await client.readContract({
      address: FRAMEWORK.delegationManager,
      abi: delegationManagerAbi,
      functionName: "getDelegationHash",
      args: [{ ...delegation, salt: BigInt(delegation.salt) }],
    });
    signed.push({ ...delegation, hash });
  }

  // The signatures say the delegate MAY vote on this domain; the governor's register says
  // whose weight it carries. Recording the transfer is what makes the delegator stop
  // counting on this domain and the delegate count for both. One transfer, however many
  // voices moved: the register tracks the holder, the signatures track the authority.
  const op = await sendUserOp(client, submitterClient(config), delegator, [
    {
      to: config.governor,
      value: 0n,
      data: encodeFunctionData({
        abi: governorAbi,
        functionName: "delegateWeight",
        args: [config.accounts[to].smartAccount, domainId, domainPath],
      }),
    },
  ]);
  if (!op.success) {
    throw new Error(op.revert ? `weight transfer reverted: ${op.revert.formatted}` : "weight transfer reverted");
  }

  return signed;
}

/**
 * Clears a weight delegation on one domain, so it can be granted elsewhere.
 *
 * A domain has one holder at a time: the governor refuses a second grant while the first
 * stands, which is what stops weight being moved out from under a delegate silently.
 * Revoking is the way back.
 */
export async function revokeWeight(
  client: PublicClient,
  config: DemoConfig,
  from: Role,
  domainLabel: string,
): Promise<UserOpResult> {
  const domainId = config.nodes.find((node) => node.label === domainLabel)?.termId;
  if (!domainId) throw new Error(`unknown domain “${domainLabel}”`);
  const account = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, from)));
  return sendUserOp(client, submitterClient(config), account, [
    {
      to: config.governor,
      value: 0n,
      data: encodeFunctionData({
        abi: governorAbi,
        functionName: "delegateWeight",
        args: ["0x0000000000000000000000000000000000000000", domainId, []],
      }),
    },
  ]);
}

/** The voter disables its root delegation — framework-native, kills the whole chain. */
export async function revokeRoot(client: PublicClient, config: DemoConfig): Promise<UserOpResult> {
  const voter = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, "voter")));
  return sendUserOp(client, submitterClient(config), voter, [
    { to: FRAMEWORK.delegationManager, value: 0n, data: buildDisableCalldata(config.delegations.root) },
  ]);
}

/**
 * The governor's own path cap, read rather than copied.
 *
 * The constant stays on chain because that is where it does its work: it bounds the
 * verification loops against a hand-crafted path, and a bound the caller can talk the
 * contract out of is not a bound. Reading it here only lets the UI decline a trip the
 * contract would refuse anyway — the same rule the seeder follows for atom cost and
 * curve id: query, never hardcode.
 */
export async function readGraphLimits(client: PublicClient, config: DemoConfig): Promise<GraphLimits> {
  const maxDomainPath = await client.readContract({
    address: config.governor,
    abi: governorAbi,
    functionName: "MAX_DOMAIN_PATH",
  });
  return { maxDomainPath: Number(maxDomainPath) };
}

/** Lifecycle states, in the governor's enum order. */
export const PROPOSAL_STATES = ["pending", "active", "defeated", "succeeded", "executed"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

export interface ProposalRecord {
  id: bigint;
  domainId: Hex;
  proposer: `0x${string}`;
  description: string;
  state: ProposalState;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
}

export async function readProposals(client: PublicClient, config: DemoConfig, limit = 8): Promise<ProposalRecord[]> {
  const gov = { address: config.governor, abi: governorAbi } as const;
  const count = await client.readContract({ ...gov, functionName: "proposalCount" });
  const ids: bigint[] = [];
  for (let id = count - 1n; id >= 0n && ids.length < limit; id--) ids.push(id);
  return Promise.all(
    ids.map(async (id) => {
      const [proposal, state] = await Promise.all([
        client.readContract({ ...gov, functionName: "getProposal", args: [id] }),
        client.readContract({ ...gov, functionName: "state", args: [id] }),
      ]);
      return {
        id,
        domainId: proposal.domainId,
        proposer: proposal.proposer,
        description: proposal.description,
        state: PROPOSAL_STATES[state] ?? "pending",
        forVotes: proposal.forVotes,
        againstVotes: proposal.againstVotes,
        abstainVotes: proposal.abstainVotes,
      };
    }),
  );
}

/** One account's weight inside a vote, and who actually carried it to the governor. */
export interface BallotEntry {
  /** Whose weight this is. */
  principal: Role | null;
  principalAddress: `0x${string}`;
  /** Who submitted it — the same account when the principal voted for itself. */
  carriedBy: Role | null;
  carriedByAddress: `0x${string}`;
  weight: bigint;
}

/** Every ballot on one proposal, broken down by whose voice each share of it was. */
export interface Ballot {
  support: number;
  entries: BallotEntry[];
  total: bigint;
}

/**
 * Who voted on a proposal, and for whom.
 *
 * Read from the governor's own logs rather than reconstructed: `VoteCast` carries the
 * total and the accounts represented, and one `VoteCastOnBehalf` per principal says whose
 * voice each share was. The contract already records the split, so a delegated vote can
 * be read back voice by voice instead of appearing as one larger number.
 */
export async function readBallots(
  client: PublicClient,
  config: DemoConfig,
  proposalId: bigint,
): Promise<Ballot[]> {
  const roleOf = (address: `0x${string}`): Role | null =>
    ROLES.find(
      (role) => config.accounts[role].smartAccount.toLowerCase() === address.toLowerCase(),
    ) ?? null;

  const [cast, onBehalf] = await Promise.all([
    client.getLogs({ address: config.governor, event: VOTE_CAST, args: { proposalId }, fromBlock: "earliest" }),
    client.getLogs({ address: config.governor, event: VOTE_ON_BEHALF, args: { proposalId }, fromBlock: "earliest" }),
  ]);

  return cast.flatMap((log) => {
    const { voter, support, weight } = log.args;
    if (!voter || support === undefined || weight === undefined) return [];
    // The delegated shares are logged separately; what is left is the voter's own.
    const carried = onBehalf
      .map((entry) => entry.args)
      .filter(
        (entry): entry is { principal: `0x${string}`; representative: `0x${string}`; weight: bigint } =>
          entry.principal !== undefined &&
          entry.weight !== undefined &&
          entry.representative?.toLowerCase() === voter.toLowerCase(),
      );
    const own = weight - carried.reduce((sum, entry) => sum + entry.weight, 0n);

    const entries: BallotEntry[] = [
      { principal: roleOf(voter), principalAddress: voter, carriedBy: roleOf(voter), carriedByAddress: voter, weight: own },
      ...carried.map((entry) => ({
        principal: roleOf(entry.principal),
        principalAddress: entry.principal,
        carriedBy: roleOf(voter),
        carriedByAddress: voter,
        weight: entry.weight,
      })),
    ];
    return [{ support: Number(support), entries, total: weight }];
  });
}

/**
 * The weight each role would cast on a domain, read from the governor.
 *
 * The governor is the authority here: it holds the delegation register, so this is the
 * same number the vote path enforces rather than a UI guess.
 */
export async function readWeights(
  client: PublicClient,
  config: DemoConfig,
  domainId: Hex,
  domainPath: Hex[] = [],
): Promise<Record<Role, bigint>> {
  const roles: Role[] = ["voter", "delegate", "executor"];
  const all = roles.map((role) => config.accounts[role].smartAccount);
  const weights = await Promise.all(
    roles.map((role) =>
      client.readContract({
        address: config.governor,
        abi: governorAbi,
        functionName: "weightFor",
        args: [config.accounts[role].smartAccount, domainId, all, domainPath],
      }),
    ),
  );
  return { voter: weights[0] ?? 0n, delegate: weights[1] ?? 0n, executor: weights[2] ?? 0n };
}

export interface ExtendResult {
  label: string;
  atomId: Hex;
  tripleId: Hex;
  atomTx: Hex | null;
  tripleTx: Hex | null;
  stakeTx: Hex;
  shares: bigint;
}

/**
 * The money shot: create a brand-new domain atom, link it under an existing parent, and
 * stake it — after which a delegation signed earlier authorizes a domain that did not
 * exist at signing time. No redeploy, no re-signature. Idempotent per step.
 */
export async function extendGraph(
  client: PublicClient,
  config: DemoConfig,
  label: string,
  parentLabel: string,
  stakeWei: bigint,
): Promise<ExtendResult> {
  const parentId = config.nodes.find((node) => node.label === parentLabel)?.termId;
  if (!parentId) throw new Error(`unknown parent domain “${parentLabel}”`);

  const wallet = submitterClient(config);
  const vault = { address: config.multiVault, abi: multiVaultAbi } as const;
  const data = stringToHex(label);

  const atomId = await client.readContract({ ...vault, functionName: "calculateAtomId", args: [data] });
  let atomTx: Hex | null = null;
  if (!(await client.readContract({ ...vault, functionName: "isTermCreated", args: [atomId] }))) {
    const atomCost = await client.readContract({ ...vault, functionName: "getAtomCost" });
    atomTx = await wallet.writeContract({ ...vault, functionName: "createAtoms", args: [[data], [atomCost]], value: atomCost });
    await client.waitForTransactionReceipt({ hash: atomTx });
  }

  const tripleId = await client.readContract({
    ...vault,
    functionName: "calculateTripleId",
    args: [atomId, config.predicate.termId, parentId],
  });
  let tripleTx: Hex | null = null;
  if (!(await client.readContract({ ...vault, functionName: "isTermCreated", args: [tripleId] }))) {
    const tripleCost = await client.readContract({ ...vault, functionName: "getTripleCost" });
    tripleTx = await wallet.writeContract({
      ...vault,
      functionName: "createTriples",
      args: [[atomId], [config.predicate.termId], [parentId], [tripleCost]],
      value: tripleCost,
    });
    await client.waitForTransactionReceipt({ hash: tripleTx });
  }

  const stakeTx = await wallet.writeContract({
    ...vault,
    functionName: "deposit",
    args: [config.attestor, tripleId, config.curveId, 0n],
    value: stakeWei,
  });
  await client.waitForTransactionReceipt({ hash: stakeTx });

  const shares = await client.readContract({
    ...vault,
    functionName: "getShares",
    args: [config.attestor, tripleId, config.curveId],
  });
  if (shares === 0n) throw new Error("stake did not register — the edge would authorize nothing");

  return { label, atomId, tripleId, atomTx, tripleTx, stakeTx, shares };
}
