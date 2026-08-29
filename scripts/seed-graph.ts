/**
 * Phase 2 seeder — idempotent, per bootstrap §5 Phase 2 and ADR 0008.
 *
 * For every vocabulary atom/triple: compute the id, verify it matches the manifest
 * (fail loudly on drift), check `isTermCreated`, create only if absent. Then the org
 * attestor deposits on every hierarchy triple (ADR 0004 — zero-position triples
 * authorize nothing), and every write is re-read from chain before the manifest is
 * updated. On this testnet everything already exists (prior-run seed), so the run
 * reduces to deposits + manifest; on a clean chain (Mission 11 mainnet) the same
 * script seeds from scratch.
 *
 * Run: bun run seed   (reads PRIVATE_KEY from contracts/.env)
 */
import { createPublicClient, createWalletClient, formatEther, http, parseEther, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { intuitionTestnet, readManifest, writeManifest } from "./lib/network";
import { multiVaultAbi } from "../src/lib/chain/abis";

const STAKE_PER_TRIPLE = parseEther("0.01");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see contracts/.env.example)`);
  return value;
}

async function main(): Promise<void> {
  const manifest = readManifest();
  const account = privateKeyToAccount(requireEnv("PRIVATE_KEY") as `0x${string}`);
  const transport = http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: intuitionTestnet, transport });
  const walletClient = createWalletClient({ chain: intuitionTestnet, transport, account });
  const vault = { address: manifest.multiVault, abi: multiVaultAbi } as const;

  // Session setup (governance-configurable — query, never hardcode).
  const atomCost = await publicClient.readContract({ ...vault, functionName: "getAtomCost" });
  const tripleCost = await publicClient.readContract({ ...vault, functionName: "getTripleCost" });
  const [, curveId] = await publicClient.readContract({ ...vault, functionName: "getBondingCurveConfig" });
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`attestor ${account.address} | balance ${formatEther(balance)} tTRUST`);
  console.log(`atomCost ${atomCost} | tripleCost ${tripleCost} | curveId ${curveId}`);

  // 1. Atoms (and the predicate): verify manifest ids, create only if absent.
  const atomEntries: Array<[string, `0x${string}`]> = [
    [manifest.vocabulary.predicate.label, manifest.vocabulary.predicate.termId],
    ...Object.entries(manifest.vocabulary.atoms) as Array<[string, `0x${string}`]>,
  ];
  for (const [label, expectedId] of atomEntries) {
    const data = stringToHex(label);
    const computedId = await publicClient.readContract({ ...vault, functionName: "calculateAtomId", args: [data] });
    // `0x` marks an entry added to the manifest without its id yet; anything else must match.
    if (expectedId === "0x" && label in manifest.vocabulary.atoms) {
      manifest.vocabulary.atoms[label] = computedId;
    } else if (computedId !== expectedId) {
      throw new Error(`manifest drift: atom "${label}" computes ${computedId}, manifest says ${expectedId}`);
    }
    const exists = await publicClient.readContract({ ...vault, functionName: "isTermCreated", args: [computedId] });
    if (exists) {
      console.log(`atom "${label}" present (${computedId.slice(0, 10)}…) — skip`);
      continue;
    }
    console.log(`atom "${label}" absent — creating`);
    const hash = await walletClient.writeContract({
      ...vault,
      functionName: "createAtoms",
      args: [[data], [atomCost]],
      value: atomCost,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const created = await publicClient.readContract({ ...vault, functionName: "isTermCreated", args: [computedId] });
    if (!created) throw new Error(`post-write verification failed for atom "${label}" (tx ${hash})`);
    console.log(`  created in ${hash}`);
  }

  // 2. Triples: verify manifest ids and positive-triple type, create only if absent.
  const predicateId = manifest.vocabulary.predicate.termId;
  const tripleEntries = Object.entries(manifest.vocabulary.triples) as Array<[string, `0x${string}`]>;
  for (const [key, expectedId] of tripleEntries) {
    const [subjectLabel, objectLabel] = key.split("->") as [string, string];
    const subjectId = manifest.vocabulary.atoms[subjectLabel];
    const objectId = manifest.vocabulary.atoms[objectLabel];
    if (!subjectId || !objectId) throw new Error(`manifest triple "${key}" references unknown atoms`);
    const computedId = await publicClient.readContract({
      ...vault,
      functionName: "calculateTripleId",
      args: [subjectId, predicateId, objectId],
    });
    if (expectedId === "0x") {
      manifest.vocabulary.triples[key] = computedId;
    } else if (computedId !== expectedId) {
      throw new Error(`manifest drift: triple "${key}" computes ${computedId}, manifest says ${expectedId}`);
    }
    const exists = await publicClient.readContract({ ...vault, functionName: "isTermCreated", args: [computedId] });
    if (exists) {
      const vaultType = await publicClient.readContract({ ...vault, functionName: "getVaultType", args: [computedId] });
      if (vaultType !== 1) throw new Error(`triple "${key}" exists but getVaultType=${vaultType} (expected 1)`);
      console.log(`triple "${key}" present (type 1) — skip`);
      continue;
    }
    console.log(`triple "${key}" absent — creating`);
    const hash = await walletClient.writeContract({
      ...vault,
      functionName: "createTriples",
      args: [[subjectId], [predicateId], [objectId], [tripleCost]],
      value: tripleCost,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const vaultType = await publicClient.readContract({ ...vault, functionName: "getVaultType", args: [computedId] });
    if (vaultType !== 1) throw new Error(`post-write verification failed for triple "${key}" (tx ${hash})`);
    console.log(`  created in ${hash}`);
  }

  // 3. Attestation deposits (ADR 0004): the org attestor stakes on every edge.
  // Re-read from the manifest: ids resolved in step 2 are not in the earlier snapshot.
  const stakeEntries = Object.entries(manifest.vocabulary.triples) as Array<[string, `0x${string}`]>;
  const stakes: Record<string, { shares: string; txHash: `0x${string}` | null }> = {};
  for (const [key, tripleId] of stakeEntries) {
    const held = await publicClient.readContract({
      ...vault,
      functionName: "getShares",
      args: [account.address, tripleId, curveId],
    });
    if (held > 0n) {
      console.log(`stake on "${key}" already held (${held} shares) — skip`);
      // Preserve the recorded deposit tx from a previous run — skips must not erase history.
      stakes[key] = { shares: held.toString(), txHash: manifest.curation.stakes[key]?.txHash ?? null };
      continue;
    }
    console.log(`depositing ${formatEther(STAKE_PER_TRIPLE)} tTRUST on "${key}"`);
    const hash = await walletClient.writeContract({
      ...vault,
      functionName: "deposit",
      args: [account.address, tripleId, curveId, 0n],
      value: STAKE_PER_TRIPLE,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const shares = await publicClient.readContract({
      ...vault,
      functionName: "getShares",
      args: [account.address, tripleId, curveId],
    });
    if (shares === 0n) throw new Error(`post-write verification failed: no shares on "${key}" (tx ${hash})`);
    console.log(`  ${shares} shares (tx ${hash})`);
    stakes[key] = { shares: shares.toString(), txHash: hash };
  }

  // 4. Manifest update — the single source of truth for tests and frontend.
  manifest.curation = {
    note: "Org-attestor stakes per ADR 0004; delegator-curation stakes are added per-account in Phase 3.",
    curator: account.address,
    curveId: curveId.toString(),
    stakes,
  };
  writeManifest(manifest);
  console.log("manifest/13579.json updated — seeding complete");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
