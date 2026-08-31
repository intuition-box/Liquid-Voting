/**
 * Casting a vote: planning which signed chains carry it, simulating, and submitting.
 */
import {
  decodeAbiParameters,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiItem,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { governorAbi, ozGovernorAbi, proposalDomainsAbi, votesTokenAbi } from "../chain/abis";
import { FRAMEWORK } from "../chain/network";
import { toHybridAccount } from "../chain/smart-accounts";
import { sendUserOp, type UserOpResult } from "../chain/user-op";
import type { AppConfig } from "../config/app-config";
import type { RedeemableChain } from "../delegation/delegation-set";
import {
  buildVoteCalldata,
  preflightRedeem,
  type Delegation,
  type PreflightResult,
} from "../delegation/encoding";
import type { DomainGraph, GraphLimits } from "../graph/domain-graph";
import type { PathResult } from "../graph/edges";
import { ROLES, type Role } from "../roles";

import { requireOwnerKey, submitterClient } from "./common";

export { VOTE_AGAINST, VOTE_FOR, VOTE_ABSTAIN } from "../delegation/encoding";

/** The governor's vote logs, as parsed items — getLogs infers its arg types from these. */
/**
 * OpenZeppelin's vote events. A vote that carries params emits the second one, which is
 * every delegated vote here, so both have to be read to see the whole tally. Note the
 * indexing: OZ indexes the voter, not the proposal, so these cannot be filtered by
 * proposal at the node and are grouped client-side instead.
 */
const VOTE_CAST = parseAbiItem(
  "event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)",
);
const VOTE_CAST_WITH_PARAMS = parseAbiItem(
  "event VoteCastWithParams(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason, bytes params)",
);
/** OZ does not index proposalId, so the id comes out of the event data. */
const PROPOSAL_CREATED = parseAbiItem(
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
);


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
 * Casts a vote for yourself, with no delegation involved.
 *
 * Nobody has to have delegated anything for an account to vote: it holds its own voice
 * whatever else is going on. This calls the governor directly rather than redeeming
 * through the DelegationManager, since there is no delegation to redeem and the caveat
 * has nothing to check.
 */
export async function submitOwnVote(
  client: PublicClient,
  config: AppConfig,
  role: Role,
  proposalId: bigint,
  support: number,
): Promise<UserOpResult> {
  return castOnGovernor(client, config, role, proposalId, support, [], []);
}

/**
 * Casts a vote on the OpenZeppelin governor, carrying whatever weight is claimed.
 *
 * OZ has one vote entry point that takes extra data, `castVoteWithReasonAndParams`, and
 * that is the channel the domain register reads: the params carry the proposal id, the
 * domain path and the principals whose weight is being claimed. The governor verifies the
 * path against the graph and ignores any principal that did not actually delegate, so an
 * over-claim costs nothing rather than succeeding.
 *
 * With no principals and no path, this is a plain vote for oneself.
 */
export async function castOnGovernor(
  client: PublicClient,
  config: AppConfig,
  role: Role,
  proposalId: bigint,
  support: number,
  principals: Role[],
  domainPath: Hex[],
): Promise<UserOpResult> {
  const account = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, role)));
  const params = encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes32[]" }, { type: "address[]" }],
    [proposalId, domainPath, principals.map((principal) => config.accounts[principal].smartAccount)],
  );
  return sendUserOp(client, submitterClient(config), account, [
    {
      to: config.governor,
      value: 0n,
      data: encodeFunctionData({
        abi: ozGovernorAbi,
        functionName: "castVoteWithReasonAndParams",
        args: [proposalId, support, "", params],
      }),
    },
  ]);
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
  config: AppConfig,
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
  config: AppConfig,
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
  config: AppConfig,
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
  config: AppConfig,
  plan: VotePlan,
): Promise<PreflightResult> {
  if (!plan.calldata) return { ok: false, revert: null, raw: plan.blocked ?? "no calldata" };
  return preflightRedeem(client, config.accounts[plan.redeemer].smartAccount, plan.calldata);
}

export async function submitVote(
  client: PublicClient,
  config: AppConfig,
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
  config: AppConfig,
  domainLabel: string,
  description: string,
): Promise<{ txHash: Hex; proposalId: bigint }> {
  const domainId = config.nodes.find((node) => node.label === domainLabel)?.termId;
  if (!domainId) throw new Error(`unknown domain “${domainLabel}”`);
  const wallet = submitterClient(config);
  const gov = { address: config.governor, abi: ozGovernorAbi } as const;

  // OpenZeppelin proposes a call to execute, not a subject. The call here is inert — the
  // demo is about who may vote, not about what a passed proposal does — so it targets the
  // governor with empty calldata, which is the smallest well-formed proposal.
  const txHash = await wallet.writeContract({
    ...gov,
    functionName: "propose",
    args: [[config.governor], [0n], ["0x"], description],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });

  // The id is a hash of that call, and OZ does not index it, so it comes back in the event.
  const created = receipt.logs
    .map((log) => {
      try {
        return decodeEventLog({ abi: [PROPOSAL_CREATED], data: log.data, topics: log.topics });
      } catch {
        return null;
      }
    })
    .find((entry) => entry !== null);
  const proposalId = (created?.args as { proposalId?: bigint } | undefined)?.proposalId;
  if (proposalId === undefined) throw new Error("the governor accepted the proposal but logged no id");

  // The domain lives beside the governor, because an OZ proposal has nowhere to keep it.
  const scoped = await wallet.writeContract({
    address: config.resolver,
    abi: proposalDomainsAbi,
    functionName: "scopeProposal",
    args: [proposalId, domainId],
  });
  await client.waitForTransactionReceipt({ hash: scoped });

  // Voting opens after a delay, so a fresh proposal is Pending and cannot be voted on
  // yet. Mine empty blocks until it turns Active.
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
 * chained to it: `authority` carries the upstream hash instead of which
 * is what makes the authority derive rather than stand on its own. The consequence is the
 * framework's, not ours — disabling a link kills everything below it, because every hash
 * beneath points at it.
 */
/**
 * What each identity holds of the governance token.
 *
 * On this governor weight is not assigned, it is held: `getVotes` reads the balance the
 * token will actually count, which stays zero until an account delegates to itself. The
 * two are reported apart because a balance that counts for nothing is a real state, and
 * one worth seeing rather than debugging.
 */
export async function readTokenHoldings(
  client: PublicClient,
  config: AppConfig,
): Promise<Record<Role, { balance: bigint; votes: bigint }>> {
  const entries = await Promise.all(
    ROLES.map(async (role) => {
      const account = config.accounts[role].smartAccount;
      const [balance, votes] = await Promise.all([
        client.readContract({ address: config.votesToken, abi: votesTokenAbi, functionName: "balanceOf", args: [account] }),
        client.readContract({ address: config.votesToken, abi: votesTokenAbi, functionName: "getVotes", args: [account] }),
      ]);
      return [role, { balance, votes }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<Role, { balance: bigint; votes: bigint }>;
}

export const PROPOSAL_STATES = ["pending", "active", "defeated", "succeeded", "executed"] as const;

/**
 * OpenZeppelin's ProposalState, mapped onto the states this app shows.
 *
 * Its enum is Pending, Active, Canceled, Defeated, Succeeded, Queued, Expired, Executed —
 * wider than ours, and in a different order. Canceled, Queued and Expired have no panel of
 * their own, so they read as the nearest thing the UI already knows how to draw.
 */
const OZ_PROPOSAL_STATES: ProposalState[] = [
  "pending",
  "active",
  "defeated", // Canceled
  "defeated",
  "succeeded",
  "succeeded", // Queued
  "defeated", // Expired
  "executed",
];
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

export async function readProposals(client: PublicClient, config: AppConfig, limit = 8): Promise<ProposalRecord[]> {
  // OpenZeppelin has no proposal counter and stores no struct: an id is a hash of the
  // call it would execute, and the details live in the event. So the list comes from
  // ProposalCreated, newest first, and the domain from the resolver beside the governor.
  const created = await client.getLogs({ address: config.governor, event: PROPOSAL_CREATED, fromBlock: "earliest" });
  const recent = created.slice(-limit).reverse();

  const records = await Promise.all(
    recent.map(async (log) => {
      const { proposalId, proposer, description } = log.args;
      if (proposalId === undefined || !proposer || description === undefined) return null;
      const [state, votes, domainId] = await Promise.all([
        client.readContract({ address: config.governor, abi: ozGovernorAbi, functionName: "state", args: [proposalId] }),
        client.readContract({ address: config.governor, abi: ozGovernorAbi, functionName: "proposalVotes", args: [proposalId] }),
        client.readContract({ address: config.resolver, abi: proposalDomainsAbi, functionName: "proposalDomain", args: [proposalId] }),
      ]);
      const [againstVotes, forVotes, abstainVotes] = votes;
      return {
        id: proposalId,
        domainId,
        proposer,
        description,
        state: OZ_PROPOSAL_STATES[state] ?? "pending",
        forVotes,
        againstVotes,
        abstainVotes,
      } satisfies ProposalRecord;
    }),
  );
  return records.filter((record): record is ProposalRecord => record !== null);
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
 * Who voted on every proposal, in one pass.
 *
 * `readBallots` asks per proposal, which is fine for one open row and wasteful for a
 * page of them. This reads the governor's whole log once and files each vote under its
 * own proposal — a vote on one proposal must never look like a vote on another, which is
 * exactly what a per-row read made easy to get wrong.
 */
export async function readAllBallots(
  client: PublicClient,
  config: AppConfig,
): Promise<Record<string, Ballot[]>> {
  const roleOf = (address: `0x${string}`): Role | null =>
    ROLES.find((role) => config.accounts[role].smartAccount.toLowerCase() === address.toLowerCase()) ?? null;

  const [plain, withParams] = await Promise.all([
    client.getLogs({ address: config.governor, event: VOTE_CAST, fromBlock: "earliest" }),
    client.getLogs({ address: config.governor, event: VOTE_CAST_WITH_PARAMS, fromBlock: "earliest" }),
  ]);

  const out: Record<string, Ballot[]> = {};
  for (const log of [...plain, ...withParams]) {
    const { voter, proposalId, support, weight } = log.args;
    if (!voter || proposalId === undefined || support === undefined || weight === undefined) continue;

    // The params say whose weight was claimed. The governor only counts a principal that
    // actually delegated, so the split is derived from the weight rather than the claim:
    // the voter's own is what one account holds, the rest rode along.
    const own = await client.readContract({
      address: config.votesToken,
      abi: votesTokenAbi,
      functionName: "getVotes",
      args: [voter],
    });
    const carriedWeight = weight > own ? weight - own : 0n;

    const entries: BallotEntry[] = [
      { principal: roleOf(voter), principalAddress: voter, carriedBy: roleOf(voter), carriedByAddress: voter, weight: own },
    ];
    if (carriedWeight > 0n) {
      const principals = "params" in log.args ? decodeClaimedPrincipals(log.args.params as Hex) : [];
      for (const principal of principals) {
        if (principal.toLowerCase() === voter.toLowerCase()) continue;
        const share = await client.readContract({
          address: config.votesToken,
          abi: votesTokenAbi,
          functionName: "getVotes",
          args: [principal],
        });
        if (share === 0n) continue;
        entries.push({
          principal: roleOf(principal),
          principalAddress: principal,
          carriedBy: roleOf(voter),
          carriedByAddress: voter,
          weight: share,
        });
      }
    }
    (out[proposalId.toString()] ??= []).push({ support: Number(support), entries, total: weight });
  }
  return out;
}

/** The principals a vote claimed, out of the params it carried. */
function decodeClaimedPrincipals(params: Hex): `0x${string}`[] {
  try {
    const [, , principals] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32[]" }, { type: "address[]" }],
      params,
    );
    return [...principals];
  } catch {
    return [];
  }
}

/**
 * Who voted on one proposal, and for whom.
 *
 * OpenZeppelin indexes the voter rather than the proposal, so its vote logs cannot be
 * filtered by proposal at the node. This reads them all and keeps the one asked for,
 * which is why a page showing many rows should call `readAllBallots` once instead.
 */
export async function readBallots(
  client: PublicClient,
  config: AppConfig,
  proposalId: bigint,
): Promise<Ballot[]> {
  const all = await readAllBallots(client, config);
  return all[proposalId.toString()] ?? [];
}

/**
 * The weight each role would cast on a domain, read from the governor.
 *
 * The governor is the authority here: it holds the delegation register, so this is the
 * same number the vote path enforces rather than a UI guess.
 */
export async function readWeights(
  client: PublicClient,
  config: AppConfig,
  domainId: Hex,
  domainPath: Hex[] = [],
): Promise<Record<Role, bigint>> {
  const all = ROLES.map((role) => config.accounts[role].smartAccount);
  const weights = await Promise.all(
    ROLES.map((role) =>
      client.readContract({
        address: config.governor,
        abi: ozGovernorAbi,
        functionName: "weightFor",
        args: [config.accounts[role].smartAccount, domainId, all, domainPath],
      }),
    ),
  );
  return Object.fromEntries(ROLES.map((role, index) => [role, weights[index] ?? 0n])) as Record<Role, bigint>;
}

/**
 * Who the governor currently has each account delegating to, per domain.
 *
 * The register is the authority on weight: a signed delegation says the delegate MAY
 * vote, this says whose weight it actually carries. Read for the domains a delegation
 * could be scoped to, which is all the UI needs to know whether a seeded pair is live.
 */
export async function readDelegatedTo(
  client: PublicClient,
  config: AppConfig,
  scopes: string[],
): Promise<Record<string, Partial<Record<Role, Role>>>> {
  const addressOf = new Map(ROLES.map((role) => [config.accounts[role].smartAccount.toLowerCase(), role]));
  const pairs = scopes.flatMap((scope) => ROLES.map((role) => ({ scope, role })));
  const held = await Promise.all(
    pairs.map(async ({ scope, role }) => {
      const domainId = config.nodes.find((node) => node.label === scope)?.termId;
      if (!domainId) return null;
      const to = await client.readContract({
        address: config.governor,
        abi: governorAbi,
        functionName: "delegatedTo",
        args: [config.accounts[role].smartAccount, domainId],
      });
      return addressOf.get(to.toLowerCase()) ?? null;
    }),
  );
  const out: Record<string, Partial<Record<Role, Role>>> = {};
  pairs.forEach(({ scope, role }, index) => {
    const to = held[index];
    if (to) (out[scope] ??= {})[role] = to;
  });
  return out;
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
export async function readGraphLimits(client: PublicClient, config: AppConfig): Promise<GraphLimits> {
  const maxDomainPath = await client.readContract({
    address: config.governor,
    abi: governorAbi,
    functionName: "MAX_DOMAIN_PATH",
  });
  return { maxDomainPath: Number(maxDomainPath) };
}
