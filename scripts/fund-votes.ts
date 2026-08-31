/**
 * Gives each account its voting token, and makes it count.
 *
 * A balance is not voting power on `ERC20Votes`. Weight comes from a checkpoint, and no
 * checkpoint exists until the holder calls `delegate`, even to itself. An account holding
 * a token it never self-delegated votes with zero, which is a miserable thing to diagnose
 * from the outside, so both steps happen here together.
 *
 * The three amounts differ on purpose. Equal balances make every sum ambiguous: 1 and 1
 * arriving at 2 could be either account's, whereas 12 landing on 30 is unmistakably A's.
 * They stay small enough to read at a glance and to add up in your head on stage.
 *
 * Run: bun run fund
 */
import { createPublicClient, createWalletClient, encodeFunctionData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { intuitionTestnet } from "./lib/network";
import { configFromManifest } from "./lib/config";
import { votesTokenAbi } from "../src/lib/chain/abis";
import { toHybridAccount } from "../src/lib/chain/smart-accounts";
import { sendUserOp } from "../src/lib/chain/user-op";
import { ROLES } from "../src/lib/roles";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Distinct amounts so any total says plainly who contributed to it. */
const HOLDINGS: Record<string, bigint> = { A: 12n, B: 30n, C: 7n };

async function main(): Promise<void> {
  const submitterKey = process.env["PRIVATE_KEY"] as `0x${string}` | undefined;
  if (!submitterKey) throw new Error("PRIVATE_KEY missing (contracts/.env)");
  const config = configFromManifest(submitterKey);

  const stored = JSON.parse(readFileSync(join(repoRoot, "data", "accounts.json"), "utf-8")) as {
    keys: Record<string, `0x${string}`>;
  };
  for (const role of ROLES) config.ownerKeys[role] = stored.keys[role];

  const client = createPublicClient({ chain: intuitionTestnet, transport: http(config.rpcUrl) });
  const submitter = createWalletClient({
    account: privateKeyToAccount(submitterKey),
    chain: intuitionTestnet,
    transport: http(config.rpcUrl),
  });

  console.log(`token ${config.votesToken}\n`);

  // Minting is open on this testnet token, so the submitter can hand them out directly.
  for (const role of ROLES) {
    const to = config.accounts[role].smartAccount;
    const want = HOLDINGS[role] ?? 0n;
    const held = await client.readContract({
      address: config.votesToken,
      abi: votesTokenAbi,
      functionName: "balanceOf",
      args: [to],
    });
    if (held >= want) {
      console.log(`${role} already holds ${held}`);
      continue;
    }
    const hash = await submitter.writeContract({
      address: config.votesToken,
      abi: votesTokenAbi,
      functionName: "mint",
      args: [to, want - held],
    });
    await client.waitForTransactionReceipt({ hash });
    console.log(`${role} holds ${want}`);
  }

  // Self-delegation has to come from the account itself, so it goes through a user op.
  for (const role of ROLES) {
    const address = config.accounts[role].smartAccount;
    const votes = await client.readContract({
      address: config.votesToken,
      abi: votesTokenAbi,
      functionName: "getVotes",
      args: [address],
    });
    if (votes > 0n) {
      console.log(`${role} already counts ${votes}`);
      continue;
    }
    const account = await toHybridAccount(client, privateKeyToAccount(stored.keys[role]!));
    const result = await sendUserOp(client, submitter, account, [
      {
        to: config.votesToken,
        value: 0n,
        data: encodeFunctionData({
          abi: votesTokenAbi,
          functionName: "delegate",
          args: [address],
        }),
      },
    ]);
    console.log(`${role} self-delegated${result.success ? "" : " — failed"}`);
  }

  console.log("\nA holds 12, B holds 30, C holds 7, and each counts its own.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
