/**
 * The counting rules, proven live on 13579 against the OpenZeppelin governor.
 *
 * What the Intuition Box review found, and what looking for it turned up:
 *
 *   1. A hands `treasury` to B, B votes on a `grants` proposal        -> 200, both voices
 *   2. A takes `treasury` back and votes on the same proposal         -> refused
 *  2b. B tries to carry A somewhere else, having lost the grant       -> refused
 *      and votes with its own weight instead                         -> 100
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
  castOnGovernor,
  planVote,
  readAllBallots,
  readProposals,
  readVoicesCarriedFor,
  revokeWeight,
  signDelegation,
  submitOwnVote,
  submitVote,
} from "../src/lib/actions";
import { readLog } from "../src/lib/chain/tx-log";
import { DelegationSet } from "../src/lib/delegation/delegation-set";
import { grantScope, type Grant } from "../src/lib/delegation/grant";
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
  // per proposal — so this run needs three domains. All three sit under `treasury`, so a
  // single grant on `treasury` covers every one of them: that is rather the point.
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
  const third = pick("retro-funding");

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

  // ── 2b. Revocation stops the next vote, having left the last one standing ────────
  //
  // The symmetry worth stating out loud. A took its domain back, so B may no longer carry
  // it anywhere — and A may not reclaim what B already spent. Neither half is obvious and
  // the demo has to show both.
  //
  // Checked twice over, because they are different claims. The interface works it out from
  // the signatures it holds; the chain refuses it whatever the interface believes.
  const afterRevocation = new DelegationSet(
    [{ from: "A", to: "B", principal: "A", scope: grantScope(config, aRoot), revoked: true, delegation: aRoot }],
    graph,
  );
  check(afterRevocation.chainFor("B", "retro-funding") === null, "the interface stops offering A's voice to B");

  // And the chain refuses the redemption on its own account: taking a domain back disables
  // the signature at the DelegationManager, not merely in the register.
  const staleVote = planVote(config, graph, oneVoice("A", "B", "treasury", aRoot), "retro-funding", third.id, VOTE_FOR);
  const stale = await submitVote(client, config, staleVote);
  check(!stale.success, "and the chain refuses the dead delegation", stale.revert?.formatted ?? "no revert reason");

  // B is not silenced by any of this. Only A's voice left.
  const ownVote = await submitOwnVote(client, config, "B", third.id, VOTE_FOR);
  check(ownVote.success, "B still votes with its own weight", ownVote.revert?.formatted ?? "");
  const afterOwn = (await readProposals(client, config, 40)).find((proposal) => proposal.id === third.id);
  check(afterOwn?.forVotes === 100n, "for its own hundred and nothing more", `for=${afterOwn?.forVotes}`);

  // ── 3. The log still names the voice, and who carried it ─────────────────────────
  //
  // Read after the revocation on purpose. A took its domain back, and what B did with it
  // is still on the chain under A's name: the grant is gone, the record of its use is not.
  // That is the whole proposition — a delegator stays accountable for what was done in its
  // name, and cannot make it go away by withdrawing afterwards.
  const voices = await readVoicesCarriedFor(client, config, config.accounts["A"].smartAccount);
  const onFirst = voices.find((voice) => voice.proposalId === first.id);
  check(onFirst !== undefined, "A's voice appears in the governor's log");
  check(onFirst?.carriedBy === "B", "and it says B carried it", `carriedBy=${onFirst?.carriedBy ?? "—"}`);
  check(onFirst?.weight === 100n, "for the weight that was actually counted", `weight=${onFirst?.weight}`);

  // The shape the interface keys on, asserted so it cannot drift. `ballotFor` finds the
  // viewer by `principal` and reads `carriedBy` to tell "I voted" from "my delegate voted
  // for me" — two states it used to conflate, which left the vote buttons enabled for an
  // account whose voice was already spent and sent it into a contract error.
  const ballots = (await readAllBallots(client, config))[first.id.toString()] ?? [];
  const carriedEntry = ballots
    .flatMap((ballot) => ballot.entries)
    .find((entry) => entry.principal === "A" && entry.carriedBy === "B");
  check(carriedEntry !== undefined, "the ballot shows A's voice under B, not under A");
  check(carriedEntry?.weight === 100n, "with the share that was counted for it", `weight=${carriedEntry?.weight}`);

  // ── 4. Three levels, through the code the interface runs ─────────────────────────
  //
  // Not a hand-built chain this time. The grants go into a DelegationSet, `chainFor`
  // works out what C can redeem, and `castOnGovernor` casts the vote — which is, line for
  // line, what ChainPanel and ProposalsPanel do. That matters: the two paths diverged once
  // already, and a three-level vote worked here while failing in the interface.
  const aToB2 = await signDelegation(client, config, "A", "B", "treasury");
  const bToC = await signDelegation(client, config, "B", "C", "treasury", aToB2.map((e) => e.delegation));

  const grants: Grant[] = [
    ...aToB2.map(({ delegation }) => ({
      from: "A" as Role,
      to: "B" as Role,
      principal: "A" as Role,
      scope: grantScope(config, delegation),
      revoked: false,
      delegation,
    })),
    // `relays` is set on the delegation that passes on a voice B was lent, rather than
    // B's own — which is what decides whose weight the chain carries.
    ...bToC.map(({ delegation, relays }) => ({
      from: "B" as Role,
      to: "C" as Role,
      principal: (relays ? "A" : "B") as Role,
      scope: grantScope(config, delegation),
      revoked: false,
      delegation,
    })),
  ];

  const threeLevel = new DelegationSet(grants, graph).chainFor("C", "payroll");
  check(threeLevel?.voices.length === 2, "C holds two voices", `principals=${threeLevel?.principals.join(", ")}`);

  const cVote = await castOnGovernor(
    client,
    config,
    "C",
    second.id,
    VOTE_FOR,
    threeLevel,
    graph.domainPathOf("payroll"),
    (voice) => voice.scopes.map((scope) => graph.witnessTo("payroll", scope)),
  );
  check(cVote.success, "C votes on `payroll`, carrying B and A", cVote.revert?.formatted ?? "");

  const afterC = (await readProposals(client, config, 40)).find((proposal) => proposal.id === second.id);
  check(afterC?.forVotes === 300n, "the voice of A reached the end of the chain", `for=${afterC?.forVotes}`);

  // ── 5. And the log says which signature was spent ────────────────────────────────
  //
  // The point of the whole thing, so it is asserted rather than admired: the hash the
  // redemption names has to be one of the hashes that were signed.
  const redemption = readLog()
    .filter((step) => step.kind === "userop" && step.label.includes("redeems the delegation"))
    .at(-1);
  check(redemption !== undefined, "the log names the redemption, not just the vote", redemption?.label ?? "");
  const named = new Set(
    redemption?.calls.flatMap((call) => (call.args?.["delegation hash"] ? [call.args["delegation hash"]] : [])) ?? [],
  );
  const signedHashes = new Set([...aToB2, ...bToC].map((entry) => entry.delegation.hash as string));
  check(named.size > 0, "and the delegation hashes it walked", `${named.size} link(s)`);
  check(
    [...named].every((hash) => signedHashes.has(hash)),
    "each of which is a signature made in this run",
    [...named].map((h) => `${h.slice(0, 10)}…`).join(" "),
  );

  // ── Put the register back, so the demo opens clean ───────────────────────────────
  await revokeWeight(client, config, "B", "treasury", bToC.map((e) => e.delegation));
  await revokeWeight(client, config, "A", "treasury", aToB2.map((e) => e.delegation));
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
