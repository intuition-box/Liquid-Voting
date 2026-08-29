/**
 * Casting a vote: planning which signed chains carry it, simulating, and submitting.
 */
import { parseAbiItem, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { governorAbi } from "../chain/abis";
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
const VOTE_CAST = parseAbiItem(
  "event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 weight, address[] principals)",
);
const VOTE_ON_BEHALF = parseAbiItem(
  "event VoteCastOnBehalf(uint256 indexed proposalId, address indexed principal, address indexed representative, uint256 weight)",
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
 * chained to it: `authority` carries the upstream hash instead of which
 * is what makes the authority derive rather than stand on its own. The consequence is the
 * framework's, not ours — disabling a link kills everything below it, because every hash
 * beneath points at it.
 */
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

export async function readProposals(client: PublicClient, config: AppConfig, limit = 8): Promise<ProposalRecord[]> {
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
  config: AppConfig,
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
  config: AppConfig,
  domainId: Hex,
  domainPath: Hex[] = [],
): Promise<Record<Role, bigint>> {
  const all = ROLES.map((role) => config.accounts[role].smartAccount);
  const weights = await Promise.all(
    ROLES.map((role) =>
      client.readContract({
        address: config.governor,
        abi: governorAbi,
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
