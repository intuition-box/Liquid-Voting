/**
 * Builds the frontend's AppConfig from the manifest and the signed delegations.
 *
 * The scripts drive the very same service layer the panels do, so they need the same
 * config object. It used to be spelled out in each of them — which meant a field added to
 * AppConfig had to be added twice, with nothing to say so if it was not.
 *
 * Node-side only: this reads the files from disk, where the app receives them through
 * Vite's glob imports.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";

import type { AppConfig } from "../../src/lib/config/app-config";
import { EDGE_KEY_SEPARATOR } from "../../src/lib/graph/domain-graph";
import { ROLES } from "../../src/lib/roles";
import { readManifest } from "./network";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const delegationsPath = join(repoRoot, "data", "delegations.json");

interface SignedDelegations {
  rootDelegation: AppConfig["delegations"]["root"];
  leafDelegation: AppConfig["delegations"]["leaf"];
  ownDelegation?: AppConfig["delegations"]["root"];
  signedAt: string;
  maxDepth: number;
}

/** The signed delegations, as saved by `phase3:delegate`. */
export function readDelegations(): SignedDelegations {
  if (!existsSync(delegationsPath)) {
    throw new Error("data/delegations.json missing — run `bun run delegate`");
  }
  return JSON.parse(readFileSync(delegationsPath, "utf-8")) as SignedDelegations;
}

/**
 * The config the panels see, assembled for a script.
 *
 * `submitterKey` is what separates a read-only caller from one that writes: pass
 * PRIVATE_KEY to send transactions, omit it for a script that only simulates.
 */
export function configFromManifest(submitterKey?: string): AppConfig {
  const manifest = readManifest();
  const delegations = readDelegations();
  const { orgAttestor, curveId } = manifest.attestation;
  const accounts = manifest.accounts;
  if (!orgAttestor || !curveId || !accounts) {
    throw new Error("manifest incomplete — run `bun run seed` and `bun run setup`");
  }

  const roleAccounts = {} as AppConfig["accounts"];
  for (const role of ROLES) {
    const entry = accounts[role];
    if (!entry) throw new Error(`manifest has no ${role} account — run \`bun run setup\``);
    roleAccounts[role] = entry;
  }

  return {
    multiVault: manifest.multiVault,
    enforcer: manifest.contracts.GraphDomainCaveatEnforcer.address,
    governor: manifest.contracts.MockGovernor.address,
    predicate: manifest.vocabulary.predicate,
    nodes: Object.entries(manifest.vocabulary.atoms).map(([label, termId]) => ({ label, termId: termId as Hex })),
    edges: Object.entries(manifest.vocabulary.triples).map(([key, tripleId]) => {
      const [child = "", parent = ""] = key.split(EDGE_KEY_SEPARATOR);
      return { child, parent, tripleId: tripleId as Hex };
    }),
    attestor: orgAttestor,
    curveId: BigInt(curveId),
    accounts: roleAccounts,
    // Scripts sign with the keys they load themselves; the app's owner keys are a
    // dev-only define and have no meaning here (ADR 0011).
    ownerKeys: {},
    delegations: {
      root: delegations.rootDelegation,
      leaf: delegations.leafDelegation,
      ...(delegations.ownDelegation ? { own: delegations.ownDelegation } : {}),
      signedAt: delegations.signedAt,
      maxDepth: delegations.maxDepth,
    },
    submitterKey: (submitterKey ?? "0x") as `0x${string}`,
    rpcUrl: process.env["INTUITION_TESTNET_RPC"],
  };
}
