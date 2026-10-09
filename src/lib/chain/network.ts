import { createPublicClient, defineChain, http, type PublicClient } from "viem";

/** Intuition testnet (13579) — canonical values, pinned in the manifest and CLAUDE.md. */
export const intuitionTestnet = defineChain({
  id: 13579,
  name: "Intuition Testnet",
  nativeCurrency: { decimals: 18, name: "Test Trust", symbol: "tTRUST" },
  rpcUrls: { default: { http: ["https://testnet.rpc.intuition.systems/http"] } },
  blockExplorers: {
    default: { name: "Intuition Testnet Explorer", url: "https://testnet.explorer.intuition.systems" },
  },
  // Canonical CREATE2 deployment, verified present on 13579 (3808 bytes). Declaring it
  // is what lets viem fold a tick's worth of reads into one eth_call.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const EXPLORER_URL = intuitionTestnet.blockExplorers.default.url;

/** Delegation Framework v1.3.0 on 13579 — verified in Phase 0.a (ADR 0002). */
export const FRAMEWORK = {
  delegationManager: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
} as const;

export const ROOT_AUTHORITY = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as const;

/**
 * A read client that batches.
 *
 * One refresh of the app issues a few hundred reads. Sent one HTTP request each, they
 * exhausted the public RPC's bandwidth allowance mid-session. Two layers fix that
 * without changing a single call site: `multicall` folds the reads of one tick into a
 * single `eth_call` through Multicall3, and `batch` puts whatever is left into one HTTP
 * POST. Both degrade quietly — a node that refuses either still answers the reads.
 */
export function createChainClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: intuitionTestnet,
    transport: http(rpcUrl ?? intuitionTestnet.rpcUrls.default.http[0], { batch: true }),
    batch: { multicall: true },
  });
}

export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}

export function shortHex(value: string, lead = 6, tail = 4): string {
  return value.length <= lead + tail + 2 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`;
}
