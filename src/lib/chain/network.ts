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
});

export const EXPLORER_URL = intuitionTestnet.blockExplorers.default.url;

/** Delegation Framework v1.3.0 on 13579 — verified in Phase 0.a (ADR 0002). */
export const FRAMEWORK = {
  delegationManager: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
} as const;

export const ROOT_AUTHORITY = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as const;

export function createChainClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: intuitionTestnet,
    transport: http(rpcUrl ?? intuitionTestnet.rpcUrls.default.http[0]),
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
