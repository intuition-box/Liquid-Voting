/**
 * Demo actions — the service layer behind the panels. No React, no DOM: every function
 * takes the config plus its inputs and returns data. Hooks own the lifecycle.
 */
import { createWalletClient, encodeFunctionData, http, stringToHex, toHex, type Hex, type PublicClient } from "viem";
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
import { computePath, readEdgeStates, type EdgeState, type PathResult } from "./graph";
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

/** Which level of the chain a vote is redeemed through. */
export type ChainLevel = "full" | "root";

export interface VotePlan {
  level: ChainLevel;
  /** The account that must be `msg.sender` at the DelegationManager, and the recorded voter. */
  redeemer: Role;
  chain: Delegation[];
  /** Per-level path computation, in the same order as `chain` (leaf → root). */
  paths: { rootLabel: string; result: PathResult }[];
  /** Whose voting power rides along with the redeemer's own. */
  principals: Role[];
  calldata: Hex | null;
  /** Set when a level could not produce a witness — nothing to submit. */
  blocked: string | null;
}

/**
 * The chain a vote is redeemed through, and whose weight it carries. Principals are the
 * delegators up the chain: redeeming the root alone lets the delegate vote with the
 * voter's weight; redeeming the full chain lets the executor vote with both.
 */
function chainFor(
  config: DemoConfig,
  level: ChainLevel,
): { chain: Delegation[]; redeemer: Role; roots: string[]; principals: Role[] } {
  const { root, leaf } = config.delegations;
  return level === "full"
    ? { chain: [leaf, root], redeemer: "executor", roots: ["UX", "design"], principals: ["voter", "delegate"] }
    : { chain: [root], redeemer: "delegate", roots: ["design"], principals: ["voter"] };
}

/**
 * Builds a proposal: computes one path witness per delegation level from the live graph,
 * then encodes the redemption. Path discovery happens here (client-side, ADR 0003) and is
 * surfaced step by step so the UI can show it rather than hide it behind a spinner.
 */
export function planVote(
  config: DemoConfig,
  edgeStates: EdgeState[],
  level: ChainLevel,
  domainLabel: string,
  proposalId: bigint,
  support: number,
): VotePlan {
  const { chain, redeemer, roots, principals } = chainFor(config, level);
  const nodes = config.nodes;
  const paths = roots.map((rootLabel) => ({
    rootLabel,
    result: computePath(edgeStates, nodes, domainLabel, rootLabel),
  }));
  const base = { level, redeemer, chain, paths, principals };

  const blockedAt = paths.find((entry) => !entry.result.found);
  if (blockedAt && !blockedAt.result.found) {
    return { ...base, calldata: null, blocked: `no witness up to “${blockedAt.rootLabel}”: ${blockedAt.result.reason}` };
  }

  const witnesses = paths.map((entry) => (entry.result.found ? entry.result.path : []));
  return { ...base, calldata: encodeVote(config, chain, witnesses, redeemer, principals, proposalId, support), blocked: null };
}

/** Encodes the redemption of a delegated vote for the given chain and witnesses. */
function encodeVote(
  config: DemoConfig,
  chain: Delegation[],
  witnesses: Hex[][],
  redeemer: Role,
  principals: Role[],
  proposalId: bigint,
  support: number,
): Hex {
  return buildVoteCalldata({
    chain,
    witnesses,
    governor: config.governor,
    proposalId,
    support,
    voter: config.accounts[redeemer].smartAccount,
    principals: principals.map((role) => config.accounts[role].smartAccount),
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
  edgeStates: EdgeState[],
  level: ChainLevel,
  domainLabel: string,
  proposalId: bigint,
  support: number,
): VotePlan {
  const plan = planVote(config, edgeStates, level, domainLabel, proposalId, support);
  if (!plan.blocked) return plan;

  const termIdOf = new Map(config.nodes.map((node) => [node.label, node.termId]));
  const domainId = termIdOf.get(domainLabel);
  if (!domainId) return plan;

  const witnesses = plan.paths.map((entry) => {
    if (entry.result.found) return entry.result.path;
    const rootId = termIdOf.get(entry.rootLabel);
    return rootId && rootId !== domainId ? [domainId, rootId] : [domainId];
  });
  return {
    ...plan,
    calldata: encodeVote(config, plan.chain, witnesses, plan.redeemer, plan.principals, proposalId, support),
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
 */
export async function signDelegation(
  client: PublicClient,
  config: DemoConfig,
  from: Role,
  to: Role,
  domainLabel: string,
): Promise<Delegation & { hash: Hex }> {
  const domainId = config.nodes.find((node) => node.label === domainLabel)?.termId;
  if (!domainId) throw new Error(`unknown domain “${domainLabel}”`);

  const delegator = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, from)));
  const delegation: Delegation = {
    delegate: config.accounts[to].smartAccount,
    delegator: config.accounts[from].smartAccount,
    authority: ROOT_AUTHORITY,
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
    // Time-based: disableDelegation blacklists a hash forever, so every grant is distinct.
    salt: toHex(BigInt(Date.now())),
    signature: "0x",
  };

  delegation.signature = await delegator.signDelegation({ delegation });
  const hash = await client.readContract({
    address: FRAMEWORK.delegationManager,
    abi: delegationManagerAbi,
    functionName: "getDelegationHash",
    args: [{ ...delegation, salt: BigInt(delegation.salt) }],
  });

  // The signature says the delegate MAY vote on this domain; the governor's register says
  // whose weight it carries. Recording the transfer is what makes the delegator stop
  // counting on this domain and the delegate count for both.
  const account = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, from)));
  const op = await sendUserOp(client, submitterClient(config), account, [
    {
      to: config.governor,
      value: 0n,
      data: encodeFunctionData({
        abi: governorAbi,
        functionName: "delegateWeight",
        args: [config.accounts[to].smartAccount, domainId],
      }),
    },
  ]);
  if (!op.success) {
    throw new Error(op.revert ? `weight transfer reverted: ${op.revert.formatted}` : "weight transfer reverted");
  }

  return { ...delegation, hash };
}

/** The voter disables its root delegation — framework-native, kills the whole chain. */
export async function revokeRoot(client: PublicClient, config: DemoConfig): Promise<UserOpResult> {
  const voter = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, "voter")));
  return sendUserOp(client, submitterClient(config), voter, [
    { to: FRAMEWORK.delegationManager, value: 0n, data: buildDisableCalldata(config.delegations.root) },
  ]);
}

/** Total weight a proposal needs before it can succeed — the governor's `QUORUM`. */
export const QUORUM = 1n;

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
): Promise<Record<Role, bigint>> {
  const roles: Role[] = ["voter", "delegate", "executor"];
  const all = roles.map((role) => config.accounts[role].smartAccount);
  const weights = await Promise.all(
    roles.map((role) =>
      client.readContract({
        address: config.governor,
        abi: governorAbi,
        functionName: "weightFor",
        args: [config.accounts[role].smartAccount, domainId, all],
      }),
    ),
  );
  return { voter: weights[0] ?? 0n, delegate: weights[1] ?? 0n, executor: weights[2] ?? 0n };
}

/** Voting power per demo role, read live — the weights a delegated vote carries. */
export async function readVotingPower(
  client: PublicClient,
  config: DemoConfig,
): Promise<Record<Role, bigint>> {
  const roles: Role[] = ["voter", "delegate", "executor"];
  const powers = await Promise.all(
    roles.map((role) =>
      client.readContract({
        address: config.governor,
        abi: governorAbi,
        functionName: "votingPower",
        args: [config.accounts[role].smartAccount],
      }),
    ),
  );
  return { voter: powers[0] ?? 0n, delegate: powers[1] ?? 0n, executor: powers[2] ?? 0n };
}

export type ExtensionPreview =
  | { status: "absent"; atomId: Hex; message: string }
  | { status: "unauthorized"; atomId: Hex; message: string }
  | { status: "authorized"; atomId: Hex; message: string };

/**
 * Answers "would this domain be authorized today?" before the graph is touched — the
 * contrast that makes the live extension land. Reads live state; the panel only renders.
 */
export async function previewExtension(
  client: PublicClient,
  config: DemoConfig,
  label: string,
): Promise<ExtensionPreview> {
  const vault = { address: config.multiVault, abi: multiVaultAbi } as const;
  const atomId = await client.readContract({ ...vault, functionName: "calculateAtomId", args: [stringToHex(label)] });
  const exists = await client.readContract({ ...vault, functionName: "isTermCreated", args: [atomId] });
  if (!exists) {
    return {
      status: "absent",
      atomId,
      message: `“${label}” (${atomId.slice(0, 14)}…) does not exist on chain yet — no path can reach it, so no delegation authorizes it.`,
    };
  }
  // The atom exists: the question is whether an attested path reaches it from the
  // delegation's root. That is a graph question, answered against live edge state — no
  // proposal needs to exist for the answer to be true.
  const edges = await readEdgeStates(client, config.multiVault, config.edges, config.attestor, config.curveId);
  const path = computePath(edges, config.nodes, label, "design");
  return path.found
    ? { status: "authorized", atomId, message: `“${label}” already verifies — pick a domain that is not yet linked.` }
    : { status: "unauthorized", atomId, message: `no attested path up to “design”: ${path.reason}` };
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
