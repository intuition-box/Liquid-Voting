/**
 * Phase 3 step 2 — build and sign the two delegations, offline:
 *
 *   voter SA    --[GraphDomainCaveatEnforcer root=design]-->  delegate SA
 *   delegate SA --[GraphDomainCaveatEnforcer root=UX]------>  executor SA   (narrowing, ADR 0007)
 *
 * The delegation structs are built directly (the whole grant IS our custom caveat, so
 * the Kit's scope system is bypassed) and signed with the smart accounts' canonical
 * signDelegation. Each signature is verified two ways before saving (house rule):
 * the offchain delegation hash is cross-checked against the deployed
 * DelegationManager's own getDelegationHash, and the EIP-1271 magic value is read
 * back from each delegator account. Signed payloads go to data/delegations.json
 * (gitignored — never in code).
 *
 * Run: bun run phase3:delegate
 */
import { concatHex, createPublicClient, encodeAbiParameters, http, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT_AUTHORITY, type Delegation } from "@metamask/smart-accounts-kit";
import { getDelegationHashOffchain } from "@metamask/smart-accounts-kit/utils";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { intuitionTestnet, readManifest } from "./lib/network";
import { toHybridAccount, ensureEnvironment } from "./lib/kit";

const EIP1271_MAGIC = "0x1626ba7e";
const MAX_DEPTH = 3;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const accountsPath = join(repoRoot, "data", "accounts.json");
const delegationsPath = join(repoRoot, "data", "delegations.json");

const delegationManagerAbi = [
  {
    type: "function",
    name: "getDelegationHash",
    stateMutability: "pure",
    inputs: [
      {
        name: "_input",
        type: "tuple",
        components: [
          { name: "delegate", type: "address" },
          { name: "delegator", type: "address" },
          { name: "authority", type: "bytes32" },
          {
            name: "caveats",
            type: "tuple[]",
            components: [
              { name: "enforcer", type: "address" },
              { name: "terms", type: "bytes" },
              { name: "args", type: "bytes" },
            ],
          },
          { name: "salt", type: "uint256" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  { type: "function", name: "getDomainHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

const eip1271Abi = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }],
    outputs: [{ type: "bytes4" }],
  },
] as const;

function encodeTerms(rootDomainId: `0x${string}`, predicateId: `0x${string}`, attestor: `0x${string}`): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: "bytes32", name: "rootDomainId" },
      { type: "bytes32", name: "predicateId" },
      { type: "uint8", name: "maxDepth" },
      { type: "uint64", name: "expiry" },
      { type: "address", name: "attestor" },
    ],
    [rootDomainId, predicateId, MAX_DEPTH, 0n, attestor],
  );
}

async function main(): Promise<void> {
  if (!existsSync(accountsPath)) throw new Error("data/accounts.json missing — run phase3:setup first");
  const stored = JSON.parse(readFileSync(accountsPath, "utf-8")) as { keys: Record<string, `0x${string}`> };
  const manifest = readManifest();
  const enforcer = manifest.contracts.GraphDomainCaveatEnforcer.address;
  const orgAttestor = manifest.attestation.orgAttestor;
  if (!orgAttestor) throw new Error("manifest attestation.orgAttestor missing — run seed first");
  const voterKey = stored.keys["voter"];
  const delegateKey = stored.keys["delegate"];
  const executorKey = stored.keys["executor"];
  if (!voterKey || !delegateKey || !executorKey) throw new Error("accounts.json is missing a role key");

  const transport = http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: intuitionTestnet, transport });
  const environment = ensureEnvironment();
  const manager = { address: environment.DelegationManager, abi: delegationManagerAbi } as const;

  const voterSA = await toHybridAccount(publicClient, privateKeyToAccount(voterKey));
  const delegateSA = await toHybridAccount(publicClient, privateKeyToAccount(delegateKey));
  const executorSA = await toHybridAccount(publicClient, privateKeyToAccount(executorKey));

  const domainHash = await publicClient.readContract({ ...manager, functionName: "getDomainHash" });

  async function hashAndVerify(delegation: Delegation, delegatorSA: `0x${string}`): Promise<`0x${string}`> {
    const offchainHash = getDelegationHashOffchain(delegation);
    const onchainHash = await publicClient.readContract({
      ...manager,
      functionName: "getDelegationHash",
      args: [{ ...delegation, salt: BigInt(delegation.salt) }],
    });
    if (offchainHash !== onchainHash) {
      throw new Error(`delegation hash drift: offchain ${offchainHash} vs manager ${onchainHash}`);
    }
    const typedDataHash = keccak256(concatHex(["0x1901", domainHash, offchainHash]));
    const magic = await publicClient.readContract({
      address: delegatorSA,
      abi: eip1271Abi,
      functionName: "isValidSignature",
      args: [typedDataHash, delegation.signature],
    });
    if (magic !== EIP1271_MAGIC) throw new Error(`EIP-1271 rejected the signature for delegator ${delegatorSA}`);
    return offchainHash;
  }

  // Level 1: voter -> delegate, rooted at `design`.
  const rootDelegation: Delegation = {
    delegate: delegateSA.address,
    delegator: voterSA.address,
    authority: ROOT_AUTHORITY,
    caveats: [
      {
        enforcer,
        terms: encodeTerms(manifest.vocabulary.atoms["design"] as `0x${string}`, manifest.vocabulary.predicate.termId, orgAttestor),
        args: "0x",
      },
    ],
    salt: "0x0",
    signature: "0x",
  };
  rootDelegation.signature = await voterSA.signDelegation({ delegation: rootDelegation });
  const rootHash = await hashAndVerify(rootDelegation, voterSA.address);
  console.log(`root delegation signed  (voter -> delegate, root=design)  hash ${rootHash}`);

  // Level 2: delegate -> executor, narrowed to `UX`, authority-bound to level 1.
  const leafDelegation: Delegation = {
    delegate: executorSA.address,
    delegator: delegateSA.address,
    authority: rootHash,
    caveats: [
      {
        enforcer,
        terms: encodeTerms(manifest.vocabulary.atoms["UX"] as `0x${string}`, manifest.vocabulary.predicate.termId, orgAttestor),
        args: "0x",
      },
    ],
    salt: "0x0",
    signature: "0x",
  };
  leafDelegation.signature = await delegateSA.signDelegation({ delegation: leafDelegation });
  const leafHash = await hashAndVerify(leafDelegation, delegateSA.address);
  console.log(`leaf delegation signed  (delegate -> executor, root=UX)   hash ${leafHash}`);

  writeFileSync(
    delegationsPath,
    `${JSON.stringify(
      {
        note: "EIP-712-signed delegations for the Phase 3 chain. Testnet-only. NEVER commit.",
        signedAt: new Date().toISOString(),
        maxDepth: MAX_DEPTH,
        attestor: orgAttestor,
        rootDelegation: { ...rootDelegation, hash: rootHash },
        leafDelegation: { ...leafDelegation, hash: leafHash },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`saved -> ${delegationsPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
