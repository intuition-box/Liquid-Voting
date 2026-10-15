# 0023 — A session is made in the browser

**Status:** Accepted
**Date:** 2026-10-14
**Supersedes the hosting half of:** [ADR 0011](0011-frontend-demo-keys.md)
**Triggered by:** user request — somewhere anyone can open it, plus "add wallet
auto-generation on page load so anyone can try the POC" from the Intuition Box review.

## Context

The three demo accounts have owner keys in `data/accounts.json`, which is gitignored
because it must be. So the app worked on the machine that generated them and nowhere else:
a clone opened read-only even though the accounts were funded on chain, and the one thing a
visitor wants to do — hand a domain over and watch somebody else vote with it — was the one
thing they could not.

ADR 0011 is why, and it is right. The moment a funded key reaches `dist/`, deploying the
page publishes that account to whoever reads the JavaScript. It has already happened once in
this repo: `import.meta.glob("/data/*.json")` inlined all three owner keys into the bundle,
caught in review and verified present before it was fixed.

Shared accounts would not have worked anyway. Two visitors driving the same three
identities would overwrite each other's delegations and wonder why the demo kept changing
under them.

## Decision

A visitor generates their own. Four keys in the browser — three role owners and a submitter
— three smart accounts deployed at addresses derived before they exist, funded, given a
hundred DVOTE each, and self-delegated so the balance counts. Kept in `localStorage`, so a
reload does not strand funded accounts.

**The graph stays shared.** The vocabulary, the staked edges, the governor and the token are
the thing being demonstrated and they cost real deposits to create. What a session owns is
identity, not subject matter.

**A session is recorded against its governor** and discarded if that changes. Its accounts
would still be funded, but the register they refer to would be gone and every weight it
reported would be a fiction.

**Every step reads the chain before acting and checks it again afterwards**, so a second
pass repeats only what is missing. A mint reverted once in testing for no reason the node
would admit to, leaving an account holding nothing and voting with nothing — and a visitor
who clicked a button has no way to diagnose that.

**The first tTRUST comes from behind an endpoint.** This is the only part that cannot
happen in a browser, and the only place ADR 0011 could have been broken. Two paths, one
interface:

| | Funder | Why |
|---|---|---|
| development | the key already in `contracts/.env` | no extra infrastructure, works today |
| hosted | `faucet/`, a Cloudflare Worker | the key is a Worker secret and never ships |

The faucet fixes the amount in its own source and never reads it from the request — a
faucet that funds what it is asked to fund is not a faucet. It rate-limits per caller, caps
the day, and when it is empty says so in a sentence the frontend displays as written,
because `503` tells a visitor nothing they can act on.

## Consequences

The bundle still carries no key, so ADR 0011's rule is intact: the build-time guard in
`.github/workflows/pages.yml` stays, and `VITE_FAUCET_URL` is a URL, not a secret.

Setting up a session is fifteen stages and about thirty seconds. That is shown rather than
hidden, and it is the reason the transaction log (ADR 0024) was built first: thirteen
operations go past with their costs and their hashes, and by the time the button finishes a
reader has watched accounts be deployed, funded, given tokens and self-delegated. It
explains the stack better than any paragraph, in time that was being spent anyway.

A session costs 0.03 tTRUST, measured rather than guessed — a full setup spends about
0.0001 in gas and parks 0.012 in the three accounts. Roughly thirty sessions per tTRUST.

The keys are burners in `localStorage`, readable by anything that can run script on the
origin. Said plainly in the code: not to be reused for anything that matters.

If the faucet runs dry the demo does not break. It opens read-only and everything on chain
stays readable — the graph, the delegations, every vote and who carried it.
