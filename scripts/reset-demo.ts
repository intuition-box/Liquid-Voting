/**
 * Puts the demo back to its opening state.
 *
 * Two different things, and only one of them can actually be undone.
 *
 * Delegations are state: whoever handed a domain over takes it back, and the register is
 * empty again. Votes are history — a governor has no way to un-count one, and would be a
 * poor governor if it did — so a proposal that has been voted on is replaced by a fresh
 * one on the same domain rather than cleared.
 *
 * Run: bun run reset
 */
import { createPublicClient, http } from "viem";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { intuitionTestnet } from "./lib/network";
import { configFromManifest } from "./lib/config";
import { readAllBallots, readDelegatedTo, readProposals, recordProposal, revokeWeight } from "../src/lib/actions";
import { DomainGraph } from "../src/lib/graph/domain-graph";
import { readEdgeStates } from "../src/lib/graph/edges";
import { ROLES, type Role } from "../src/lib/roles";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const submitterKey = process.env["PRIVATE_KEY"];
  if (!submitterKey) throw new Error("PRIVATE_KEY missing (contracts/.env)");
  const config = configFromManifest(submitterKey);

  // The owner keys the app uses in dev, so a delegation made in the browser can be taken
  // back from here.
  const stored = JSON.parse(readFileSync(join(repoRoot, "data", "accounts.json"), "utf-8")) as {
    keys: Record<string, `0x${string}`>;
  };
  for (const role of ROLES) config.ownerKeys[role] = stored.keys[role];

  const client = createPublicClient({
    chain: intuitionTestnet,
    transport: http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]),
  });
  const edges = await readEdgeStates(client, config.multiVault, config.edges, config.attestor, config.curveId);
  const graph = DomainGraph.from(config.nodes, edges);
  const labels = config.nodes.map((node) => node.label);

  // 1. Every delegation goes back to whoever made it.
  const register = await readDelegatedTo(client, config, labels);
  const held = Object.entries(register).flatMap(([scope, byRole]) =>
    Object.keys(byRole).map((from) => ({ from: from as Role, scope })),
  );
  if (held.length === 0) console.log("no delegation to take back");
  for (const { from, scope } of held) {
    const result = await revokeWeight(client, config, from, scope);
    console.log(`  ${from} takes “${scope}” back — ${result.success ? "done" : "FAILED"}`);
  }

  // 2. Any domain whose only open proposal has been voted on gets a fresh one, since a
  //    vote cannot be withdrawn.
  const ballots = await readAllBallots(client, config);
  const proposals = await readProposals(client, config, 80);
  const untouched = new Set(
    proposals
      .filter((proposal) => proposal.state === "active" && !ballots[proposal.id.toString()])
      .map((proposal) => graph.labelOf(proposal.domainId))
      .filter((label): label is string => label !== undefined),
  );

  const needed = labels.filter((label) => !untouched.has(label));
  if (needed.length === 0) console.log("every domain already has an unvoted proposal");
  for (const label of needed) {
    const { proposalId } = await recordProposal(client, config, label, `Decide the next step for ${label}`);
    console.log(`  “${label}” gets a fresh proposal #${proposalId}`);
  }

  console.log("\nBack to the opening state. Run `bun run verify` to confirm it.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
