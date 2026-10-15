/**
 * Phase 3 step 2 — build and sign the three delegations, offline:
 *
 *   A --[GraphDomainScope root=treasury]--> B                 A's own voice
 *   B --[GraphDomainScope root=grants]----> C   (chained)     A's voice, relayed by B
 *   B --[GraphDomainScope root=grants]----> C   (standalone)  B's own voice
 *
 * Three, not two, and the distinction matters: the relay carries A's voice and dies with
 * A's grant, while B's own stands on ROOT_AUTHORITY and survives it (ADR 0012). The leaf
 * narrows from `treasury` to `grants`, which is where the emergent narrowing of ADR 0007
 * is demonstrated.
 *
 * The delegation structs are built directly (the whole grant IS our custom caveat, so
 * the Kit's scope system is bypassed) and signed with the smart accounts' canonical
 * signDelegation. Each signature is verified two ways before saving (house rule):
 * the offchain delegation hash is cross-checked against the deployed
 * DelegationManager's own getDelegationHash, and the EIP-1271 magic value is read
 * back from each delegator account. Signed payloads go to data/delegations.json
 * (gitignored — never in code).
 *
 * Run: bun run delegate
 */
import { concatHex, createPublicClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT_AUTHORITY, type Delegation } from "@metamask/smart-accounts-kit";
import { getDelegationHashOffchain } from "@metamask/smart-accounts-kit/utils";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { intuitionTestnet, readManifest } from "./lib/network";
import { delegationManagerAbi } from "../src/lib/chain/abis";
import { encodeTerms } from "../src/lib/delegation/encoding";
import { toHybridAccount, ensureEnvironment } from "../src/lib/chain/smart-accounts";

const EIP1271_MAGIC = "0x1626ba7e";
/** Five hops: the deepest branch is micro-grants → builder-grants → grants → treasury →
 *  governance, so the cap clears the whole tree with a hop to spare. */
const MAX_DEPTH = 5;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const accountsPath = join(repoRoot, "data", "accounts.json");
const delegationsPath = join(repoRoot, "data", "delegations.json");

const eip1271Abi = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }],
    outputs: [{ type: "bytes4" }],
  },
] as const;

async function main(): Promise<void> {
  if (!existsSync(accountsPath)) throw new Error("data/accounts.json missing — run setup first");
  const stored = JSON.parse(readFileSync(accountsPath, "utf-8")) as { keys: Record<string, `0x${string}`> };
  const manifest = readManifest();
  // The enforcer bound to the governor the app runs on, which is the OZ one. Each
  // enforcer is tied to one governor and one selector at construction, so signing against
  // the wrong one produces delegations that revert the moment they are redeemed.
  const enforcer = manifest.contracts.OZGraphDomainScope.address;
  const curator = manifest.curation.curator;
  if (!curator) throw new Error("manifest curation.curator missing — run seed first");
  const voterKey = stored.keys["A"];
  const delegateKey = stored.keys["B"];
  const executorKey = stored.keys["C"];
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

  // Time-based salt: `disableDelegation` blacklists the delegation HASH forever, so a
  // fresh salt on each signing run gives the demo a reset path after the revocation act.
  const salt = toHex(BigInt(Date.now()));

  // Level 1: voter -> delegate, rooted at `treasury`.
  const rootDelegation: Delegation = {
    delegate: delegateSA.address,
    delegator: voterSA.address,
    authority: ROOT_AUTHORITY,
    caveats: [
      {
        enforcer,
        terms: encodeTerms({
          rootDomainId: manifest.vocabulary.atoms["treasury"] as `0x${string}`,
          predicateId: manifest.vocabulary.predicate.termId,
          maxDepth: MAX_DEPTH,
          expiry: 0n,
          attestor: curator,
        }),
        args: "0x",
      },
    ],
    salt,
    signature: "0x",
  };
  rootDelegation.signature = await voterSA.signDelegation({ delegation: rootDelegation });
  const rootHash = await hashAndVerify(rootDelegation, voterSA.address);
  console.log(`root delegation signed  (voter -> delegate, root=treasury)  hash ${rootHash}`);

  // Level 2: delegate -> executor, narrowed to `grants`, authority-bound to level 1.
  const leafDelegation: Delegation = {
    delegate: executorSA.address,
    delegator: delegateSA.address,
    authority: rootHash,
    caveats: [
      {
        enforcer,
        terms: encodeTerms({
          rootDomainId: manifest.vocabulary.atoms["grants"] as `0x${string}`,
          predicateId: manifest.vocabulary.predicate.termId,
          maxDepth: MAX_DEPTH,
          expiry: 0n,
          attestor: curator,
        }),
        args: "0x",
      },
    ],
    salt,
    signature: "0x",
  };
  leafDelegation.signature = await delegateSA.signDelegation({ delegation: leafDelegation });
  const leafHash = await hashAndVerify(leafDelegation, delegateSA.address);
  console.log(`leaf delegation signed  (delegate -> executor, root=grants) hash ${leafHash}`);

  // Level 2 again, for the delegate's OWN voice: same pair, same scope, rooted at
  // ROOT_AUTHORITY instead of chained to level 1.
  //
  // The two carry different things. The chained one relays the voice the voter lent the
  // delegate, and dies with it if the voter revokes. This one is the delegate's own, which
  // the voter never had any claim on — so it keeps standing. Signing only the chained one
  // would tie a voice to authority it merely borrowed.
  const ownDelegation: Delegation = {
    delegate: executorSA.address,
    delegator: delegateSA.address,
    authority: ROOT_AUTHORITY,
    caveats: [
      {
        enforcer,
        terms: encodeTerms({
          rootDomainId: manifest.vocabulary.atoms["grants"] as `0x${string}`,
          predicateId: manifest.vocabulary.predicate.termId,
          maxDepth: MAX_DEPTH,
          expiry: 0n,
          attestor: curator,
        }),
        args: "0x",
      },
    ],
    // A distinct salt: the two differ by authority alone, and disableDelegation
    // blacklists a hash, so they must not collide.
    salt: toHex(BigInt(salt) + 1n),
    signature: "0x",
  };
  ownDelegation.signature = await delegateSA.signDelegation({ delegation: ownDelegation });
  const ownHash = await hashAndVerify(ownDelegation, delegateSA.address);
  console.log(`own  delegation signed  (delegate -> executor, its own voice) hash ${ownHash}`);

  writeFileSync(
    delegationsPath,
    `${JSON.stringify(
      {
        note: "EIP-712-signed delegations for the Phase 3 chain. Testnet-only. NEVER commit.",
        signedAt: new Date().toISOString(),
        maxDepth: MAX_DEPTH,
        attestor: curator,
        rootDelegation: { ...rootDelegation, hash: rootHash },
        leafDelegation: { ...leafDelegation, hash: leafHash },
        ownDelegation: { ...ownDelegation, hash: ownHash },
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
