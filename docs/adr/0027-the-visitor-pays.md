# 0027 — The visitor pays

**Status:** Accepted
**Date:** 2026-10-14
**Amends:** [ADR 0023](0023-sessions-are-made-in-the-browser.md), which chose a faucet
**Triggered by:** user question — why not just connect with MetaMask?

## Context

ADR 0023 settled everything about a browser-made session except where its first tTRUST
comes from. That part cannot happen in the browser: the accounts have to be deployed and
funded before they can pay for anything, and an account funded enough to do that must not
ship in the bundle. It chose a faucet — an endpoint holding the key server side.

That is a correct answer to the question as posed. The question was too narrow.

A faucet means a Cloudflare account, a KV namespace, a secret, a rate limit, a daily cap,
and somebody noticing when it runs dry. It means an empty state that has to be written,
explained and handled. And it means a funded key continues to exist, merely somewhere
better.

## Decision

The visitor's own wallet pays. One transaction of 0.03 tTRUST funds the session's
submitter; the three deployments, three top-ups and three operations that follow come out
of it without another prompt.

**One signature, then watch.** That matters more than the count suggests — the thing being
demonstrated is a delegation chain that runs without further consent, so a setup that asks
once and then proceeds is the same shape as the thing it is setting up.

`resolveFunder` tries three in order:

| | when | why it is in that position |
|---|---|---|
| the local key | `contracts/.env` is present | development needs nothing extra running |
| **the visitor's wallet** | a browser has one | no key exists anywhere; nothing to deploy or feed |
| a faucet | `VITE_FAUCET_URL` is set | for a deployment that would rather nobody needed a wallet |

The faucet stays in the tree, unbuilt and undeployed. It is a real option for a different
audience and it costs nothing to leave standing.

**The chain switch is attempted before the add**, because a wallet that already knows
Intuition testnet should not be asked to add it again — a `wallet_addEthereumChain` prompt
for a network already present is one a visitor has no way to make sense of. A decline
(4001) is told apart from an unrecognised chain (4902), so declining says so instead of
retrying into a second prompt.

**A visitor who cannot afford it is told the figure**, and where Intuition's faucet is,
rather than watching a transaction revert.

## Consequences

ADR 0011's rule now holds by construction rather than by arrangement. There is no funded
key in the bundle, and in the default hosted path there is no funded key anywhere at all.

It also reads differently, and that is worth saying plainly: a DAO's engineering team
opening a governance demo expects to connect a wallet. Being handed tokens says "toy", and
that is a hard impression to argue with afterwards.

The cost is a step the Intuition Box review explicitly asked us not to have — "wallet
auto-generation on page load so anyone can try the POC without manual setup". Connecting a
wallet is manual setup. A visitor with no tTRUST has to visit Intuition's portal first.

Against a funded key that has to live somewhere and be watched, that is the better trade —
and the faucet remains one `wrangler deploy` away for anyone who disagrees.
