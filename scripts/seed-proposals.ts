/**
 * Records one proposal per demo domain and assigns voting power to the three accounts.
 *
 * Proposing needs no delegation — anyone proposes in their own name — so this is a plain
 * transaction from the submitter EOA, deliberately outside the caveat. It exists so the
 * demo has something to vote on.
 *
 * Idempotent: a domain that already carries an active, unvoted proposal is skipped.
 * Re-run it after redeploying the governor, or whenever `bun run verify` reports that a
 * domain has no fresh proposal.
 *
 * Run: bun run seed:proposals
 */
import { createPublicClient, createWalletClient, encodeFunctionData, http, type Hex } from "viem";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";

import { intuitionTestnet, readManifest } from "./lib/network";
import { governorAbi } from "../src/lib/chain/abis";
import { toHybridAccount } from "../src/lib/chain/smart-accounts";
import { ROLES } from "../src/lib/roles";
import { sendUserOp } from "../src/lib/chain/user-op";

/**
 * One proposal per domain the demo votes on, in the order the panels present them.
 * Titles follow the convention real governance uses (Compound, Uniswap, Aave on Tally):
 * an imperative sentence naming the change and its scope, specific enough to be voted on
 * without opening the body.
 */
const DOMAINS: Array<{ domain: string; description: string }> = [
  { domain: "grants", description: "Fund the Q3 Builder Grants Round at 250k USDC" },
  { domain: "builder-grants", description: "Extend the Builder Track to Protocol Tooling" },
  { domain: "micro-grants", description: "Raise the Micro-Grant Ceiling from 2k to 5k" },
  { domain: "retro-funding", description: "Open Retro Round 4 to Infrastructure Contributors" },
  { domain: "payroll", description: "Approve the Core Contributor Payroll for Q3" },
  { domain: "contributor-comp", description: "Move Contributor Comp to a Quarterly Review Cycle" },
  { domain: "parameters", description: "Lower the Protocol Fee from 10 to 7 Basis Points" },
  { domain: "fee-switch", description: "Route the Fee Switch to the Treasury for Two Quarters" },
  { domain: "upgrades", description: "Schedule the v2 Router Upgrade Behind the Timelock" },
  { domain: "events", description: "Sponsor the Devconnect Community Booth" },
];

const VOTING_POWER = 1n;

async function main(): Promise<void> {
  const manifest = readManifest();
  const accounts = manifest.accounts;
  if (!accounts) throw new Error("manifest has no accounts — run `bun run setup` first");
  const key = process.env["PRIVATE_KEY"];
  if (!key) throw new Error("PRIVATE_KEY missing (contracts/.env)");

  const transport = http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]);
  const client = createPublicClient({ chain: intuitionTestnet, transport });
  const wallet = createWalletClient({ chain: intuitionTestnet, transport, account: privateKeyToAccount(key as `0x${string}`) });
  const gov = { address: manifest.contracts.MockGovernor.address, abi: governorAbi } as const;
  const atoms = manifest.vocabulary.atoms as Record<string, Hex>;

  const accountsPath = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "accounts.json");
  if (!existsSync(accountsPath)) throw new Error("data/accounts.json missing — run `bun run setup`");
  const ownerKeys = (JSON.parse(readFileSync(accountsPath, "utf-8")) as { keys: Record<string, string> }).keys;

  console.log(`governor ${gov.address}`);

  // Voting power: equal weight, so a delegated vote reads as "one plus one".
  for (const role of ROLES) {
    const account = accounts[role]?.smartAccount;
    if (!account) throw new Error(`manifest has no ${role} account`);
    const current = await client.readContract({ ...gov, functionName: "votingPower", args: [account] });
    if (current === VOTING_POWER) {
      console.log(`  ${role} already holds ${VOTING_POWER} voting power — skip`);
      continue;
    }
    const hash = await wallet.writeContract({ ...gov, functionName: "setVotingPower", args: [account, VOTING_POWER] });
    await client.waitForTransactionReceipt({ hash });
    console.log(`  ${role} voting power set to ${VOTING_POWER}`);
  }

  // Weight transfers matching the two signed delegations: A hands `design` to B, B hands
  // `UX` to C. The signature says the delegate MAY vote; this register says whose weight
  // it carries, and the delegator stops counting on that domain.
  const TRANSFERS: Array<{
    from: "voter" | "delegate";
    to: "delegate" | "executor";
    domain: string;
    /** The domain and its parents — the governor refuses one already covered by a parent. */
    path: string[];
  }> = [
    { from: "voter", to: "delegate", domain: "treasury", path: ["treasury", "governance"] },
    { from: "delegate", to: "executor", domain: "grants", path: ["grants", "treasury", "governance"] },
  ];
  for (const transfer of TRANSFERS) {
    const from = accounts[transfer.from]?.smartAccount;
    const to = accounts[transfer.to]?.smartAccount;
    const domainId = atoms[transfer.domain];
    if (!from || !to || !domainId) throw new Error(`manifest incomplete for ${transfer.from} -> ${transfer.to}`);
    const current = await client.readContract({ ...gov, functionName: "delegatedTo", args: [from, domainId] });
    if (current.toLowerCase() === to.toLowerCase()) {
      console.log(`  ${transfer.from} already delegates “${transfer.domain}” to ${transfer.to} — skip`);
      continue;
    }
    const account = await toHybridAccount(client, privateKeyToAccount(ownerKeys[transfer.from] as `0x${string}`));
    const op = await sendUserOp(client, wallet, account, [
      {
        to: gov.address,
        value: 0n,
        data: encodeFunctionData({
          abi: governorAbi,
          functionName: "delegateWeight",
          args: [to, domainId, transfer.path.map((name) => atoms[name] as Hex)],
        }),
      },
    ]);
    if (!op.success) throw new Error(`weight transfer failed: ${op.revert?.formatted ?? op.revertData}`);
    console.log(`  ${transfer.from} delegates “${transfer.domain}” to ${transfer.to} (tx ${op.txHash})`);
  }

  // Existing proposals, keyed by domain + title, so a re-run adds nothing twice.
  const count = await client.readContract({ ...gov, functionName: "proposalCount" });
  const usable = new Map<string, bigint>();
  for (let id = 0n; id < count; id++) {
    const [proposal, state] = await Promise.all([
      client.readContract({ ...gov, functionName: "getProposal", args: [id] }),
      client.readContract({ ...gov, functionName: "state", args: [id] }),
    ]);
    const untouched = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes === 0n;
    // 0 Pending, 1 Active — both are still votable once the delay elapses.
    if ((state === 0 || state === 1) && untouched) {
      usable.set(`${proposal.domainId.toLowerCase()}|${proposal.description}`, id);
    }
  }

  for (const { domain, description } of DOMAINS) {
    const domainId = atoms[domain];
    if (!domainId) throw new Error(`manifest has no atom for “${domain}”`);
    const existing = usable.get(`${domainId.toLowerCase()}|${description}`);
    if (existing !== undefined) {
      console.log(`  “${domain}” already has #${existing} — skip`);
      continue;
    }
    const proposalId = await client.readContract({ ...gov, functionName: "proposalCount" });
    const hash = await wallet.writeContract({ ...gov, functionName: "propose", args: [domainId, description] });
    await client.waitForTransactionReceipt({ hash });
    console.log(`  “${domain}” -> proposal #${proposalId} (tx ${hash})`);
  }

  // Voting opens one block after a proposal; mine one so every proposal is Active.
  const filler = await wallet.sendTransaction({ to: wallet.account.address, value: 0n });
  await client.waitForTransactionReceipt({ hash: filler });

  console.log("\nProposals ready — run `bun run verify` to confirm every panel.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
