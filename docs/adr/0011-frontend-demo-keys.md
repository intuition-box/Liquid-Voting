# 0011 — The frontend drives local demo keys, not a wallet connection

**Status:** Accepted
**Date:** 2026-08-18
**Triggered by:** Phase 4 — the panels must submit user operations from three smart
accounts and a funded submitter, on a chain with no bundler.

## Context

The three `HybridDeleGator` accounts are owned by EOAs generated in Phase 3
(`data/accounts.json`, gitignored, testnet-only). A browser-wallet flow would require
either re-deploying the accounts under MetaMask-owned keys, or asking the presenter to
switch accounts three times mid-demo (voter revokes, delegate redeems, executor
redeems) on a chain MetaMask does not know by default.

The bounty asks for a frontend that "runs locally (or is deployed)", and the mission
ends in a live presentation where every second of fumbling costs attention.

## Decision

The frontend reads the same local artefacts the CLI scripts write — `manifest/13579.json`,
`data/accounts.json`, `data/delegations.json` — and signs with those keys directly. The
funded submitter key is injected by `vite.config.ts` from `contracts/.env`, **only when
`command === "serve"`**: a production build receives an empty string, `canWrite()`
returns false, and every write button disables itself with "read-only build — no
submitter key". Reads work either way, so a deployed build is still a useful artefact.

Keys never enter git: `data/` and `contracts/.env` are gitignored, and the built bundle
carries no key.

## Alternatives considered

- **Browser wallet (MetaMask / injected)** — rejected for the POC: requires adding chain
  13579 by hand, re-deploying the accounts under wallet-owned keys, and three account
  switches per demo run. It is the right answer for Mission 11 and is recorded as such
  in the writeup.
- **A tiny local signing server** — rejected: more moving parts than the demo needs, and
  the same key-on-the-machine trust story.
- **Read-only frontend, all writes via CLI** — rejected: panels 3–5 are the deliverable's
  demonstration value; watching a terminal is not the demo the bounty asks for.

## Consequences

**Positive:**
- One command (`bun run dev`) and every panel is live — no wallet setup on stage.
- The frontend and the CLI runner share `src/lib`, so what the demo shows is what the
  acceptance runner proved.

**Negative:**
- The dev bundle contains a testnet private key. Acceptable only because the key is
  throwaway, funded with a few tTRUST, and never committed — but it means the dev server
  must not be exposed publicly (`vite` binds localhost; do not pass `--host`).

**Neutral (worth knowing):**
- Domains minted during a session are kept in `localStorage` (per the storage rule) so
  the graph and pickers update instantly without regenerating the manifest.

## References

- Related ADR: `0010-self-bundled-user-ops.md`
- Related rule: `.claude/rules/metamask-delegation.md` (storage), `security.md` (opsec)
