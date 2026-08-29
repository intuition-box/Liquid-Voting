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
import type { RedeemableChain } from "./delegation-set";
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
 * Plans a delegated vote through the delegations that were actually signed.
 *
 * The chain comes from the grants in force, resolved by walking back from the voter:
 * whoever handed it this domain, and whoever handed it to them. Sign a new grant in the
 * UI and it is the one redeemed — before this, the plan reached for a fixed pair and
 * whatever had just been signed was ignored.
 *
 * One witness is computed per link, each against its own scope, since every level of the
 * chain carries its own caveat and is verified against its own signer's scope (ADR 0007).
 * Path discovery is client-side (ADR 0003) and surfaced step by step so the UI can show
 * it rather than hide it behind a spinner.
 */
export function planVote(
  config: DemoConfig,
  graph: DomainGraph,
  resolved: RedeemableChain,
  domainLabel: string,
  proposalId: bigint,
  support: number,
): VotePlan {
  const { chain, redeemer, principals, scopes } = resolved;
  const paths = scopes.map((rootLabel) => ({
    rootLabel,
    result: graph.pathTo(domainLabel, rootLabel),
  }));
  const base = { redeemer, chain, paths, principals };

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
    // The governor needs the same path the caveat verifies: a grant on a parent domain
    // covers this proposal, and the path is what proves the parent relation.
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

  const witnesses = plan.paths.map((entry) => {
    if (entry.result.found) return entry.result.path;
    const rootId = graph.termId(entry.rootLabel);
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
  /** The delegation the signer holds this domain through, when there is one. */
  upstream?: Delegation & { hash: Hex },
): Promise<Delegation & { hash: Hex }> {
  const domainId = config.nodes.find((node) => node.label === domainLabel)?.termId;
  if (!domainId) throw new Error(`unknown domain “${domainLabel}”`);

  // The manager walks a chain leaf to root and requires each link's delegator to be the
  // next one's delegate. Chaining anywhere else would build a chain it rejects, so an
  // upstream that does not hand over to this signer is ignored and the grant stands alone.
  const delegator = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, from)));
  const signerAccount = config.accounts[from].smartAccount;
  const chainable = upstream && upstream.delegate.toLowerCase() === signerAccount.toLowerCase();
  const delegation: Delegation = {
    delegate: config.accounts[to].smartAccount,
    delegator: signerAccount,
    authority: chainable ? upstream.hash : ROOT_AUTHORITY,
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

  return { ...delegation, hash };
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
