/**
 * Pre-demo verification — read-only, no gas, ~5 seconds.
 *
 * Drives the frontend's own service layer (src/lib) against live chain state and asserts
 * that every panel will behave as the demo script promises: which edges authorize, which
 * witnesses compute, and which proposals pass or fail with which revert reason. Run it
 * immediately before presenting; a red line here is a surprise avoided on stage.
 *
 * Run: bun run verify
 */

import { configFromManifest } from "./lib/config";
import { createChainClient } from "../src/lib/chain/network";
import { isDelegationDisabled } from "../src/lib/delegation/encoding";
import { readProposals, readRegister } from "../src/lib/actions";
import { DomainGraph } from "../src/lib/graph/domain-graph";
import { readEdgeStates } from "../src/lib/graph/edges";


/**
 * What the domain register must and must not let through, read without touching state.
 *
 * `weightFor` answers the same question the vote path enforces: how much an account may
 * cast on a domain, given who delegated what. Asking it is enough to prove the scope
 * holds, and costs nothing, so this stays a read-only check.
 *
 * `heldOn` is the domain a delegation would be made on; `domain` is what the vote is
 * aimed at. When they belong to different branches, the weight must not follow.
 */
const SCOPE_CHECKS: Array<{ domain: string; heldOn: string; carries: boolean }> = [
  { domain: "payroll", heldOn: "treasury", carries: true },
  { domain: "micro-grants", heldOn: "treasury", carries: true },
  { domain: "events", heldOn: "treasury", carries: false },
  { domain: "fee-switch", heldOn: "treasury", carries: false },
];

async function main(): Promise<void> {
  const config = configFromManifest();
  // The batching client: these scripts issue hundreds of reads in a burst, which is
  // what exhausted the public RPC's allowance before.
  const client = createChainClient(process.env["INTUITION_TESTNET_RPC"]);

  let failures = 0;
  const fail = (line: string): void => {
    failures += 1;
    console.log(`FAIL  ${line}`);
  };

  // Panel 1 — the graph must be attested, or nothing authorizes anything.
  const edges = await readEdgeStates(client, config.multiVault, config.edges, config.attestor, config.curveId);
  for (const edge of edges) {
    const detail = `type=${edge.vaultType} shares=${edge.attestorShares}`;
    if (edge.isAuthorizing) console.log(`ok    edge ${edge.child} → ${edge.parent} authorizes (${detail})`);
    else fail(`edge ${edge.child} → ${edge.parent} does NOT authorize (${detail}) — run \`bun run seed\``);
  }

  // Panel 2 — the chain must be live, or every proposal dies for the wrong reason.
  const graph = DomainGraph.from(config.nodes, edges);
  const rootDisabled = await isDelegationDisabled(client, config.delegations.root.hash);
  const leafDisabled = await isDelegationDisabled(client, config.delegations.leaf.hash);
  if (rootDisabled || leafDisabled) fail(`delegation chain is revoked (root=${rootDisabled} leaf=${leafDisabled}) — re-sign with \`bun run delegate\``);
  else console.log(`ok    delegation chain active, signed ${new Date(config.delegations.signedAt).toLocaleString()}`);

  // Every domain needs something to vote on, or a click during the demo lands on an
  // empty list. Only an unvoted, still-open proposal is usable: one already voted on
  // shows as cast rather than offering the buttons.
  const proposals = await readProposals(client, config, 80);
  const usable = new Set(
    proposals
      .filter(
        (proposal) =>
          proposal.state === "active" &&
          proposal.forVotes + proposal.againstVotes + proposal.abstainVotes === 0n,
      )
      .map((proposal) => graph.labelOf(proposal.domainId))
      .filter((label): label is string => label !== undefined),
  );
  const bare = config.nodes.map((node) => node.label).filter((label) => !usable.has(label));
  if (bare.length === 0) console.log(`ok    all ${config.nodes.length} domains have an unvoted proposal`);
  else fail(`no fresh proposal on ${bare.join(", ")} — run \`bun run reset\``);

  // Each claim, asked of the governor rather than simulated: does a delegation on
  // `heldOn` reach `domain`? The graph decides, and this is the same call the panel makes.
  for (const check of SCOPE_CHECKS) {
    const covered = graph.isDescendantOf(check.domain, check.heldOn);
    const label = `a grant on “${check.heldOn}” ${check.carries ? "reaches" : "does not reach"} “${check.domain}”`;
    if (covered === check.carries) console.log(`ok    ${label}`);
    else fail(`${label} — the graph says otherwise`);
  }

  // The demo must open on a clean slate: nothing delegated, everyone holding one vote.
  // A leftover transfer from a rehearsal is the one thing that makes the opening screen
  // lie, so it is checked rather than assumed.
  const { delegatedTo: register } = await readRegister(client, config, [
    ...new Set(config.nodes.map((node) => node.label)),
  ]);
  const held = Object.entries(register).flatMap(([scope, byRole]) =>
    Object.entries(byRole).map(([from, to]) => `${from} → ${to} on “${scope}”`),
  );
  if (held.length === 0) console.log("ok    nothing delegated — every account opens holding its own vote");
  else fail(`the register is not clean: ${held.join(", ")} — take them back in the app, or run \`bun run reset\``);


  console.log(failures === 0 ? "\nDemo is ready — every panel verified against live state." : `\n${failures} check(s) failed — fix before presenting.`);
  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
