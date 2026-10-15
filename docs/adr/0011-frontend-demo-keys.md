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

The frontend reads the same local artefacts the CLI scripts write and signs with those
keys directly. **Every secret enters through one door**: the `define` block in
`vite.config.ts`, populated only when `command === "serve"`.

- `__DEMO_SUBMITTER_KEY__` — the funded EOA, from `contracts/.env`.
- `__DEMO_OWNER_KEYS__` — the three account owners, from `data/accounts.json`.

A production build receives an empty string and an empty object; `canWrite()` requires
all four and turns false, so every write button disables itself with "read-only build".
Reads work either way, so a deployed build is still a useful artefact.

**`data/accounts.json` must never be imported from application code.** An earlier
revision globbed `/data/*.json`, which inlined the three owner private keys into
`dist/` — caught in review before anything was deployed. The glob is now narrowed to
`/data/delegations.json` (signatures, no keys) and `/manifest/*.json`, and
`bun run build` is followed by a bundle scan in the release check.

Keys never enter git either: `data/`, `dist/` and `contracts/.env` are gitignored.

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
- Two ways this decision leaked in practice, both found by audit and both now closed:

  The dev server served `data/accounts.json` itself. `server.fs.allow` was the repo root
  and nothing denied the file, so `GET /data/accounts.json` returned all three owner keys
  with status 200. Vite's default deny list covers `.env*` — which is why
  `contracts/.env` was already refused — and knows nothing about this one. It is named in
  `fs.deny` now. No CORS header was ever sent, so a web page could not read it
  cross-origin; anything able to reach the port could.

  And "a production build receives no keys" was not true after a dev session. The
  generated env file was `.env.local`, which Vite loads in *every* mode, and `bun run
  build` is bun running vite — bun loads `.env*` into `process.env` before vite starts,
  and `loadEnv` merges prefixed names back out of it. The unlink in `vite.config.ts` ran
  after the values had already been read, so it deleted the evidence rather than the
  leak: `dist/` carried all four private keys and the checkout looked clean. The file is
  now named for the dev mode, the `DEMO_` variables are dropped from `process.env` on a
  build, and `bun run build` ends by grepping `dist/` for the exact key material on the
  machine (`scripts/check-bundle.ts`). That last check is what makes this claim
  falsifiable instead of asserted; the CI step that was supposed to be it could not fire
  at all, being an always-true `grep` AND-ed with an always-false one.

**Neutral (worth knowing):**
- Domains minted during a session are kept in `localStorage` (per the storage rule) so
  the graph and pickers update instantly without regenerating the manifest.

## References

- Related ADR: `0010-self-bundled-user-ops.md`
- Related rule: `.claude/rules/metamask-delegation.md` (storage), `security.md` (opsec)
