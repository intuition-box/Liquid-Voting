/**
 * Casting a vote: planning which signed chains carry it, simulating, and submitting.
 */
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiItem,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ozGovernorAbi, proposalDomainsAbi, votesTokenAbi } from "../chain/abis";
import { readLogsOnce } from "../chain/logs";
import { FRAMEWORK } from "../chain/network";
import { toHybridAccount } from "../chain/smart-accounts";
import { sendUserOp, type UserOpResult } from "../chain/user-op";
import type { AppConfig } from "../config/app-config";
import type { RedeemableChain, VoiceChain } from "../delegation/delegation-set";
import {
  buildVoteCalldata,
  decodeTerms,
  preflightRedeem,
  type Delegation,
  type PreflightResult,
} from "../delegation/encoding";
import type { DomainGraph, GraphLimits } from "../graph/domain-graph";
import type { PathResult } from "../graph/edges";
import { ROLES, type Role } from "../roles";

import { logStep, settleStep, trackTransaction, type LogCall } from "../chain/tx-log";
import { requireOwnerKey, submitterClient } from "./common";

export { VOTE_AGAINST, VOTE_FOR, VOTE_ABSTAIN } from "../delegation/encoding";

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
/**
 * One per voice a vote carried, emitted by this governor and not by OpenZeppelin.
 *
 * `principal` is indexed, which is the whole point of it: a delegator can ask what was
 * cast in its name with a filtered query rather than a scan of every vote ever recorded.
 */
const VOTE_CAST_ON_BEHALF = parseAbiItem(
  "event VoteCastOnBehalf(uint256 indexed proposalId, address indexed principal, address indexed voter, uint256 weight)",
);
/**
 * Every change to the register, which can be replayed instead of polled.
 *
 * `delegateWeight` emits this on both paths — a grant, and a withdrawal with a zero
 * delegate — so the last event per (delegator, domain) is the current state. Reading the
 * register by asking `lendingOf` for every account on every domain was fifty-one calls
 * for an answer one log query gives whole.
 */
const WEIGHT_DELEGATED = parseAbiItem(
  "event WeightDelegated(address indexed delegator, address indexed delegate, bytes32 indexed domainId, uint256 amount)",
);
/** Which domain a proposal was recorded under, for the same reason. */
const PROPOSAL_SCOPED = parseAbiItem(
  "event ProposalScoped(uint256 indexed proposalId, bytes32 indexed domainId, address indexed scopedBy)",
);
/** OZ does not index proposalId, so the id comes out of the event data. */
const PROPOSAL_CREATED = parseAbiItem(
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
);


export interface VotePlan {
  /** The account that must be `msg.sender` at the DelegationManager, and the recorded voter. */
  redeemer: Role;
  /** One chain per voice carried, each with a witness per link. */
  chains: RedeemedVoice[];
  /** What is being voted on, kept so the log can name it without being told twice. */
  proposalId: bigint;
  support: number;
  /** Per-link path computation, flattened across voices, for the UI to show its work. */
  paths: { rootLabel: string; result: PathResult }[];
  /** Whose voting power rides along with the redeemer's own. */
  principals: Role[];
  calldata: Hex | null;
  /** Set when a link could not produce a witness — nothing to submit. */
  blocked: string | null;
}

/** One voice and the witnesses computed for each of its links, leaf first. */
export interface RedeemedVoice {
  chain: (Delegation & { hash: Hex })[];
  witnesses: Hex[][];
}

/**
 * The one chain a vote is redeemed through, out of however many voices a holder carries.
 *
 * `redeemDelegations` pairs each permission context with its own execution, and
 * OpenZeppelin allows an account a single vote per proposal — so redeeming three chains
 * called `castVoteFor` three times, and the second was refused by OZ's own guard, taking
 * the whole operation down with it. The deepest lineage is chosen, so the longest chain of
 * signatures in play is the one actually walked (ADR 0021).
 */
export function deepestVoice(voices: RedeemedVoice[]): RedeemedVoice | null {
  return voices.reduce<RedeemedVoice | null>(
    (best, voice) => (best === null || voice.chain.length > best.chain.length ? voice : best),
    null,
  );
}

/** Whose name a vote is cast in, phrased for a sentence rather than a template. */
function inWhoseName(borrowed: Role[]): string {
  return borrowed.length === 0 ? "in its own name" : `in ${borrowed.join(" and ")}\u2019s name`;
}

/** A role letter for one of the demo's accounts, or a short address for anything else. */
function nameOf(config: AppConfig, address: string): string {
  const role = ROLES.find(
    (candidate) => config.accounts[candidate].smartAccount.toLowerCase() === address.toLowerCase(),
  );
  return role ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** A domain's label from its term id, since a reader cannot be asked to know hashes. */
function domainLabel(config: AppConfig, termId: Hex): string {
  return config.nodes.find((node) => node.termId.toLowerCase() === termId.toLowerCase())?.label ?? termId;
}

/**
 * The redemption, link by link, as the transaction log should name it.
 *
 * The point of the log is this entry. A delegation is a signed object that has been sitting
 * in a file since whoever made it signed it — and this is the moment it touches the chain
 * for the first time. Saying only "B votes, carrying A" hides the whole mechanism: it does
 * not say which signature is being spent, who made it, what scope they fixed into it, or
 * what the caveat is about to check that scope against.
 *
 * So each link is named by the hash it was signed under, which is the same hash the log
 * printed when it was signed. The two rows can be matched by eye, which is the demonstration.
 */
function describeRedemption(
  config: AppConfig,
  voice: RedeemedVoice,
  proposalId: bigint,
  support: number,
  voter: Role,
  principals: Role[],
): LogCall[] {
  const borrowed = principals.filter((principal) => principal !== voter);
  const links: LogCall[] = voice.chain.map((delegation, index) => {
    const terms = delegation.caveats[0] ? decodeTerms(delegation.caveats[0].terms) : null;
    const witness = (voice.witnesses[index] ?? []).map((hop) => domainLabel(config, hop));
    const signer = nameOf(config, delegation.delegator);
    const holder = nameOf(config, delegation.delegate);
    return {
      contract: "GraphDomainScope",
      address: config.enforcer,
      fn: "beforeHook — rechecks the announced path against the graph",
      args: {
        redeeming: `the delegation ${signer} signed to ${holder}`,
        "signed scope": terms ? `“${domainLabel(config, terms.rootDomainId)}” — immutable, in the terms` : "—",
        "witness supplied": witness.length > 1 ? witness.join(" → ") : (witness[0] ?? "none"),
        "delegation hash": delegation.hash,
        ...(terms ? { "hops allowed": String(terms.maxDepth) } : {}),
      },
    };
  });

  return [
    {
      contract: "DelegationManager",
      address: FRAMEWORK.delegationManager,
      fn: "redeemDelegations(bytes[],ModeCode[],bytes[])",
      args: {
        "redeemed by": voter,
        "links walked": `${voice.chain.length} — ${voice.chain
          .map((link) => `${nameOf(config, link.delegator)} → ${nameOf(config, link.delegate)}`)
          .reverse()
          .join(", then ")}`,
      },
    },
    ...links,
    {
      contract: "OZGovernor",
      address: config.governor,
      fn: "castVoteFor(uint256,uint8,address,address[],bytes32[])",
      args: {
        // An OZ proposal id is a hash of the call it would execute, so it is 78 digits
        // long and only its head is any use to a reader comparing rows.
        proposal: `${proposalId.toString().slice(0, 12)}…`,
        support: SUPPORT_NAMES[support] ?? String(support),
        "recorded as": `${voter} — the delegate, not the signer`,
        "voting on behalf of": borrowed.length > 0 ? borrowed.join(", ") : "nobody but itself",
      },
    },
  ];
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

  // One chain, however many voices ride on it. Every principal is still named, because
  // the governor checks the register itself — the chain proves the scope, the register
  // proves whose weight it carries (ADR 0021). Building one execution per voice called
  // castVoteFor once per chain, and OZ refused the second.
  const redeemed = carried
    ? deepestVoice(carried.voices.map((voice) => ({ chain: voice.chain, witnesses: witnesses(voice) })))
    : null;

  const data = redeemed
    ? buildVoteCalldata({
        chains: [redeemed],
        governor: config.governor,
        proposalId,
        support,
        voter,
        principals: (carried?.principals ?? []).map((principal) => config.accounts[principal].smartAccount),
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

  const principals = carried?.principals ?? [];
  const borrowed = principals.filter((principal) => principal !== role);
  const signers = redeemed
    ? [...new Set(redeemed.chain.map((link) => nameOf(config, link.delegator)))].reverse()
    : [];

  return sendUserOp(
    client,
    submitterClient(config),
    account,
    [{ to: redeemed ? FRAMEWORK.delegationManager : config.governor, value: 0n, data }],
    {
      actor: role,
      // The sentence this whole proof of concept exists to make true, so it is the one on
      // the row rather than something a reader has to expand the row to find.
      label: redeemed
        ? `${role} redeems the delegation ${signers.join(" and ")} signed, and votes with it ${inWhoseName(borrowed)}`
        : `${role} votes with its own weight`,
      detail: redeemed
        ? "The delegation was signed off chain and has been sitting in a file ever since; this is the first time it touches the chain. The DelegationManager walks it link by link, and each link's caveat rechecks the announced domain path against live graph state before the governor is ever reached — so the scope is proven here, not asserted."
        : "Straight to the governor. There is no delegation to redeem, so there is nothing for a caveat to check.",
      calls: redeemed
        ? describeRedemption(config, redeemed, proposalId, support, role, principals)
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
    chain: entry.voice.chain,
    witnesses: entry.paths.map((path) => (path.result.found ? path.result.path : [])),
  }));
  const base = { redeemer, chains, paths, principals, proposalId, support };

  const blockedAt = paths.find((entry) => !entry.result.found);
  if (blockedAt && !blockedAt.result.found) {
    return { ...base, calldata: null, blocked: `no witness up to “${blockedAt.rootLabel}”: ${blockedAt.result.reason}` };
  }
  return {
    ...base,
    calldata: encodeVote(config, chains, redeemer, principals, proposalId, support, graph.domainPathOf(domainLabel)),
    blocked: null,
  };
}

/**
 * Encodes the redemption of a delegated vote.
 *
 * One chain is redeemed, not one per voice, because OpenZeppelin allows an account a
 * single vote per proposal. `redeemDelegations` pairs each permission context with its own
 * execution, so redeeming three chains meant calling `castVoteFor` three times — the
 * first counted and the second was refused by OZ's own guard, taking the whole operation
 * down with it. A holder carrying more than one voice could therefore never vote at all.
 *
 * Which leaves the two halves of authority where they each belong. The caveat answers
 * *may this account vote on this domain*: the chain redeemed here is walked link by link
 * by the DelegationManager, and every caveat on it verifies the announced path against
 * live graph state. The register answers *whose weight does it carry*, and the governor
 * checks that itself — `DomainVotes` follows each named principal's chain of lendings and
 * ignores any that does not end at the voter, on a domain that does not reach this
 * proposal. Neither half is taken on trust, and neither half needs the other repeated.
 *
 * The deepest lineage is the one redeemed, so the longest chain of signatures in play is
 * the one actually walked.
 */
function encodeVote(
  config: AppConfig,
  chains: RedeemedVoice[],
  redeemer: Role,
  principals: Role[],
  proposalId: bigint,
  support: number,
  /**
   * The proposal's domain and every ancestor, up to the root.
   *
   * Not the same thing as a caveat's witness, though it was taken from one: a witness
   * climbs to the scope *that link* was signed for, and stops there. The governor uses
   * this array as the set of domains to look for a lending in, so stopping at the
   * signed scope meant a grant made on an ancestor above it was never found — the panel
   * and the planned vote asked the governor two different questions, and the planned
   * one undercounted.
   */
  domainPath: Hex[],
): Hex {
  const deepest = deepestVoice(chains);
  return buildVoteCalldata({
    chains: deepest ? [deepest] : [],
    governor: config.governor,
    proposalId,
    support,
    voter: config.accounts[redeemer].smartAccount,
    principals: principals.map((role) => config.accounts[role].smartAccount),
    domainPath,
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
    calldata: encodeVote(
      config,
      chains,
      plan.redeemer,
      plan.principals,
      proposalId,
      support,
      graph.domainPathOf(domainLabel),
    ),
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
  const redeemed = deepestVoice(plan.chains);
  const signers = redeemed
    ? [...new Set(redeemed.chain.map((link) => nameOf(config, link.delegator)))].reverse()
    : [];

  return sendUserOp(
    client,
    submitterClient(config),
    account,
    [{ to: FRAMEWORK.delegationManager, value: 0n, data: plan.calldata }],
    {
      actor: plan.redeemer,
      label: redeemed
        ? `${plan.redeemer} redeems the delegation ${signers.join(" and ")} signed, and votes with it ${inWhoseName(borrowed)}`
        : `${plan.redeemer} votes`,
      detail:
        "The delegation was signed off chain and has been sitting in a file ever since; this is the first time it touches the chain. Each link's caveat rechecks the announced domain path against live graph state before the governor is reached.",
      calls: redeemed
        ? describeRedemption(config, redeemed, plan.proposalId, plan.support, plan.redeemer, plan.principals)
        : [],
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

  /**
   * The stamp that makes the id unique, added here rather than asked of every caller.
   *
   * An OpenZeppelin proposal id is `hash(targets, values, calldatas, hash(description))`
   * — and the call is the same for every proposal this demo makes, so the description is
   * the only thing distinguishing one from another. The domain is not part of it: it
   * lives in the resolver beside the governor, so the same title on two different
   * domains collides just as surely as on one.
   *
   * Reusing a title therefore reverts with `GovernorUnexpectedProposalState`, which is
   * accurate and tells a visitor nothing. Three callers existed and two of them had got
   * it wrong — the rehearsal used a fixed string and failed on every run after the
   * first, and the panel sent whatever was typed, so proposing twice with the default
   * title failed. Knowledge of how an id is derived belongs with the function that
   * derives one.
   *
   * `readDescription` takes it back off for display.
   */
  const stamped = `${description} (${new Date().toISOString().slice(0, 16)})`;
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
        args: { description: stamped, call: "the governor itself, with empty calldata" },
      },
    ],
  });
  const txHash = await wallet.writeContract({
    ...gov,
    functionName: "propose",
    args: [[config.governor], [0n], ["0x"], stamped],
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
    // A pause before each nudge, not after. The governor counts its delay in `clock()`,
    // which on this Arbitrum chain is the parent chain's height — resampled only when an
    // L2 block is produced, and the parent moves about once a second. Transactions sent
    // back to back therefore read the same height and buy nothing but gas (ADR 0026).
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1200));
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
  //
  // From the block the governor was deployed in, not from `earliest`. It has nothing to
  // say about the nine million blocks that came before it, and asking anyway is what
  // exhausted the public RPC's bandwidth allowance in the middle of a session.
  // Both log queries at once: the proposals, and the domain each was recorded under.
  // The domain used to be a contract read per proposal — twenty reads for something one
  // query answers whole.
  const [created, scoped] = await Promise.all([
    readLogsOnce(client, "proposals", config.governorFromBlock, (fromBlock) =>
      client.getLogs({ address: config.governor, event: PROPOSAL_CREATED, fromBlock }),
    ),
    readLogsOnce(client, "scoped", config.governorFromBlock, (fromBlock) =>
      client.getLogs({ address: config.resolver, event: PROPOSAL_SCOPED, fromBlock }),
    ),
  ]);
  const domainOf = new Map<string, Hex>();
  for (const log of scoped) {
    if (log.args.proposalId !== undefined && log.args.domainId) {
      // A proposal's domain is recorded once and refused thereafter, so the first wins.
      domainOf.set(log.args.proposalId.toString(), log.args.domainId);
    }
  }
  const recent = created.slice(-limit).reverse();

  const records = await Promise.all(
    recent.map(async (log) => {
      const { proposalId, proposer, description } = log.args;
      if (proposalId === undefined || !proposer || description === undefined) return null;
      const [state, votes] = await Promise.all([
        client.readContract({ address: config.governor, abi: ozGovernorAbi, functionName: "state", args: [proposalId] }),
        client.readContract({ address: config.governor, abi: ozGovernorAbi, functionName: "proposalVotes", args: [proposalId] }),
      ]);
      const domainId = domainOf.get(proposalId.toString()) ?? ("0x" + "0".repeat(64) as Hex);
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

/**
 * A proposal's description split into the part worth reading and the part that is there
 * for the chain's benefit.
 *
 * `reset` stamps the time into every description, and it has to: an OpenZeppelin
 * proposal id is a hash of the call plus the description, so two runs over the same
 * domain would compute the same id and the second `propose` would revert. The stamp is
 * load-bearing on chain and noise on screen — "Decide the next step for micro-grants
 * (2026-10-14T13:58)" is a title nobody can scan a list of.
 *
 * So it is parsed off for display rather than removed from the chain, and handed back
 * separately for the places that can use it.
 */
export function readDescription(description: string): { title: string; recordedAt: string | null } {
  const stamped = /^(.*?)\s*\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\)\s*$/.exec(description);
  if (!stamped) return { title: description, recordedAt: null };
  return { title: stamped[1] ?? description, recordedAt: stamped[2] ?? null };
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
 * Who voted on every proposal, and whose voice each share of it was.
 *
 * Read from `VoteCastOnBehalf`, which the governor emits once per voice a vote carried.
 * It used to be reconstructed here instead — decode the principals a vote *claimed* out
 * of its params, then ask the register what each of them had lent, then walk the domain's
 * ancestors because a grant on a parent covers everything beneath it, then cap each share
 * by what the principal still held. Four helpers and a sequential read per principal per
 * ballot, to arrive at a number the governor had already worked out and thrown away.
 *
 * Now it is stated on chain, so this reads it. The shares are the ones that were counted
 * rather than a client's best reconstruction of them, and one `getLogs` replaces the lot.
 */
export async function readAllBallots(
  client: PublicClient,
  config: AppConfig,
): Promise<Record<string, Ballot[]>> {
  const roleOf = (address: `0x${string}`): Role | null =>
    ROLES.find((role) => config.accounts[role].smartAccount.toLowerCase() === address.toLowerCase()) ?? null;

  // The vote events carry the support and the total; the on-behalf events carry the
  // split. Both are needed: a tally without a breakdown says nothing about who is
  // accountable, and a breakdown without the support says nothing about what was decided.
  const [plain, withParams, onBehalf] = await Promise.all([
    readLogsOnce(client, "votes", config.governorFromBlock, (fromBlock) =>
      client.getLogs({ address: config.governor, event: VOTE_CAST, fromBlock }),
    ),
    readLogsOnce(client, "votes-params", config.governorFromBlock, (fromBlock) =>
      client.getLogs({ address: config.governor, event: VOTE_CAST_WITH_PARAMS, fromBlock }),
    ),
    readLogsOnce(client, "on-behalf", config.governorFromBlock, (fromBlock) =>
      client.getLogs({ address: config.governor, event: VOTE_CAST_ON_BEHALF, fromBlock }),
    ),
  ]);

  // Filed by proposal and by the account that submitted the vote, which together identify
  // one ballot: OZ allows an account only one per proposal.
  const shares = new Map<string, BallotEntry[]>();
  for (const log of onBehalf) {
    const { proposalId, principal, voter, weight } = log.args;
    if (proposalId === undefined || !principal || !voter || weight === undefined) continue;
    const entry: BallotEntry = {
      principal: roleOf(principal),
      principalAddress: principal,
      carriedBy: roleOf(voter),
      carriedByAddress: voter,
      weight,
    };
    const key = `${proposalId.toString()}:${voter.toLowerCase()}`;
    const list = shares.get(key) ?? [];
    // The voter's own share first, then the voices it carried — the order the panel
    // reads them in.
    if (principal.toLowerCase() === voter.toLowerCase()) list.unshift(entry);
    else list.push(entry);
    shares.set(key, list);
  }

  const out: Record<string, Ballot[]> = {};
  for (const log of [...plain, ...withParams]) {
    const { voter, proposalId, support, weight } = log.args;
    if (!voter || proposalId === undefined || support === undefined || weight === undefined) continue;
    const entries = shares.get(`${proposalId.toString()}:${voter.toLowerCase()}`) ?? [
      // A vote worth nothing logs no share, and a vote cast before the governor logged
      // its split has none to find. Show it whole under the voter rather than losing it.
      { principal: roleOf(voter), principalAddress: voter, carriedBy: roleOf(voter), carriedByAddress: voter, weight },
    ];
    (out[proposalId.toString()] ??= []).push({ support: Number(support), entries, total: weight });
  }
  return out;
}

/** One share of an account's weight, as it was cast on some proposal. */
export interface CarriedVoice {
  proposalId: bigint;
  weight: bigint;
  /** Who carried it. The account itself when it voted for itself. */
  carriedBy: Role | null;
  carriedByAddress: `0x${string}`;
  byItself: boolean;
  txHash: `0x${string}`;
  block: bigint;
}

/**
 * Every share of weight ever cast in one account's name, newest first.
 *
 * The question a delegator actually has — "what was done with my voice?" — and the reason
 * the event indexes the principal. OpenZeppelin indexes the account that *submitted* a
 * vote, so answering this used to mean fetching every vote the governor ever recorded and
 * decoding each one's params. Here it is one query filtered on one topic.
 */
export async function readVoicesCarriedFor(
  client: PublicClient,
  config: AppConfig,
  principal: `0x${string}`,
): Promise<CarriedVoice[]> {
  const logs = await readLogsOnce(client, `on-behalf:${principal.toLowerCase()}`, config.governorFromBlock, (fromBlock) =>
    client.getLogs({ address: config.governor, event: VOTE_CAST_ON_BEHALF, args: { principal }, fromBlock }),
  );

  const roleOf = (address: `0x${string}`): Role | null =>
    ROLES.find((role) => config.accounts[role].smartAccount.toLowerCase() === address.toLowerCase()) ?? null;

  return logs
    .map((log) => {
      const { proposalId, voter, weight } = log.args;
      if (proposalId === undefined || !voter || weight === undefined) return null;
      return {
        proposalId,
        weight,
        carriedBy: roleOf(voter),
        carriedByAddress: voter,
        byItself: voter.toLowerCase() === principal.toLowerCase(),
        txHash: log.transactionHash,
        block: log.blockNumber,
      } satisfies CarriedVoice;
    })
    .filter((entry): entry is CarriedVoice => entry !== null)
    .reverse();
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

/** The register, in full: who holds each domain, and how much they were lent. */
export interface Register {
  /** Who an account handed each domain to, keyed by domain label then role. */
  delegatedTo: Record<string, Partial<Record<Role, Role>>>;
  /** What each account is lending, and where. First one found per account. */
  lent: Partial<Record<Role, { amount: bigint; scope: string }>>;
}

/**
 * Who the governor has each account delegating to, and how much — in one pass.
 *
 * The register is the authority on weight: a signed delegation says the delegate MAY
 * vote, this says whose weight it actually carries. A lending moves no token, so no
 * balance can be read to infer it; `lendingOf` is the only honest source.
 *
 * Both answers come from the same read, which they always did — this used to be two
 * functions asking `lendingOf(role, domain)` for every pair and each throwing away the
 * half it did not want. Over seventeen domains and three accounts that was a hundred and
 * two reads for fifty-one answers, on an RPC whose bandwidth allowance a single refresh
 * was already enough to exhaust.
 */
export async function readRegister(
  client: PublicClient,
  config: AppConfig,
  scopes: string[],
): Promise<Register> {
  const logs = await readLogsOnce(client, "register", config.governorFromBlock, (fromBlock) =>
    client.getLogs({ address: config.governor, event: WEIGHT_DELEGATED, fromBlock }),
  );

  // Replayed in order, so the last word on a pair is the one that stands. A withdrawal
  // names the zero address, which removes the entry rather than recording a lending of
  // nothing.
  const current = new Map<string, { delegate: `0x${string}`; amount: bigint }>();
  for (const log of logs) {
    const { delegator, delegate, domainId, amount } = log.args;
    if (!delegator || !delegate || !domainId || amount === undefined) continue;
    const key = `${delegator.toLowerCase()}|${domainId.toLowerCase()}`;
    if (delegate === "0x0000000000000000000000000000000000000000") current.delete(key);
    else current.set(key, { delegate, amount });
  }

  const roleOf = new Map(ROLES.map((role) => [config.accounts[role].smartAccount.toLowerCase(), role]));
  const delegatedTo: Register["delegatedTo"] = {};
  const lent: Register["lent"] = {};

  for (const scope of scopes) {
    const domainId = config.nodes.find((node) => node.label === scope)?.termId;
    if (!domainId) continue;
    for (const role of ROLES) {
      const held = current.get(`${config.accounts[role].smartAccount.toLowerCase()}|${domainId.toLowerCase()}`);
      if (!held) continue;
      const holder = roleOf.get(held.delegate.toLowerCase());
      // Only a lending to one of the demo's own accounts can be drawn as an arrow between
      // two of them; one to an outside address is still a lending and still counted.
      if (holder) (delegatedTo[scope] ??= {})[role] = holder;
      lent[role] ??= { amount: held.amount, scope };
    }
  }
  return { delegatedTo, lent };
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
    abi: ozGovernorAbi,
    functionName: "MAX_DOMAIN_PATH",
  });
  return { maxDomainPath: Number(maxDomainPath) };
}
