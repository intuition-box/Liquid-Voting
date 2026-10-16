import { createPublicClient, defineChain, http, type PublicClient, type Transport } from "viem";

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
    transport: deduped(http(rpcUrl ?? intuitionTestnet.rpcUrls.default.http[0], { batch: true })),
    batch: { multicall: true },
  });
}

/**
 * Shares one answer between callers who ask the same question at the same moment.
 *
 * React's StrictMode invokes every effect twice in development — mount, unmount, mount —
 * on purpose, to surface effects that fail to clean up. The cleanups here are correct,
 * so the second result wins and the first is discarded; what the cleanup cannot do is
 * recall a request that has already left. Every chain read in development therefore went
 * out twice, and the log queries are the heavy ones: a refresh that measures 167 KB in a
 * script measures twice that in a browser, against an RPC with a bandwidth allowance
 * this demo has exhausted more than once.
 *
 * Turning StrictMode off would hide the class of bug it exists to find. Sharing the
 * in-flight promise costs nothing and is right in production too, where two panels can
 * legitimately want the same read in the same tick.
 *
 * Only *concurrent* identical calls are shared — the entry is dropped the moment the
 * request settles — so this is not a cache and never serves anything stale.
 */
function deduped(transport: Transport): Transport {
  const inFlight = new Map<string, Promise<unknown>>();
  return (config) => {
    const inner = transport(config);
    return {
      ...inner,
      request: ((args: { method: string; params?: unknown }) => {
        const key = JSON.stringify(args);
        const running = inFlight.get(key);
        if (running) return running;
        const started = Promise.resolve(inner.request(args)).finally(() => inFlight.delete(key));
        inFlight.set(key, started);
        return started;
      }) as typeof inner.request,
    };
  };
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
