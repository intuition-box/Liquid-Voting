/**
 * Delegated voting, live on 13579 — the demo's central claim.
 *
 * A signs a delegation authorising B to vote in its name, scoped to `design` in the
 * Intuition graph. B redeems it and votes once, weighing 2 — its own vote plus A's:
 *
 *   1. voting power assigned, proposals recorded under branding + legal  -> setup
 *   2. B redeems A's delegation and votes on `branding`                  -> PASSES (weight 2)
 *   3. B tries the same on `legal`                                       -> FAILS  NotATriple
 *   4. B votes on `legal` for itself, no delegation                      -> PASSES (weight 1)
 *   5. narrowing: the UX-scoped leaf blocks a `branding` vote            -> FAILS  NotATriple
 *
 * Who the vote belongs to: the framework executes from the root delegator's account, so
 * `msg.sender` at the governor is A. B names itself in the calldata's `voter` field and
 * the enforcer binds that field to the redeemer, so only the account that actually
 * redeemed can be named. The vote is recorded as B's, weighted by A's delegated power,
 * and `VoteCastOnBehalf` keeps the split auditable.
 *
 * Step 4 is the pair to step 3: B is not silenced, only A's delegated weight is refused —
 * no attested path connects `legal` to the `design` A delegated.
 *
 * Expected-pass cases run as real self-bundled user operations (ADR 0010). Expected-fail
 * cases are proven with an eth_call preflight against live contracts, which surfaces the
 * enforcer's own revert without burning gas. Both paths go through src/lib, so the
 * frontend and this runner exercise identical code.
 *
 * Run: bun run vote:run
 */
import { createPublicClient, createWalletClient, encodeFunctionData, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { intuitionTestnet, readManifest } from "./lib/network";
import { governorAbi } from "../src/lib/abis";
import { FRAMEWORK } from "../src/lib/chain";
import { buildVoteCalldata, preflightRedeem, VOTE_FOR, type Delegation } from "../src/lib/delegation";
import { toHybridAccount } from "../src/lib/smart-accounts";
import { sendUserOp } from "../src/lib/user-op";

const VOTING_POWER = 1n;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const accountsPath = join(repoRoot, "data", "accounts.json");
const delegationsPath = join(repoRoot, "data", "delegations.json");

interface SignedDelegations {
  rootDelegation: Delegation & { hash: Hex };
  leafDelegation: Delegation & { hash: Hex };
}

async function main(): Promise<void> {
  if (!existsSync(accountsPath) || !existsSync(delegationsPath)) {
    throw new Error("run phase3:setup and phase3:delegate first");
  }
  const stored = JSON.parse(readFileSync(accountsPath, "utf-8")) as { keys: Record<string, `0x${string}`> };
  const signed = JSON.parse(readFileSync(delegationsPath, "utf-8")) as SignedDelegations;
  const manifest = readManifest();
  const governor = manifest.contracts.MockGovernor.address;
  const atoms = manifest.vocabulary.atoms as Record<string, Hex>;
  const design = atoms["design"] as Hex;
  const branding = atoms["branding"] as Hex;
  const ux = atoms["UX"] as Hex;
  const legal = atoms["legal"] as Hex;

  const transport = http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: intuitionTestnet, transport });
  const submitter = createWalletClient({
    chain: intuitionTestnet,
    transport,
    account: privateKeyToAccount((process.env["PRIVATE_KEY"] ?? "") as `0x${string}`),
  });
  const voterSA = await toHybridAccount(publicClient, privateKeyToAccount(stored.keys["voter"] as `0x${string}`));
  const delegateSA = await toHybridAccount(publicClient, privateKeyToAccount(stored.keys["delegate"] as `0x${string}`));
  const executorSA = await toHybridAccount(publicClient, privateKeyToAccount(stored.keys["executor"] as `0x${string}`));

  const root: Delegation = { ...signed.rootDelegation };
  const leaf: Delegation = { ...signed.leafDelegation };
  const manager = FRAMEWORK.delegationManager;
  const gov = { address: governor, abi: governorAbi } as const;

  console.log(`A (voter)    ${voterSA.address}`);
  console.log(`B (delegate) ${delegateSA.address}`);
  console.log(`governor     ${governor}\n`);

  // ── 1. Voting power + a proposal per domain ────────────────────────────────────
  for (const [label, account] of [
    ["A", voterSA.address],
    ["B", delegateSA.address],
  ] as const) {
    const current = await publicClient.readContract({ ...gov, functionName: "votingPower", args: [account] });
    if (current !== VOTING_POWER) {
      const hash = await submitter.writeContract({
        ...gov,
        functionName: "setVotingPower",
        args: [account, VOTING_POWER],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    console.log(`   ${label} voting power ${VOTING_POWER}`);
  }

  async function record(domainId: Hex, description: string): Promise<bigint> {
    const before = await publicClient.readContract({ ...gov, functionName: "proposalCount" });
    const hash = await submitter.writeContract({ ...gov, functionName: "propose", args: [domainId, description] });
    await publicClient.waitForTransactionReceipt({ hash });
    return before;
  }

  const brandingProposal = await record(branding, "Refresh the brand system");
  const legalProposal = await record(legal, "Update the terms of service");
  console.log(`1. SETUP proposal #${brandingProposal} on branding, #${legalProposal} on legal\n`);

  // VOTING_DELAY blocks must pass before a proposal turns Active; poll until both are.
  for (const proposalId of [brandingProposal, legalProposal]) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const proposalState = await publicClient.readContract({ ...gov, functionName: "state", args: [proposalId] });
      if (proposalState === 1) break;
      if (proposalState !== 0) throw new Error(`proposal #${proposalId} is in state ${proposalState}, expected Active`);
      await publicClient.waitForTransactionReceipt({
        hash: await submitter.sendTransaction({ to: submitter.account.address, value: 0n }),
      });
    }
  }
  console.log(`   both proposals are Active\n`);

  // ── 2. B votes on `branding` carrying A's weight — the delegated vote ───────────
  {
    const calldata = buildVoteCalldata({
      chain: [root],
      witnesses: [[branding, design]],
      governor,
      proposalId: brandingProposal,
      support: VOTE_FOR,
      // B is the voter — it redeemed A's delegation — and carries A's weight with it.
      voter: delegateSA.address,
      principals: [voterSA.address],
    });
    const pre = await preflightRedeem(publicClient, delegateSA.address, calldata);
    if (!pre.ok) throw new Error(`case 2 preflight failed: ${pre.revert?.formatted ?? pre.raw}`);
    const op = await sendUserOp(publicClient, submitter, delegateSA, [{ to: manager, value: 0n, data: calldata }]);
    if (!op.success) throw new Error(`case 2 user op failed: ${op.revert?.formatted ?? op.revertData}`);

    const [, forVotes] = await publicClient.readContract({
      ...gov,
      functionName: "proposalVotes",
      args: [brandingProposal],
    });
    const aCounted = await publicClient.readContract({
      ...gov,
      functionName: "hasVoted",
      args: [brandingProposal, voterSA.address],
    });
    const bCounted = await publicClient.readContract({
      ...gov,
      functionName: "hasVoted",
      args: [brandingProposal, delegateSA.address],
    });
    if (forVotes !== VOTING_POWER * 2n || !aCounted || !bCounted) {
      throw new Error(`case 2: expected weight 2 with A and B counted, got ${forVotes} / A=${aCounted} B=${bCounted}`);
    }
    console.log(`2. PASS  B redeemed A's delegation and voted on branding — recorded as B, weight ${forVotes} (tx ${op.txHash})`);
    console.log(`         B's own ${VOTING_POWER} + A's ${VOTING_POWER}, witness [branding → design] verified against the delegation A signed`);
  }

  // ── 3. B cannot exercise A's weight on `legal` ─────────────────────────────────
  {
    const calldata = buildVoteCalldata({
      chain: [root],
      witnesses: [[legal, design]],
      governor,
      proposalId: legalProposal,
      support: VOTE_FOR,
      voter: delegateSA.address,
      principals: [voterSA.address],
    });
    const pre = await preflightRedeem(publicClient, delegateSA.address, calldata);
    if (pre.ok || pre.revert?.name !== "NotATriple") {
      throw new Error(`case 3 expected NotATriple, got ${pre.ok ? "success" : pre.revert?.formatted ?? pre.raw}`);
    }
    console.log(`3. PASS  the delegated vote is refused on legal — ${pre.revert.formatted}`);
    console.log(`         no attested path connects legal to the design A delegated`);
  }

  // ── 4. B still votes for itself on `legal` — no delegation involved ─────────────
  {
    const voteCalldata = encodeFunctionData({
      abi: governorAbi,
      functionName: "castVote",
      args: [legalProposal, VOTE_FOR],
    });
    const op = await sendUserOp(publicClient, submitter, delegateSA, [
      { to: governor, value: 0n, data: voteCalldata },
    ]);
    if (!op.success) throw new Error(`case 4 user op failed: ${op.revert?.formatted ?? op.revertData}`);

    const [, forVotes] = await publicClient.readContract({
      ...gov,
      functionName: "proposalVotes",
      args: [legalProposal],
    });
    const aCounted = await publicClient.readContract({
      ...gov,
      functionName: "hasVoted",
      args: [legalProposal, voterSA.address],
    });
    if (aCounted) throw new Error("case 4: A's weight must not be counted on legal");
    if (forVotes !== VOTING_POWER) throw new Error(`case 4: expected weight ${VOTING_POWER}, got ${forVotes}`);
    console.log(`4. PASS  B voted on legal for itself — weight ${forVotes}, A untouched (tx ${op.txHash})`);
    console.log(`         the delegation is scoped, not a mute button`);
  }

  // ── 5. Narrowing applies to votes: the UX leaf blocks `branding` ───────────────
  {
    const calldata = buildVoteCalldata({
      chain: [leaf, root],
      witnesses: [[branding, ux], [branding, design]],
      governor,
      proposalId: brandingProposal,
      support: VOTE_FOR,
      voter: executorSA.address,
      principals: [voterSA.address, delegateSA.address],
    });
    const pre = await preflightRedeem(publicClient, executorSA.address, calldata);
    if (pre.ok || pre.revert?.name !== "NotATriple") {
      throw new Error(`case 5 expected NotATriple, got ${pre.ok ? "success" : pre.revert?.formatted ?? pre.raw}`);
    }
    console.log(`5. PASS  narrowing blocks the branding vote through the UX-scoped level — ${pre.revert.formatted}`);
  }

  console.log("\nDelegated voting verified live on 13579.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
