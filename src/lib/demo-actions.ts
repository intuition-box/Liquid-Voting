/**
 * Demo actions — the service layer behind the panels. No React, no DOM: every function
 * takes the config plus its inputs and returns data. Hooks own the lifecycle.
 */
import { createWalletClient, http, stringToHex, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { governorAbi, multiVaultAbi } from "./abis";
import { FRAMEWORK, intuitionTestnet } from "./chain";
import { buildDisableCalldata, buildRedeemCalldata, preflightRedeem, type Delegation, type PreflightResult } from "./delegation";
import type { DemoConfig, Role } from "./demo-config";
import { computePath, type EdgeState, type PathResult } from "./graph";
import { toHybridAccount } from "./smart-accounts";
import { sendUserOp, type UserOpResult } from "./user-op";

/** Which level of the chain a proposal is submitted through. */
export type ChainLevel = "full" | "root";

export interface ProposalPlan {
  level: ChainLevel;
  /** The account that must be `msg.sender` at the DelegationManager. */
  redeemer: Role;
  chain: Delegation[];
  /** Per-level path computation, in the same order as `chain` (leaf → root). */
  paths: { rootLabel: string; result: PathResult }[];
  calldata: Hex | null;
  /** Set when a level could not produce a witness — nothing to submit. */
  blocked: string | null;
}

function chainFor(config: DemoConfig, level: ChainLevel): { chain: Delegation[]; redeemer: Role; roots: string[] } {
  const { root, leaf } = config.delegations;
  return level === "full"
    ? { chain: [leaf, root], redeemer: "executor", roots: ["UX", "design"] }
    : { chain: [root], redeemer: "delegate", roots: ["design"] };
}

/**
 * Builds a proposal: computes one path witness per delegation level from the live graph,
 * then encodes the redemption. Path discovery happens here (client-side, ADR 0003) and is
 * surfaced step by step so the UI can show it rather than hide it behind a spinner.
 */
export function planProposal(
  config: DemoConfig,
  edgeStates: EdgeState[],
  level: ChainLevel,
  domainLabel: string,
  description: string,
): ProposalPlan {
  const { chain, redeemer, roots } = chainFor(config, level);
  const nodes = config.nodes;
  const paths = roots.map((rootLabel) => ({
    rootLabel,
    result: computePath(edgeStates, nodes, domainLabel, rootLabel),
  }));

  const blockedAt = paths.find((entry) => !entry.result.found);
  if (blockedAt && !blockedAt.result.found) {
    return { level, redeemer, chain, paths, calldata: null, blocked: `no witness up to “${blockedAt.rootLabel}”: ${blockedAt.result.reason}` };
  }

  const domainId = config.nodes.find((node) => node.label === domainLabel)?.termId;
  if (!domainId) return { level, redeemer, chain, paths, calldata: null, blocked: `unknown domain “${domainLabel}”` };

  const witnesses = paths.map((entry) => (entry.result.found ? entry.result.path : []));
  const calldata = buildRedeemCalldata({ chain, witnesses, governor: config.governor, domainId, description });
  return { level, redeemer, chain, paths, calldata, blocked: null };
}

/**
 * Builds a proposal even when a level has no witness, by falling back to a direct
 * [domain, root] guess. Used to demonstrate live failures (`legal`, narrowing): the
 * chain still gets a syntactically valid witness, and the enforcer rejects it on chain
 * for the real reason instead of the UI refusing to try.
 */
export function planProposalForcingWitness(
  config: DemoConfig,
  edgeStates: EdgeState[],
  level: ChainLevel,
  domainLabel: string,
  description: string,
): ProposalPlan {
  const plan = planProposal(config, edgeStates, level, domainLabel, description);
  if (!plan.blocked) return plan;

  const termIdOf = new Map(config.nodes.map((node) => [node.label, node.termId]));
  const domainId = termIdOf.get(domainLabel);
  if (!domainId) return plan;

  const witnesses = plan.paths.map((entry) => {
    if (entry.result.found) return entry.result.path;
    const rootId = termIdOf.get(entry.rootLabel);
    return rootId && rootId !== domainId ? [domainId, rootId] : [domainId];
  });
  const calldata = buildRedeemCalldata({ chain: plan.chain, witnesses, governor: config.governor, domainId, description });
  return { ...plan, calldata };
}

export async function preflightProposal(
  client: PublicClient,
  config: DemoConfig,
  plan: ProposalPlan,
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

export async function submitProposal(
  client: PublicClient,
  config: DemoConfig,
  plan: ProposalPlan,
): Promise<UserOpResult> {
  if (!plan.calldata) throw new Error(plan.blocked ?? "nothing to submit");
  const account = await toHybridAccount(client, privateKeyToAccount(config.ownerKeys[plan.redeemer]));
  return sendUserOp(client, submitterClient(config), account, [
    { to: FRAMEWORK.delegationManager, value: 0n, data: plan.calldata },
  ]);
}

/** The voter disables its root delegation — framework-native, kills the whole chain. */
export async function revokeRoot(client: PublicClient, config: DemoConfig): Promise<UserOpResult> {
  const voter = await toHybridAccount(client, privateKeyToAccount(config.ownerKeys.voter));
  return sendUserOp(client, submitterClient(config), voter, [
    { to: FRAMEWORK.delegationManager, value: 0n, data: buildDisableCalldata(config.delegations.root) },
  ]);
}

export interface ProposalRecord {
  id: bigint;
  domainId: Hex;
  proposer: `0x${string}`;
  description: string;
}

export async function readProposals(client: PublicClient, config: DemoConfig, limit = 8): Promise<ProposalRecord[]> {
  const count = await client.readContract({ address: config.governor, abi: governorAbi, functionName: "proposalCount" });
  const ids: bigint[] = [];
  for (let id = count - 1n; id >= 0n && ids.length < limit; id--) ids.push(id);
  return Promise.all(
    ids.map(async (id) => {
      const proposal = await client.readContract({
        address: config.governor,
        abi: governorAbi,
        functionName: "getProposal",
        args: [id],
      });
      return { id, domainId: proposal.domainId, proposer: proposal.proposer, description: proposal.description };
    }),
  );
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
