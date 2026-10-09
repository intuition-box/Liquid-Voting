/**
 * Rehearsal — docs/DEMO.md step 5, the centrepiece, end to end on live testnet.
 *
 * Runs the exact `extendGraph` service the panel calls, then re-plans a proposal for the
 * brand-new domain through the UNTOUCHED delegation signed earlier, and confirms it now
 * verifies. That is the bounty's thesis, rehearsed rather than hoped for.
 *
 * Uses a throwaway label (default: `rehearsal <timestamp>`) so the demo's own
 * `audit-fund` atom stays uncreated for the live run — creating it here would spoil
 * step 5a, which shows the domain not existing yet.
 *
 * Run: bun run rehearse            (or: bun run rehearse "some label")
 */
import { formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { configFromManifest } from "./lib/config";
import { createChainClient } from "../src/lib/chain/network";
import type { AppConfig } from "../src/lib/config/app-config";
import {
  extendGraph,
  planVoteForcingWitness,
  preflightVote,
  recordProposal,
  VOTE_FOR,
} from "../src/lib/actions";
import { DelegationSet } from "../src/lib/delegation/delegation-set";
import { DomainGraph } from "../src/lib/graph/domain-graph";
import { baseGrants } from "../src/lib/delegation/grant";
import { readEdgeStates } from "../src/lib/graph/edges";

const STAKE = parseEther("0.005");
const PARENT = "treasury";


async function main(): Promise<void> {
  const label = process.argv[2] ?? `rehearsal ${new Date().toISOString().slice(0, 16)}`;
  const submitterKey = process.env["PRIVATE_KEY"];
  if (!submitterKey) throw new Error("PRIVATE_KEY missing (contracts/.env)");
  const config = configFromManifest(submitterKey);
  // The batching client: these scripts issue hundreds of reads in a burst, which is
  // what exhausted the public RPC's allowance before.
  const client = createChainClient(process.env["INTUITION_TESTNET_RPC"]);

  const submitter = privateKeyToAccount(config.submitterKey);
  const startBalance = await client.getBalance({ address: submitter.address });
  console.log(`rehearsing “${label}” under “${PARENT}” · submitter ${formatEther(startBalance)} tTRUST`);

  // Step 5a — the domain must be unauthorized before we touch the graph.
  const edgesBefore = await readEdgeStates(client, config.multiVault, config.edges, config.attestor, config.curveId);
  const graphBefore = DomainGraph.from(config.nodes, edgesBefore);
  const chainBefore = new DelegationSet(baseGrants(config, false, false), graphBefore).chainFor("B", PARENT);
  if (!chainBefore) throw new Error("no signed chain hands the delegate this domain — run `bun run delegate`");
  const planBefore = planVoteForcingWitness(config, graphBefore, chainBefore, label, 0n, VOTE_FOR);
  if (!planBefore.blocked) throw new Error(`“${label}” already resolves — pick an unused label`);
  console.log(`  5a  no witness exists yet — ${planBefore.blocked}`);

  // Step 5b — create the atom, link it, stake it.
  const started = Date.now();
  const result = await extendGraph(client, config, label, PARENT, STAKE);
  console.log(`  5b  atom ${result.atomId.slice(0, 12)}… triple ${result.tripleId.slice(0, 12)}… staked ${result.shares} shares`);
  console.log(`      atom tx ${result.atomTx ?? "(existed)"} · triple tx ${result.tripleTx ?? "(existed)"} · deposit ${result.stakeTx}`);

  // Step 5c — the UNTOUCHED delegation must now authorize the new domain.
  const extended: AppConfig = {
    ...config,
    nodes: [...config.nodes, { label, termId: result.atomId }],
    edges: [...config.edges, { child: label, parent: PARENT, tripleId: result.tripleId }],
  };
  const edgesAfter = await readEdgeStates(client, extended.multiVault, extended.edges, extended.attestor, extended.curveId);
  const { proposalId } = await recordProposal(client, extended, label, "rehearsal after");
  const graphAfter = DomainGraph.from(extended.nodes, edgesAfter);
  const chainAfter = new DelegationSet(baseGrants(extended, false, false), graphAfter).chainFor("B", PARENT);
  if (!chainAfter) throw new Error("the signed chain vanished between the two reads");
  const planAfter = planVoteForcingWitness(extended, graphAfter, chainAfter, label, proposalId, VOTE_FOR);
  if (planAfter.blocked) throw new Error(`5c witness still missing: ${planAfter.blocked}`);
  const witness = planAfter.paths.map((entry) => (entry.result.found ? entry.result.labels.join(" → ") : "none")).join(" ; ");
  const preflight = await preflightVote(client, extended, planAfter);
  if (!preflight.ok) throw new Error(`5c should pass, got ${preflight.revert?.formatted ?? preflight.raw}`);

  const endBalance = await client.getBalance({ address: submitter.address });
  console.log(`  5c  witness [${witness}] verifies against the delegation signed ${new Date(config.delegations.signedAt).toLocaleString()}`);
  console.log(
    `\nrehearsal PASS in ${((Date.now() - started) / 1000).toFixed(1)}s · cost ${formatEther(startBalance - endBalance)} tTRUST · ` +
      `submitter left with ${formatEther(endBalance)} tTRUST`,
  );
  console.log(`“audit-fund” is untouched — step 5 of docs/DEMO.md is still fresh for the live run.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
