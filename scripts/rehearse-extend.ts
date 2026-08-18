/**
 * Phase 6 rehearsal — DEMO.md step 5, the centrepiece, end to end on live testnet.
 *
 * Runs the exact `extendGraph` service the panel calls, then re-plans a proposal for the
 * brand-new domain through the UNTOUCHED delegation signed earlier, and confirms it now
 * verifies. That is the bounty's thesis, rehearsed rather than hoped for.
 *
 * Uses a throwaway label (default: `rehearsal <timestamp>`) so the demo's own
 * `motion design` atom stays uncreated for the live run — creating it here would spoil
 * step 5a, which shows the domain not existing yet.
 *
 * Run: bun run rehearse            (or: bun run rehearse "some label")
 */
import { createPublicClient, formatEther, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { intuitionTestnet, readManifest } from "./lib/network";
import { extendGraph, planProposalForcingWitness, preflightProposal } from "../src/lib/demo-actions";
import type { DemoConfig } from "../src/lib/demo-config";
import { readEdgeStates } from "../src/lib/graph";

const STAKE = parseEther("0.005");
const PARENT = "design";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const delegationsPath = join(repoRoot, "data", "delegations.json");

async function main(): Promise<void> {
  const label = process.argv[2] ?? `rehearsal ${new Date().toISOString().slice(0, 16)}`;
  if (!existsSync(delegationsPath)) throw new Error("data/delegations.json missing — run `bun run phase3:delegate`");
  const delegations = JSON.parse(readFileSync(delegationsPath, "utf-8")) as {
    rootDelegation: DemoConfig["delegations"]["root"];
    leafDelegation: DemoConfig["delegations"]["leaf"];
    signedAt: string;
    maxDepth: number;
  };
  const manifest = readManifest();
  const attestor = manifest.attestation.orgAttestor;
  const curveId = manifest.attestation.curveId;
  const accounts = manifest.accounts;
  const submitterKey = process.env["PRIVATE_KEY"];
  if (!attestor || !curveId || !accounts) throw new Error("manifest incomplete — run `bun run seed` / `phase3:setup`");
  if (!submitterKey) throw new Error("PRIVATE_KEY missing (contracts/.env)");

  const client = createPublicClient({
    chain: intuitionTestnet,
    transport: http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]),
  });

  const config: DemoConfig = {
    multiVault: manifest.multiVault,
    enforcer: manifest.contracts.GraphDomainCaveatEnforcer.address,
    governor: manifest.contracts.MockGovernor.address,
    predicate: manifest.vocabulary.predicate,
    nodes: Object.entries(manifest.vocabulary.atoms).map(([name, termId]) => ({ label: name, termId: termId as Hex })),
    edges: Object.entries(manifest.vocabulary.triples).map(([key, tripleId]) => {
      const [child = "", parent = ""] = key.split("->");
      return { child, parent, tripleId: tripleId as Hex };
    }),
    attestor,
    curveId: BigInt(curveId),
    accounts: {
      voter: accounts["voter"] as DemoConfig["accounts"]["voter"],
      delegate: accounts["delegate"] as DemoConfig["accounts"]["delegate"],
      executor: accounts["executor"] as DemoConfig["accounts"]["executor"],
    },
    ownerKeys: { voter: "0x", delegate: "0x", executor: "0x" },
    delegations: {
      root: delegations.rootDelegation,
      leaf: delegations.leafDelegation,
      signedAt: delegations.signedAt,
      maxDepth: delegations.maxDepth,
    },
    submitterKey: submitterKey as `0x${string}`,
    rpcUrl: process.env["INTUITION_TESTNET_RPC"],
  };

  const submitter = privateKeyToAccount(config.submitterKey);
  const startBalance = await client.getBalance({ address: submitter.address });
  console.log(`rehearsing “${label}” under “${PARENT}” · submitter ${formatEther(startBalance)} tTRUST`);

  // Step 5a — the domain must be unauthorized before we touch the graph.
  const edgesBefore = await readEdgeStates(client, config.multiVault, config.edges, config.attestor, config.curveId);
  const planBefore = planProposalForcingWitness(config, edgesBefore, "root", label, "rehearsal before");
  if (!planBefore.blocked) throw new Error(`“${label}” already resolves — pick an unused label`);
  console.log(`  5a  no witness exists yet — ${planBefore.blocked}`);

  // Step 5b — create the atom, link it, stake it.
  const started = Date.now();
  const result = await extendGraph(client, config, label, PARENT, STAKE);
  console.log(`  5b  atom ${result.atomId.slice(0, 12)}… triple ${result.tripleId.slice(0, 12)}… staked ${result.shares} shares`);
  console.log(`      atom tx ${result.atomTx ?? "(existed)"} · triple tx ${result.tripleTx ?? "(existed)"} · deposit ${result.stakeTx}`);

  // Step 5c — the UNTOUCHED delegation must now authorize the new domain.
  const extended: DemoConfig = {
    ...config,
    nodes: [...config.nodes, { label, termId: result.atomId }],
    edges: [...config.edges, { child: label, parent: PARENT, tripleId: result.tripleId }],
  };
  const edgesAfter = await readEdgeStates(client, extended.multiVault, extended.edges, extended.attestor, extended.curveId);
  const planAfter = planProposalForcingWitness(extended, edgesAfter, "root", label, "rehearsal after");
  if (planAfter.blocked) throw new Error(`5c witness still missing: ${planAfter.blocked}`);
  const witness = planAfter.paths.map((entry) => (entry.result.found ? entry.result.labels.join(" → ") : "none")).join(" ; ");
  const preflight = await preflightProposal(client, extended, planAfter);
  if (!preflight.ok) throw new Error(`5c should pass, got ${preflight.revert?.formatted ?? preflight.raw}`);

  const endBalance = await client.getBalance({ address: submitter.address });
  console.log(`  5c  witness [${witness}] verifies against the delegation signed ${new Date(config.delegations.signedAt).toLocaleString()}`);
  console.log(
    `\nrehearsal PASS in ${((Date.now() - started) / 1000).toFixed(1)}s · cost ${formatEther(startBalance - endBalance)} tTRUST · ` +
      `submitter left with ${formatEther(endBalance)} tTRUST`,
  );
  console.log(`“motion design” is untouched — step 5 of DEMO.md is still fresh for the live run.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
