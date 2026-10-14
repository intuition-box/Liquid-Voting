/**
 * A faucet for demo sessions: one small transfer per visitor, key kept server side.
 *
 * The frontend generates a visitor's wallets in their browser, which costs nothing and
 * needs nobody's permission — but the first tTRUST has to come from somewhere, and an
 * account funded enough to pay for a setup cannot ship inside a public bundle. That is
 * what ADR 0011 is about: the moment a key reaches `dist/`, deploying the page publishes
 * a funded account to whoever reads the JavaScript.
 *
 * So the key lives here, as a Worker secret, and the browser asks. The amount is fixed by
 * this file and never taken from the request: a faucet that funds what it is asked to
 * fund is not a faucet, it is a withdrawal.
 *
 * Deploy:
 *   cd faucet && npm install
 *   npx wrangler kv namespace create FAUCET_LIMITS
 *   npx wrangler secret put FAUCET_PRIVATE_KEY
 *   npx wrangler deploy
 */
import { createPublicClient, createWalletClient, defineChain, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface Env {
  /** The funded testnet key. A Worker secret — never a variable in wrangler.toml. */
  FAUCET_PRIVATE_KEY: string;
  /** Per-caller and per-day counters. */
  FAUCET_LIMITS: KVNamespace;
  /** Comma-separated origins allowed to call this. Set in wrangler.toml. */
  ALLOWED_ORIGINS?: string;
  RPC_URL?: string;
}

const intuitionTestnet = defineChain({
  id: 13579,
  name: "Intuition Testnet",
  nativeCurrency: { decimals: 18, name: "Test Trust", symbol: "tTRUST" },
  rpcUrls: { default: { http: ["https://testnet.rpc.intuition.systems/http"] } },
});

/**
 * What one session gets. Must match `SESSION_BUDGET` in src/lib/chain/bootstrap.ts.
 *
 * Measured: a full setup spends about 0.0001 tTRUST in gas and parks about 0.012 in the
 * three accounts, so this is roughly double what a session needs.
 */
const GRANT = parseEther("0.03");

/** One session per caller per window, and a ceiling on the whole day. */
const WINDOW_SECONDS = 60 * 60 * 6;
const GRANTS_PER_DAY = 60;

/** Below this the faucet says it is empty instead of sending a transaction that fails. */
const RESERVE = parseEther("0.05");

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return text("POST an address to this endpoint.", 405, cors);

    let address: string | undefined;
    try {
      ({ address } = (await request.json()) as { address?: string });
    } catch {
      return text("Expected a JSON body of {\"address\": \"0x…\"}.", 400, cors);
    }
    // Checksum-insensitive on purpose: the browser sends whatever viem derived.
    if (!address || !isAddress(address, { strict: false })) {
      return text("That is not an address.", 400, cors);
    }

    // The caller's own IP, as Cloudflare resolved it. Trivially shared behind a NAT and
    // trivially changed with a VPN — which is why there is a daily ceiling as well.
    const caller = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const today = new Date().toISOString().slice(0, 10);

    const recent = await env.FAUCET_LIMITS.get(`caller:${caller}`);
    if (recent) {
      return text(
        `A session was already funded from here recently. One per ${WINDOW_SECONDS / 3600} hours — the demo is readable without one in the meantime.`,
        429,
        cors,
      );
    }

    const spentToday = Number((await env.FAUCET_LIMITS.get(`day:${today}`)) ?? "0");
    if (spentToday >= GRANTS_PER_DAY) {
      return text("The faucet has given out its allowance for today. Try again tomorrow.", 429, cors);
    }

    const transport = http(env.RPC_URL ?? intuitionTestnet.rpcUrls.default.http[0]);
    const account = privateKeyToAccount(env.FAUCET_PRIVATE_KEY as `0x${string}`);
    const publicClient = createPublicClient({ chain: intuitionTestnet, transport });

    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < GRANT + RESERVE) {
      // Said plainly, because the frontend shows this to a visitor and "500" tells them
      // nothing they can act on.
      return text("The faucet is out of tTRUST. The demo is still readable; ask for a top-up.", 503, cors);
    }

    const wallet = createWalletClient({ chain: intuitionTestnet, transport, account });
    const txHash = await wallet.sendTransaction({ to: address as `0x${string}`, value: GRANT });

    // Recorded after the send, so a failure to send does not consume the caller's turn.
    // The reverse would be safer against a double spend; this is a testnet faucet handing
    // out three cents, and a visitor locked out by a transient node error is the worse
    // outcome.
    await Promise.all([
      env.FAUCET_LIMITS.put(`caller:${caller}`, txHash, { expirationTtl: WINDOW_SECONDS }),
      env.FAUCET_LIMITS.put(`day:${today}`, String(spentToday + 1), { expirationTtl: 60 * 60 * 48 }),
    ]);

    return new Response(JSON.stringify({ txHash }), {
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
    });
  },
} satisfies ExportedHandler<Env>;

/**
 * CORS for the origins this faucet serves.
 *
 * A reflected origin would make this callable from any page on the internet, which for a
 * rate-limited testnet faucet is an annoyance rather than a breach — but the allowlist
 * costs one line and keeps somebody else's site from spending this allowance.
 */
function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const permit = origin && (allowed.length === 0 || allowed.includes(origin)) ? origin : allowed[0] ?? "";
  return {
    "Access-Control-Allow-Origin": permit,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function text(body: string, status: number, headers: Record<string, string>): Response {
  return new Response(body, { status, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
}
