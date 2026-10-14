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
import type { RedeemableChain, VoiceChain } from "../delegation/delegation-set";
import {
  buildVoteCalldata,
  preflightRedeem,
  type Delegation,
  type PreflightResult,
} from "../delegation/encoding";
import type { DomainGraph, GraphLimits } from "../graph/domain-graph";
import type { PathResult } from "../graph/edges";
import { ROLES, type Role } from "../roles";

import { logStep, settleStep, trackTransaction } from "../chain/tx-log";
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
  return castOnGovernor(client, config, role, proposalId, support, null, [], () => []);
}

/**
 * Casts a vote, redeeming the delegations that carry it.
 *
 * The two cases are genuinely different calls. Voting for oneself is a plain call to the
 * governor. Voting with borrowed voices goes through the DelegationManager, because that
 * is what puts `GraphDomainScope` on the path: the caveat resolves the proposal's domain
 * from the governor and rechecks every hop of the announced path against the graph before
 * the vote is ever reached. Nothing here proves the scope, and nothing here is trusted to.
 *
 * `castVoteFor` exists on our subclass for one reason: OZ's public entry points read the
 * voter from `_msgSender()`, and a redemption executes from the root delegator's account,
 * so a delegated vote would otherwise be recorded under the lender's name. The counting
 * itself is OZ's own `_castVote`, untouched.
 */
export async function castOnGovernor(
  client: PublicClient,
  config: AppConfig,
  role: Role,
  proposalId: bigint,
  support: number,
  carried: RedeemableChain | null,
  domainPath: Hex[],
  witnesses: (chain: VoiceChain) => Hex[][],
): Promise<UserOpResult> {
  const account = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, role)));
  const voter = config.accounts[role].smartAccount;

  const data = carried
    ? buildVoteCalldata({
        chains: carried.voices.map((voice) => ({ chain: voice.chain, witnesses: witnesses(voice) })),
        governor: config.governor,
        proposalId,
        support,
        voter,
        principals: carried.principals.map((principal) => config.accounts[principal].smartAccount),
        domainPath,
      })
    : encodeFunctionData({
        abi: ozGovernorAbi,
        functionName: "castVoteWithReasonAndParams",
        args: [proposalId, support, "", encodeAbiParameters(
          [{ type: "uint256" }, { type: "bytes32[]" }, { type: "address[]" }],
          [proposalId, domainPath, [voter]],
        )],
      });

  const principals = carried ? carried.principals : [];
  const borrowed = principals.filter((principal) => principal !== role);
  return sendUserOp(
    client,
    submitterClient(config),
    account,
    [{ to: carried ? FRAMEWORK.delegationManager : config.governor, value: 0n, data }],
    {
      actor: role,
      label: borrowed.length
        ? `${role} votes, carrying ${borrowed.join(" and ")}`
        : `${role} votes with its own weight`,
      detail: carried
        ? "Through the DelegationManager, which is what puts the caveat on the path: it rechecks every hop of the announced domain path against the graph before the governor is reached."
        : "Straight to the governor. There is no delegation to redeem, so there is nothing for a caveat to check.",
      calls: carried
        ? [
            {
              contract: "DelegationManager",
              address: FRAMEWORK.delegationManager,
              fn: "redeemDelegations(bytes[],ModeCode[],bytes[])",
              args: {
                chains: String(carried.voices.length),
                links: String(carried.voices.reduce((total, voice) => total + voice.chain.length, 0)),
                caveat: `GraphDomainScope · ${config.enforcer}`,
              },
            },
            {
              contract: "OZGovernor",
              address: config.governor,
              fn: "castVoteFor(uint256,uint8,address,address[],bytes32[])",
              args: {
                proposal: proposalId.toString(),
                support: SUPPORT_NAMES[support] ?? String(support),
                voter: `${role} · ${voter}`,
                principals: principals.join(", ") || "—",
                path: `${domainPath.length} hop${domainPath.length === 1 ? "" : "s"}`,
              },
            },
          ]
        : [
            {
              contract: "OZGovernor",
              address: config.governor,
              fn: "castVoteWithReasonAndParams(uint256,uint8,string,bytes)",
              args: {
                proposal: proposalId.toString(),
                support: SUPPORT_NAMES[support] ?? String(support),
                params: "(proposalId, domainPath, [self])",
              },
            },
          ],
    },
  );
}

/** How `GovernorCountingSimple` numbers the three options, for a log a human reads. */
const SUPPORT_NAMES: Record<number, string> = { 0: "Against", 1: "For", 2: "Abstain" };

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
  const borrowed = plan.principals.filter((principal) => principal !== plan.redeemer);
  return sendUserOp(
    client,
    submitterClient(config),
    account,
    [{ to: FRAMEWORK.delegationManager, value: 0n, data: plan.calldata }],
    {
      actor: plan.redeemer,
      label: borrowed.length
        ? `${plan.redeemer} votes, carrying ${borrowed.join(" and ")}`
        : `${plan.redeemer} redeems its own delegation to vote`,
      detail:
        "One chain redeemed per voice carried, each validated on its own: a voice whose upstream was revoked drops out without taking the others down with it.",
      calls: [
        {
          contract: "DelegationManager",
          address: FRAMEWORK.delegationManager,
          fn: "redeemDelegations(bytes[],ModeCode[],bytes[])",
          args: {
            chains: String(plan.chains.length),
            links: String(plan.chains.reduce((total, entry) => total + entry.chain.length, 0)),
            witnesses: plan.paths.map((entry) => `${entry.rootLabel}:${entry.result.found ? entry.result.path.length : 0}`).join(" "),
          },
        },
        {
          contract: "OZGovernor",
          address: config.governor,
          fn: "castVoteFor(uint256,uint8,address,address[],bytes32[])",
          args: { voter: plan.redeemer, principals: plan.principals.join(", ") },
        },
      ],
    },
  );
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
  const proposeStep = logStep({
    kind: "tx",
    actor: wallet.account.address,
    label: `a proposal is recorded on “${domainLabel}”`,
    detail:
      "A plain transaction from the submitter EOA. Proposing needs no delegation — anyone may propose in their own name — so it sits deliberately outside the caveat.",
    calls: [
      {
        contract: "OZGovernor",
        address: config.governor,
        fn: "propose(address[],uint256[],bytes[],string)",
        args: { description, call: "the governor itself, with empty calldata" },
      },
    ],
  });
  const txHash = await wallet.writeContract({
    ...gov,
    functionName: "propose",
    args: [[config.governor], [0n], ["0x"], description],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  settleStep(proposeStep, {
    status: receipt.status === "success" ? "done" : "failed",
    hash: txHash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    cost: receipt.gasUsed * receipt.effectiveGasPrice,
  });

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
  await trackTransaction(
    client,
    {
      actor: wallet.account.address,
      label: `“${domainLabel}” is recorded as that proposal's domain`,
      detail:
        "Beside the governor rather than on the proposal: OpenZeppelin's `propose` has no field for a domain, and adding one would mean forking the audited contract.",
      calls: [
        {
          contract: "ProposalDomains",
          address: config.resolver,
          fn: "scopeProposal(uint256,bytes32)",
          args: { proposal: proposalId.toString(), domain: `${domainLabel} · ${domainId}` },
        },
      ],
    },
    () =>
      wallet.writeContract({
        address: config.resolver,
        abi: proposalDomainsAbi,
        functionName: "scopeProposal",
        args: [proposalId, domainId],
      }),
  );

  // Voting opens after a delay, so a fresh proposal is Pending and cannot be voted on
  // yet. Mine empty blocks until it turns Active.
  const miningStep = logStep({
    kind: "tx",
    actor: wallet.account.address,
    label: "empty blocks are mined until the proposal opens",
    detail:
      "The governor's voting delay is counted in blocks, and a chain with no traffic produces none. One self-send per block is the cheapest way to make time pass.",
    calls: [],
  });
  let mined = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await client.readContract({ ...gov, functionName: "state", args: [proposalId] });
    if (state !== 0) break;
    const filler = await wallet.sendTransaction({ to: wallet.account.address, value: 0n });
    await client.waitForTransactionReceipt({ hash: filler });
    mined += 1;
  }
  settleStep(miningStep, {
    status: "done",
    label: mined === 0 ? "the proposal was open already" : `${mined} empty block${mined === 1 ? "" : "s"} mined, the proposal is open`,
  });
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

    // Who carried what has to come from the register, not from balances. A lending can
    // be partial, so the gap between what an account holds and what it cast says nothing
    // about how much it lent: only the register knows.
    const claimed = "params" in log.args ? decodeClaimedPrincipals(log.args.params as Hex) : [];
    const domainId = "params" in log.args ? decodeClaimedDomain(log.args.params as Hex) : null;

    const carried: BallotEntry[] = [];
    for (const principal of claimed) {
      if (principal.toLowerCase() === voter.toLowerCase()) continue;
      if (!domainId) continue;
      const share = await lentToward(client, config, principal, voter, domainId);
      if (share === 0n) continue;
      carried.push({
        principal: roleOf(principal),
        principalAddress: principal,
        carriedBy: roleOf(voter),
        carriedByAddress: voter,
        weight: share,
      });
    }

    // Whatever the total is not accounted for by borrowed voices is the voter's own. It
    // is derived rather than read so the parts always add up to the number the governor
    // actually counted, even when a balance moved between the vote and this read.
    const borrowed = carried.reduce((sum, entry) => sum + entry.weight, 0n);
    const own = weight > borrowed ? weight - borrowed : 0n;

    const entries: BallotEntry[] = [
      { principal: roleOf(voter), principalAddress: voter, carriedBy: roleOf(voter), carriedByAddress: voter, weight: own },
      ...carried,
    ];
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

/** A domain's ancestors, by term id, nearest first. */
function ancestorTermIds(config: AppConfig, domainId: Hex): Hex[] {
  const labelOf = new Map(config.nodes.map((node) => [node.termId.toLowerCase(), node.label]));
  const parentOf = new Map(config.edges.map((edge) => [edge.child, edge.parent]));
  const idOf = new Map(config.nodes.map((node) => [node.label, node.termId]));

  const out: Hex[] = [];
  let label = labelOf.get(domainId.toLowerCase());
  // The graph is a tree in practice, but a cycle in the manifest must not hang the UI.
  const seen = new Set<string>();
  while (label && !seen.has(label)) {
    seen.add(label);
    label = parentOf.get(label);
    const id = label ? idOf.get(label) : undefined;
    if (id) out.push(id);
  }
  return out;
}

/** The domain a vote was cast on, which is the first hop of the path it carried. */
function decodeClaimedDomain(params: Hex): Hex | null {
  try {
    const [, path] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32[]" }, { type: "address[]" }],
      params,
    );
    return path[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * How much `principal` lent to `voter`, reachable from this domain.
 *
 * The lending may sit on an ancestor rather than on the domain itself, since a grant on a
 * parent covers everything beneath it. The register is asked about each domain on the way
 * up until one answers, which is the same walk the governor does when it counts.
 *
 * The amount is capped by what the principal still holds: a promise of weight nobody has
 * any more is not honoured on chain, so it must not be displayed either.
 */
async function lentToward(
  client: PublicClient,
  config: AppConfig,
  principal: `0x${string}`,
  voter: `0x${string}`,
  domainId: Hex,
): Promise<bigint> {
  const path = [domainId, ...ancestorTermIds(config, domainId)];
  for (const id of path) {
    const [delegate, amount] = await client.readContract({
      address: config.governor,
      abi: ozGovernorAbi,
      functionName: "lendingOf",
      args: [principal, id],
    });
    if (delegate === "0x0000000000000000000000000000000000000000") continue;
    if (delegate.toLowerCase() !== voter.toLowerCase()) return 0n;
    const held = await client.readContract({
      address: config.votesToken,
      abi: votesTokenAbi,
      functionName: "getVotes",
      args: [principal],
    });
    return amount > held ? held : amount;
  }
  return 0n;
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
      const [to, amount] = await client.readContract({
        address: config.governor,
        abi: ozGovernorAbi,
        functionName: "lendingOf",
        args: [config.accounts[role].smartAccount, domainId],
      });
      const holder = addressOf.get(to.toLowerCase());
      return holder ? { holder, amount } : null;
    }),
  );
  const out: Record<string, Partial<Record<Role, Role>>> = {};
  pairs.forEach(({ scope, role }, index) => {
    const lending = held[index];
    if (lending) (out[scope] ??= {})[role] = lending.holder;
  });
  return out;
}

/**
 * What each account is currently lending, and where.
 *
 * The masthead shows a token balance, which a lending never moves: the register records
 * who may exercise the weight, and the tokens stay where they are. Without this the
 * screen would answer "one hundred" both before and after a handover, so the lending is
 * read separately and shown beside the balance.
 */
export async function readLendings(
  client: PublicClient,
  config: AppConfig,
  scopes: string[],
): Promise<Partial<Record<Role, { amount: bigint; scope: string }>>> {
  const out: Partial<Record<Role, { amount: bigint; scope: string }>> = {};
  await Promise.all(
    ROLES.flatMap((role) =>
      scopes.map(async (scope) => {
        const domainId = config.nodes.find((node) => node.label === scope)?.termId;
        if (!domainId || out[role]) return;
        const [to, amount] = await client.readContract({
          address: config.governor,
          abi: ozGovernorAbi,
          functionName: "lendingOf",
          args: [config.accounts[role].smartAccount, domainId],
        });
        if (to === "0x0000000000000000000000000000000000000000") return;
        out[role] = { amount, scope };
      }),
    ),
  );
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
