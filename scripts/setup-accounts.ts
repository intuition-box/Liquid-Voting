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
import { multiVaultAbi } from "../src/lib/chain/abis";
import { ROLES, type Role } from "../src/lib/roles";

/** MultiVault approval types: 0 none, 1 deposit, 2 redemption, 3 both. */
const APPROVAL_DEPOSIT = 1;
/** Any non-zero value: the probe below is a simulation, so nothing is ever sent. */
const APPROVAL_PROBE = 1n;

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
  // The env check comes first, because `loadOrCreateKeys` writes. Failing after it left
  // three fresh keys on disk for accounts that were never deployed — and `bun run
  // delegate` then sailed past its own existence check and died inside an EIP-1271 call
  // against an address with no code, which is the one place this CLI handed somebody a
  // viem stack trace instead of a sentence.
  const funder = privateKeyToAccount(requireEnv("PRIVATE_KEY") as `0x${string}`);
  const stored = loadOrCreateKeys();
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

  // ── The three accounts are allowed to extend the graph in the curator's name ──────
  //
  // The enforcer reads one named attestor, so the graph has a single voice that counts.
  // That voice is a role: a key today, the DAO in production, and the enforcer cannot
  // tell which (ADR 0027). Keeping it single is what makes a delegation signed months ago
  // cover a domain minted this minute — stake an edge for anyone else and it authorizes
  // nothing.
  //
  // Which left only the curator able to add a domain at all, because `deposit` names a
  // receiver and the MultiVault refuses one that is not the sender. So the curator
  // approves the three accounts to deposit in its name: they pay and they create, the
  // attestation stays the role's.
  const stakers = manifest.curation.stakers ?? {};
  if (!manifest.curation.curator) throw new Error("manifest curation.curator missing — run `bun run seed` first");
  const curator = manifest.curation.curator;
  const anyEdge = Object.values(manifest.vocabulary.triples)[0];
  for (const role of ROLES) {
    const staker = accounts[role]?.smartAccount;
    if (!staker || !anyEdge) continue;
    // Idempotent without an `approvals` view to read: simulate a deposit in the curator's
    // name and only approve when the answer is that this account may not. Any other
    // revert — a minimum, a balance — means the approval is already there.
    const refused = await publicClient
      .simulateContract({
        address: manifest.multiVault,
        abi: multiVaultAbi,
        functionName: "deposit",
        args: [curator, anyEdge, BigInt(manifest.curation.curveId ?? "1"), 0n],
        value: APPROVAL_PROBE,
        account: staker,
      })
      .then(() => null)
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    // Only that one error means "not approved". A simulation that passed, or that failed
    // for any other reason, says the approval is already in place.
    if (refused === null || !refused.includes("SenderNotApproved")) {
      console.log(`${role}: already approved to stake for the curator — skip`);
      stakers[role] = stakers[role] ?? { address: staker, txHash: null };
      continue;
    }
    const hash = await funderClient.writeContract({
      address: manifest.multiVault,
      abi: multiVaultAbi,
      functionName: "approve",
      args: [staker, APPROVAL_DEPOSIT],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`${role}: approved to stake for the curator in ${hash}`);
    stakers[role] = { address: staker, txHash: hash };
  }
  manifest.curation.stakers = stakers;

  writeManifest(manifest);
  const funderBalance = await publicClient.getBalance({ address: funder.address });
  console.log(`manifest updated | funder balance ${formatEther(funderBalance)} tTRUST`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
