import { defineChain } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Intuition testnet (13579) — values pinned in CLAUDE.md / the manifest. */
export const intuitionTestnet = defineChain({
  id: 13579,
  name: "Intuition Testnet",
  nativeCurrency: { decimals: 18, name: "Test Trust", symbol: "tTRUST" },
  rpcUrls: { default: { http: ["https://testnet.rpc.intuition.systems/http"] } },
  blockExplorers: {
    default: { name: "Intuition Testnet Explorer", url: "https://testnet.explorer.intuition.systems" },
  },
});

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const manifestPath = join(repoRoot, "manifest", "13579.json");

export interface DeployedContract {
  address: `0x${string}`;
  deployTx: `0x${string}`;
  deployedAt: string;
  verified: boolean;
}

export interface Manifest {
  network: string;
  chainId: number;
  rpc: string;
  graphql: string;
  explorer: string;
  contracts: {
    GraphDomainCaveatEnforcer: DeployedContract & {
      constructorArgs: { multiVault: `0x${string}`; governor: `0x${string}`; allowedSelector: `0x${string}` };
    };
    MockGovernor: DeployedContract;
  };
  framework: Record<string, string>;
  multiVault: `0x${string}`;
  vocabulary: {
    predicate: { label: string; termId: `0x${string}` };
    atoms: Record<string, `0x${string}`>;
    triples: Record<string, `0x${string}`>;
  };
  attestation: {
    note: string;
    orgAttestor: `0x${string}` | null;
    curveId: string | null;
    stakes: Record<string, { shares: string; txHash: `0x${string}` | null }>;
  };
}

export function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
}

export function writeManifest(manifest: Manifest): void {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
