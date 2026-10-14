/**
 * The running account of what the demo did, and what it cost.
 *
 * Everything interesting here happens through a self-bundled user operation, which from
 * the outside is one opaque `EntryPoint.handleOps` transaction. Watching the app without
 * this is watching numbers change for no visible reason — which was the complaint, and a
 * fair one: the machinery is the product, and it was invisible.
 *
 * Each step is described by the action that performs it rather than decoded back out of
 * its calldata. The action already knows it is redeeming two chains to call
 * `castVoteFor`; recovering that from a nested `redeemDelegations` blob would be a lot of
 * work to arrive back where we started, and would quietly drift the moment an encoder
 * changed.
 *
 * Deliberately free of React and of the DOM, so the CLI scripts that import the same
 * actions can read it too.
 */
import type { Hex } from "viem";

/** One contract call inside a step, in the terms a reader can check against the chain. */
export interface LogCall {
  /** The contract's name in this demo — "OZGovernor", "DelegationManager". */
  contract: string;
  /** Its address, so the name can be verified rather than trusted. */
  address?: Hex;
  /** The function, with its signature when that is the clarifying part. */
  fn: string;
  /** Argument names to printable values. Kept small: what a reader needs, not everything. */
  args?: Record<string, string>;
  /** Native value sent, in wei. Omitted when zero. */
  value?: bigint;
}

/**
 * How a step reached the chain, which is the distinction the demo keeps having to explain.
 *
 * `signature` costs nothing and touches nothing: a delegation is a signed object and sits
 * in a file until somebody redeems it. `userop` is the self-bundled ERC-4337 path, where
 * the smart account signs and a funded EOA submits. `tx` is a plain transaction from an
 * EOA. `local` never leaves the browser — generating a key, deriving an address.
 */
export type LogKind = "signature" | "userop" | "tx" | "local";

export type LogStatus = "pending" | "done" | "failed";

export interface LogStep {
  id: string;
  /** What is happening, in the demo's own words. */
  label: string;
  /** One line on why, for a reader who does not already know. */
  detail?: string;
  kind: LogKind;
  /** Who is acting — a role letter, or an address when there is no role. */
  actor?: string;
  calls: LogCall[];
  status: LogStatus;
  hash?: Hex;
  /** Block the transaction landed in. */
  block?: bigint;
  gasUsed?: bigint;
  /** What it actually cost, in wei. */
  cost?: bigint;
  /** Set when the step failed, in as few words as the reason allows. */
  error?: string;
  /** Milliseconds from start to settlement. */
  took?: number;
  startedAt: number;
}

/** What an action states about a step before it knows how it went. */
export type StepIntent = Pick<LogStep, "label" | "kind" | "calls"> & Partial<Pick<LogStep, "detail" | "actor">>;

/** What is learned once it has settled, the label included: a step sometimes only finds
 *  out what it did by doing it. */
export type StepOutcome = Partial<Pick<LogStep, "hash" | "block" | "gasUsed" | "cost" | "error" | "label">> & {
  status: Exclude<LogStatus, "pending">;
};

/** Oldest first, so the panel reads like a transcript. Capped so a long session cannot
 *  grow without bound; the early steps are the least interesting by then. */
const LIMIT = 200;

let steps: LogStep[] = [];
let counter = 0;
const listeners = new Set<() => void>();

function announce(): void {
  // A fresh array identity every time, because `useSyncExternalStore` compares snapshots
  // by reference and would otherwise never see an in-place append.
  steps = steps.slice(-LIMIT);
  for (const listener of listeners) listener();
}

/** Opens a step. Returns the id to settle it with. */
export function logStep(intent: StepIntent): string {
  const id = `s${++counter}`;
  steps = [...steps, { ...intent, id, status: "pending", startedAt: Date.now() }];
  announce();
  return id;
}

/** Closes a step that was opened. Unknown ids are ignored rather than thrown on: a log
 *  is not worth failing an action over. */
export function settleStep(id: string, outcome: StepOutcome): void {
  const at = Date.now();
  steps = steps.map((step) => (step.id === id ? { ...step, ...outcome, took: at - step.startedAt } : step));
  announce();
}

/** A step that is already over — a local computation, or something read back after the fact. */
export function recordStep(intent: StepIntent, outcome: StepOutcome): string {
  const id = logStep(intent);
  settleStep(id, outcome);
  return id;
}

export function readLog(): readonly LogStep[] {
  return steps;
}

export function clearLog(): void {
  steps = [];
  announce();
}

export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Runs a plain transaction, logging it and waiting for its receipt.
 *
 * The self-bundled path is covered inside `sendUserOp`, which is where every smart-account
 * action goes. This is for the handful of things an EOA does in its own name — recording a
 * proposal, minting an atom — so those appear in the same transcript instead of happening
 * off to the side.
 */
export async function trackTransaction(
  client: {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<{
      blockNumber: bigint;
      gasUsed: bigint;
      effectiveGasPrice: bigint;
      status: "success" | "reverted";
    }>;
  },
  intent: Omit<StepIntent, "kind">,
  send: () => Promise<Hex>,
): Promise<Hex> {
  const step = logStep({ ...intent, kind: "tx" });
  let hash: Hex;
  try {
    hash = await send();
  } catch (cause) {
    settleStep(step, { status: "failed", error: firstLine(cause) });
    throw cause;
  }
  const receipt = await client.waitForTransactionReceipt({ hash });
  settleStep(step, {
    status: receipt.status === "success" ? "done" : "failed",
    hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    cost: receipt.gasUsed * receipt.effectiveGasPrice,
    ...(receipt.status === "success" ? {} : { error: "reverted" }),
  });
  return hash;
}

/** The first line of a thrown reason, which is the part worth putting in a log row. */
function firstLine(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.split("\n")[0]?.slice(0, 160) ?? "failed";
}
