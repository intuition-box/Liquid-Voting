# Session faucet — the alternative, not the default

**The app funds a session from the visitor's own wallet.** One transaction, no key
anywhere, nothing to deploy. See [ADR 0027](../docs/adr/0027-the-visitor-pays.md).

This worker is here for the deployment that would rather nobody needed a wallet at all:
set `VITE_FAUCET_URL` and `resolveFunder` falls through to it when the browser has no
wallet. It costs a Cloudflare account, a funded key living somewhere, and somebody to
notice when it runs dry — which is why it is not the default.

The frontend generates a visitor's three wallets in their browser. That part costs nothing
and needs nobody's permission. But the first tTRUST has to come from somewhere, and an
account funded enough to pay for a setup cannot ship inside a public bundle — the moment a
key reaches `dist/`, deploying the page hands a funded account to whoever reads the
JavaScript. That is what [ADR 0011](../docs/adr/0011-frontend-demo-keys.md) exists to
prevent.

So the key lives here instead, as a Worker secret, and the browser asks.

```
browser                                  this worker
  generates four keys
  derives three addresses
  POST { address }            ────────►  rate-limit by caller, cap per day
                                         check its own balance
                                         send a fixed 0.03 tTRUST
                              ◄────────  { txHash }
  deploys, funds, mints,
  self-delegates — paid for
  out of that one transfer
```

The amount is fixed in `src/index.ts` and never read from the request. A faucet that funds
what it is asked to fund is not a faucet.

## Deploying it

```bash
cd faucet
npm install
npx wrangler kv namespace create FAUCET_LIMITS   # paste the id into wrangler.toml
npx wrangler secret put FAUCET_PRIVATE_KEY       # a funded testnet key, nothing else
npx wrangler deploy
```

Then point the frontend at it and rebuild:

```bash
VITE_FAUCET_URL=https://liquid-demo-faucet.<subdomain>.workers.dev bun run build
```

Add the site's origin to `ALLOWED_ORIGINS` in `wrangler.toml` before deploying, or the
browser's preflight will refuse the call.

## What it will and will not do

| | |
|---|---|
| Amount | Fixed at 0.03 tTRUST, enough for roughly double what a session spends |
| Per caller | One session every 6 hours, keyed on the Cloudflare-resolved IP |
| Per day | 60 sessions, then it stops until tomorrow |
| When empty | Answers 503 with a sentence the frontend shows as written |

The per-caller limit is keyed on an IP, which is shared behind a NAT and changed with a
VPN. It is a speed bump, not an identity check — the daily ceiling is what actually bounds
the loss, and the loss is testnet tokens.

## Keeping it fed

A session costs 0.03 tTRUST, so 1 tTRUST is about thirty of them. Check the balance with:

```bash
cast balance <faucet address> --rpc-url https://testnet.rpc.intuition.systems/http --ether
```

If it runs dry the demo does not break — it opens read-only, and everything already on
chain stays readable: the graph, the delegations, every vote and who carried it.
