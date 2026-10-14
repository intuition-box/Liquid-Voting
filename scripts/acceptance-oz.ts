/**
 * The counting rules, proven live on 13579 against the OpenZeppelin governor.
 *
 * What the Intuition Box review found, and what looking for it turned up:
 *
 *   1. A hands `treasury` to B, B votes on a `grants` proposal        -> 200, both voices
 *   2. A takes `treasury` back and votes on the same proposal         -> refused
 *   3. the governor's log names both voices and who carried them      -> readable
 *   4. A -> B -> C, and C votes                                      -> 300, all three
 *
 * Step 2 is the bug: a lending moves no token, so until the governor kept its own ledger
 * the register said A had kept everything and A could cast weight B had already spent.
 * Step 4 is the one nobody had noticed — following a single hop stranded A's weight at B.
 *
 * Every step goes through src/lib, so this runner and the frontend exercise identical
 * code. Expected passes are real self-bundled user operations (ADR 0010); the expected
 * failure is read off the EntryPoint's revert reason rather than asserted from the
 * outside.
 *
 * Run: bun run acceptance
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";

import { configFromManifest } from "./lib/config";
import { createChainClient } from "../src/lib/chain/network";
import {
  planVote,
  readProposals,
  readVoicesCarriedFor,
  revokeWeight,
  signDelegation,
  submitOwnVote,
  submitVote,
} from "../src/lib/actions";
import { VOTE_FOR, type Delegation } from "../src/lib/delegation/encoding";
import { DomainGraph } from "../src/lib/graph/domain-graph";
import { readEdgeStates } from "../src/lib/graph/edges";
import type { RedeemableChain } from "../src/lib/delegation/delegation-set";
import { ROLES, type Role } from "../src/lib/roles";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;

function check(ok: boolean, label: string, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok   " : "FAIL "} ${label}${detail ? `  ${detail}` : ""}`);
}

/** One voice, carried by `to`, through the delegation `from` just signed. */
function oneVoice(
  principal: Role,
  redeemer: Role,
  scope: string,
  delegation: Delegation & { hash: Hex },
  upstream: (Delegation & { hash: Hex })[] = [],
): RedeemableChain {
  return {
    redeemer,
    // Leaf first, which is the order the DelegationManager walks a chain in.
    voices: [{ principal, chain: [delegation, ...upstream], scopes: [scope, ...upstream.map(() => scope)] }],
    principals: [principal],
  };
}

async function main(): Promise<void> {
  const submitterKey = process.env["PRIVATE_KEY"];
  if (!submitterKey) throw new Error("PRIVATE_KEY missing (contracts/.env)");
  const config = configFromManifest(submitterKey);

  const stored = JSON.parse(readFileSync(join(repoRoot, "data", "accounts.json"), "utf-8")) as {
    keys: Record<string, `0x${string}`>;
  };
  for (const role of ROLES) config.ownerKeys[role] = stored.keys[role];

  const client = createChainClient(process.env["INTUITION_TESTNET_RPC"]);
  const edges = await readEdgeStates(client, config.multiVault, config.edges, config.attestor, config.curveId);
  const graph = DomainGraph.from(config.nodes, edges);

  // One proposal per domain is what `reset` lays out, and a voice is only spendable once
  // per proposal — so the two halves of this run need two domains. Both sit under
  // `treasury`, so one grant on `treasury` covers both: that is rather the point.
  const open = await readProposals(client, config, 40);
  const pick = (domain: string) => {
    const id = graph.termId(domain);
    const found = open.find(
      (proposal) =>
        proposal.state === "active" &&
        proposal.domainId === id &&
        proposal.forVotes === 0n &&
        proposal.againstVotes === 0n,
    );
    if (!found) throw new Error(`no unvoted active proposal on \`${domain}\` — run \`bun run reset\``);
    return found;
  };
  const first = pick("grants");
  const second = pick("payroll");

  // ── 1. A hands treasury to B, and B votes carrying it ────────────────────────────
  const aToB = await signDelegation(client, config, "A", "B", "treasury");
  const aRoot = aToB[0]?.delegation;
  if (!aRoot) throw new Error("A's delegation did not come back signed");

  const carried = oneVoice("A", "B", "treasury", aRoot);
  const plan = planVote(config, graph, carried, "grants", first.id, VOTE_FOR);
  if (plan.blocked) throw new Error(`the vote could not be planned: ${plan.blocked}`);
  const bVote = await submitVote(client, config, plan);
  check(bVote.success, "B votes on `grants`, carrying A", bVote.revert?.formatted ?? "");

  const afterB = (await readProposals(client, config, 40)).find((proposal) => proposal.id === first.id);
  check(afterB?.forVotes === 200n, "both voices counted, and only once each", `for=${afterB?.forVotes}`);

  // ── 2. A takes it back and tries again on the same proposal ──────────────────────
  const taken = await revokeWeight(client, config, "A", "treasury", [aRoot]);
  check(taken.success, "A takes `treasury` back", taken.revert?.formatted ?? "");

  const reVote = await submitOwnVote(client, config, "A", first.id, VOTE_FOR);
  check(!reVote.success, "A cannot cast a voice B already spent", reVote.revert?.formatted ?? "no revert reason");

  const stillTwoHundred = (await readProposals(client, config, 40)).find((proposal) => proposal.id === first.id);
  check(stillTwoHundred?.forVotes === 200n, "and the tally never moved", `for=${stillTwoHundred?.forVotes}`);

  // ── 3. The log names the voice and who carried it ─────────────────────────────────
  const voices = await readVoicesCarriedFor(client, config, config.accounts["A"].smartAccount);
  const onFirst = voices.find((voice) => voice.proposalId === first.id);
  check(onFirst !== undefined, "A's voice appears in the governor's log");
  check(onFirst?.carriedBy === "B", "and it says B carried it", `carriedBy=${onFirst?.carriedBy ?? "—"}`);
  check(onFirst?.weight === 100n, "for the weight that was actually counted", `weight=${onFirst?.weight}`);

  // ── 4. Three levels, on the second proposal ──────────────────────────────────────
  const aToB2 = await signDelegation(client, config, "A", "B", "treasury");
  const root2 = aToB2[0]?.delegation;
  if (!root2) throw new Error("A's second delegation did not come back signed");

  // B relays what it was lent, so the chain C redeems carries A's voice behind B's own.
  const bToC = await signDelegation(client, config, "B", "C", "treasury", [root2]);
  const relay = bToC.find((entry) => entry.relays !== null)?.delegation;
  const bOwn = bToC[0]?.delegation;
  if (!relay || !bOwn) throw new Error("B's relay did not come back signed");

  const threeLevel: RedeemableChain = {
    redeemer: "C",
    voices: [
      { principal: "B", chain: [bOwn], scopes: ["treasury"] },
      { principal: "A", chain: [relay, root2], scopes: ["treasury", "treasury"] },
    ],
    principals: ["B", "A"],
  };
  const chainPlan = planVote(config, graph, threeLevel, "payroll", second.id, VOTE_FOR);
  if (chainPlan.blocked) throw new Error(`the three-level vote could not be planned: ${chainPlan.blocked}`);
  const cVote = await submitVote(client, config, chainPlan);
  check(cVote.success, "C votes on `payroll`, carrying B and A", cVote.revert?.formatted ?? "");

  const afterC = (await readProposals(client, config, 40)).find((proposal) => proposal.id === second.id);
  check(afterC?.forVotes === 300n, "the voice of A reached the end of the chain", `for=${afterC?.forVotes}`);

  // ── Put the register back, so the demo opens clean ───────────────────────────────
  await revokeWeight(client, config, "B", "treasury", [bOwn, relay]);
  await revokeWeight(client, config, "A", "treasury", [root2]);
  console.log("\nregister cleared — run `bun run reset` for fresh proposals");

  if (failures > 0) {
    console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed`);
    process.exit(1);
  }
  console.log("every counting rule holds on chain");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
