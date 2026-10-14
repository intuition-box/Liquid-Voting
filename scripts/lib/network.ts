import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export { intuitionTestnet } from "../../src/lib/chain/network";


const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const manifestPath = join(repoRoot, "manifest", "13579.json");

export interface DeployedContract {
  address: `0x${string}`;
  deployTx: `0x${string}`;
  deployedAt: string;
  verified: boolean;
  /** The block its history starts in, so a log read need not begin at `earliest`. */
  deployedBlock?: number;
}

export interface Manifest {
  network: string;
  chainId: number;
  rpc: string;
  graphql: string;
  explorer: string;
  contracts: {
    GraphDomainScope: DeployedContract & {
      constructorArgs: { multiVault: `0x${string}`; governor: `0x${string}`; allowedSelector: `0x${string}` };
    };
    DemoGovernor: DeployedContract;
    OZGovernor: DeployedContract;
    OZGraphDomainScope: DeployedContract;
    ProposalDomains: DeployedContract;
    DemoVotes: DeployedContract;
  };
  framework: Record<string, string>;
  multiVault: `0x${string}`;
  vocabulary: {
    predicate: { label: string; termId: `0x${string}` };
    atoms: Record<string, `0x${string}`>;
    triples: Record<string, `0x${string}`>;
  };
  curation: {
    note: string;
    curator: `0x${string}` | null;
    curveId: string | null;
    stakes: Record<string, { shares: string; txHash: `0x${string}` | null }>;
  };
  /** Phase 3: the three HybridDeleGator accounts (owner EOA + smart account address). */
  accounts?: Record<string, { owner: `0x${string}`; smartAccount: `0x${string}` }>;
}

export function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
}

export function writeManifest(manifest: Manifest): void {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
