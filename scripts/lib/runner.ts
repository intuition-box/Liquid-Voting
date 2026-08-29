/**
 * What the acceptance runners need before they can do anything: the accounts, the signed
 * delegations, a client, a funded submitter, and the demo's atom ids.
 *
 * phase3-run and vote-run opened the same way, line for line. Prepared once here so a
 * change to how the runners reach the chain is made in one place.
 */
import { createPublicClient, createWalletClient, http, type Account, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Delegation } from "../../src/lib/delegation/encoding";
import { ROLES, type Role } from "../../src/lib/roles";
import type { HybridAccount } from "../../src/lib/chain/smart-accounts";
import { toHybridAccount } from "../../src/lib/chain/smart-accounts";
import { intuitionTestnet, readManifest, type Manifest } from "./network";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const accountsPath = join(repoRoot, "data", "accounts.json");
const delegationsPath = join(repoRoot, "data", "delegations.json");

export interface SignedDelegations {
  rootDelegation: Delegation & { hash: Hex };
  leafDelegation: Delegation & { hash: Hex };
  /** The delegate's own voice — absent from files signed before it was split out. */
  ownDelegation?: Delegation & { hash: Hex };
}

export interface RunnerContext {
  manifest: Manifest;
  publicClient: PublicClient;
  /** Funded EOA that submits the user operations (ADR 0010). */
  submitter: WalletClient<Transport, Chain, Account>;
  /** The three smart accounts, keyed by role. */
  accounts: Record<Role, HybridAccount>;
  signed: SignedDelegations;
  governor: `0x${string}`;
  /** Every domain atom id from the manifest, by label. */
  atoms: Record<string, Hex>;
}

export async function prepareRunner(): Promise<RunnerContext> {
  if (!existsSync(accountsPath) || !existsSync(delegationsPath)) {
    throw new Error("run setup and delegate first");
  }
  const stored = JSON.parse(readFileSync(accountsPath, "utf-8")) as { keys: Record<string, `0x${string}`> };
  const signed = JSON.parse(readFileSync(delegationsPath, "utf-8")) as SignedDelegations;
  const manifest = readManifest();

  const submitterKey = process.env["PRIVATE_KEY"];
  if (!submitterKey) throw new Error("PRIVATE_KEY missing (contracts/.env)");

  const transport = http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: intuitionTestnet, transport });
  const submitter = createWalletClient({
    chain: intuitionTestnet,
    transport,
    account: privateKeyToAccount(submitterKey as `0x${string}`),
  });

  const accounts = {} as Record<Role, HybridAccount>;
  for (const role of ROLES) {
    const key = stored.keys[role];
    if (!key) throw new Error(`data/accounts.json has no ${role} key — run \`bun run setup\``);
    accounts[role] = await toHybridAccount(publicClient, privateKeyToAccount(key));
  }

  return {
    manifest,
    publicClient,
    submitter,
    accounts,
    signed,
    governor: manifest.contracts.MockGovernor.address,
    atoms: manifest.vocabulary.atoms as Record<string, Hex>,
  };
}
