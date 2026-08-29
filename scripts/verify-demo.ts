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
import { createPublicClient, http } from "viem";

import { intuitionTestnet } from "./lib/network";
import { configFromManifest } from "./lib/demo-config";
import { isDelegationDisabled } from "../src/lib/delegation";
import { planVoteForcingWitness, preflightVote, readProposals, VOTE_FOR } from "../src/lib/demo-actions";
import { DelegationSet } from "../src/lib/delegation-set";
import { DomainGraph } from "../src/lib/domain-graph";
import { baseGrants } from "../src/lib/grants";
import type { Role } from "../src/lib/demo-config";
import { readEdgeStates } from "../src/lib/graph";


/**
 * The demo script's claims, as assertions: who votes, on which domain, and what the
 * chain does about it. `heldOn` is the domain the voter's chain was actually granted on —
 * for the failing cases it differs from the domain being voted, which is the point: the
 * chain is real and gets redeemed, and the enforcer is what refuses it.
 */
const EXPECTATIONS: Array<{ domain: string; voter: Role; heldOn?: string; expect: "pass" | string }> = [
  { domain: "UX", voter: "executor", expect: "pass" },
  { domain: "branding", voter: "delegate", expect: "pass" },
  { domain: "logo", voter: "delegate", expect: "pass" },
  { domain: "legal", voter: "delegate", heldOn: "design", expect: "NotATriple" },
  { domain: "branding", voter: "executor", heldOn: "UX", expect: "NotATriple" },
];

async function main(): Promise<void> {
  const config = configFromManifest();
  const client = createPublicClient({
    chain: intuitionTestnet,
    transport: http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]),
  });

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
  if (rootDisabled || leafDisabled) fail(`delegation chain is revoked (root=${rootDisabled} leaf=${leafDisabled}) — re-sign with \`bun run phase3:delegate\``);
  else console.log(`ok    delegation chain active, signed ${new Date(config.delegations.signedAt).toLocaleString()}`);

  const grants = new DelegationSet(baseGrants(config, rootDisabled, leafDisabled), graph);

  // Panel 3 — each demo claim, simulated on live contracts against real proposals.
  // Newest first, so a domain proposed more than once verifies against its latest.
  const recent = await readProposals(client, config, 40);
  for (const expectation of EXPECTATIONS) {
    // Each claim needs a proposal on its domain: the enforcer resolves the domain from
    // the governor, so there is nothing to check without one. This script is read-only,
    // so it reuses what the governor already holds.
    // An already-voted proposal would fail with AlreadyVoted rather than the reason under
    // test, so only unvoted, still-active ones are usable here.
    const domainId = config.nodes.find((node) => node.label === expectation.domain)?.termId?.toLowerCase();
    const existing = recent.find(
      (proposal) =>
        proposal.domainId.toLowerCase() === domainId &&
        proposal.state === "active" &&
        proposal.forVotes + proposal.againstVotes + proposal.abstainVotes === 0n,
    );
    if (!existing) {
      fail(`no fresh active proposal on “${expectation.domain}” — record one in the app before presenting`);
      continue;
    }
    // Resolve the chain on the domain it was granted on, then aim it at the domain under
    // test: a failing case has to reach the enforcer to be refused by it.
    const resolved = grants.chainFor(expectation.voter, expectation.heldOn ?? expectation.domain);
    if (!resolved) {
      fail(`no signed chain lets ${expectation.voter} vote on “${expectation.heldOn ?? expectation.domain}”`);
      continue;
    }
    const plan = planVoteForcingWitness(config, graph, resolved, expectation.domain, existing.id, VOTE_FOR);
    const result = await preflightVote(client, config, plan);
    const witness = plan.paths
      .map((entry) => (entry.result.found ? entry.result.labels.join(" → ") : `none up to ${entry.rootLabel}`))
      .join(" ; ");
    const label = `vote on ${expectation.domain} as ${expectation.voter} [${witness}]`;
    if (expectation.expect === "pass") {
      if (result.ok) console.log(`ok    ${label} passes`);
      else fail(`${label} should pass but got ${result.revert?.formatted ?? result.raw}`);
    } else if (!result.ok && result.revert?.name === expectation.expect) {
      console.log(`ok    ${label} rejected with ${result.revert.formatted}`);
    } else {
      fail(`${label} should fail with ${expectation.expect}, got ${result.ok ? "success" : result.revert?.formatted ?? result.raw}`);
    }
  }

  const proposals = await readProposals(client, config, 3);
  console.log(`ok    governor holds ${proposals.length > 0 ? `${proposals.length} recent proposal(s), latest #${proposals[0]?.id}` : "no proposals yet"}`);

  console.log(failures === 0 ? "\nDemo is ready — every panel verified against live state." : `\n${failures} check(s) failed — fix before presenting.`);
  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
