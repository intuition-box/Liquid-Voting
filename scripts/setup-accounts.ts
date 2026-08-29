/**
 * Phase 3 step 1 — the three HybridDeleGator accounts (voter, delegate, executor).
 *
 * Idempotent: EOA owner keys live in data/accounts.json (gitignored — generated on
 * first run, reused after); each smart account is deployed via its canonical factory
 * args only if it has no code yet, then funded to a small gas target (self-paid user
 * ops, ADR 0010). Every step is re-read from chain before the manifest is updated.
 *
 * Run: bun run setup
 */
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { intuitionTestnet, readManifest, writeManifest } from "./lib/network";
import { toHybridAccount } from "../src/lib/chain/smart-accounts";
import { ROLES, type Role } from "../src/lib/roles";

const SA_GAS_TARGET = parseEther("0.02");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const accountsPath = join(repoRoot, "data", "accounts.json");



interface StoredAccounts {
  note: string;
  keys: Record<Role, `0x${string}`>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see contracts/.env.example)`);
  return value;
}

function loadOrCreateKeys(): StoredAccounts {
  if (existsSync(accountsPath)) {
    return JSON.parse(readFileSync(accountsPath, "utf-8")) as StoredAccounts;
  }
  const stored: StoredAccounts = {
    note: "Demo EOA owner keys for the three HybridDeleGator accounts. Testnet-only. NEVER commit.",
    keys: {
      A: generatePrivateKey(),
      B: generatePrivateKey(),
      C: generatePrivateKey(),
    },
  };
  mkdirSync(dirname(accountsPath), { recursive: true });
  writeFileSync(accountsPath, `${JSON.stringify(stored, null, 2)}\n`);
  console.log(`generated new owner keys -> ${accountsPath}`);
  return stored;
}

async function main(): Promise<void> {
  const stored = loadOrCreateKeys();
  const funder = privateKeyToAccount(requireEnv("PRIVATE_KEY") as `0x${string}`);
  const transport = http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: intuitionTestnet, transport });
  const funderClient = createWalletClient({ chain: intuitionTestnet, transport, account: funder });

  const manifest = readManifest();
  const accounts: NonNullable<typeof manifest.accounts> = manifest.accounts ?? {};

  for (const role of ROLES) {
    const owner = privateKeyToAccount(stored.keys[role]);
    const smartAccount = await toHybridAccount(publicClient, owner);
    console.log(`${role}: owner ${owner.address} | smart account ${smartAccount.address}`);

    const code = await publicClient.getCode({ address: smartAccount.address });
    if (code && code !== "0x") {
      console.log(`  already deployed (${(code.length - 2) / 2} bytes) — skip`);
    } else {
      const { factory, factoryData } = await smartAccount.getFactoryArgs();
      if (!factory || !factoryData) throw new Error(`${role}: no factory args for undeployed account`);
      const hash = await funderClient.sendTransaction({ to: factory, data: factoryData });
      await publicClient.waitForTransactionReceipt({ hash });
      const deployed = await publicClient.getCode({ address: smartAccount.address });
      if (!deployed || deployed === "0x") throw new Error(`${role}: no code after deploy tx ${hash}`);
      console.log(`  deployed via factory in ${hash}`);
    }

    const balance = await publicClient.getBalance({ address: smartAccount.address });
    if (balance < SA_GAS_TARGET) {
      const topUp = SA_GAS_TARGET - balance;
      const hash = await funderClient.sendTransaction({ to: smartAccount.address, value: topUp });
      await publicClient.waitForTransactionReceipt({ hash });
      const after = await publicClient.getBalance({ address: smartAccount.address });
      if (after < SA_GAS_TARGET) throw new Error(`${role}: balance ${after} below target after top-up ${hash}`);
      console.log(`  funded +${formatEther(topUp)} tTRUST (balance ${formatEther(after)})`);
    } else {
      console.log(`  balance ${formatEther(balance)} tTRUST — no top-up`);
    }

    accounts[role] = { owner: owner.address, smartAccount: smartAccount.address };
  }

  manifest.accounts = accounts;
  writeManifest(manifest);
  const funderBalance = await publicClient.getBalance({ address: funder.address });
  console.log(`manifest updated | funder balance ${formatEther(funderBalance)} tTRUST`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
