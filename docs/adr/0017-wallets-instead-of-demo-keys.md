# 0017 — Real wallets instead of demo keys (deferred to v2)

**Status:** Proposed
**Date:** 2026-08-29
**Triggered by:** user request — a hosted build where several people connect their own
wallet, rather than three accounts driven by keys on one machine.

## Context

The POC drives three demo identities from private keys the dev server injects
(ADR 0011). That is what makes the presentation possible without a wallet dance, and it
is also what stops the app being useful to anyone but the person running it: a production
build receives no keys, `canWrite()` turns false, and every write panel falls back to
reading. A hosted site is therefore a viewer, not a participant.

Two things follow from the current design:

- Every write goes through `submitterClient`, one funded EOA that pays for and submits
  every user operation. There is no path where a visitor pays for their own.
- `requireOwnerKey` reaches for a key by role in eleven places across the action layer.
  Signing is not abstracted; it is a key lookup.

Nothing in the scheme itself needs this. The delegations are ERC-7710 objects signed by
smart accounts, which is exactly what a connected wallet can do.

## Decision

Defer it. The POC keeps demo keys, and connecting real wallets is v2 work.

When it happens, the shape is roughly:

- A wallet connector supplies the signer, and the three fixed identities become whoever is
  connected. `Role` stops being an enum of three and becomes an address the app has met.
- `requireOwnerKey` is replaced by a signer the caller passes in, so the action layer stops
  knowing where signatures come from.
- Each participant pays for their own user operation, or a paymaster does. The single
  funded submitter is a demo convenience, not a design.
- Signed delegations need somewhere to live that both parties can read. Today they sit in
  one browser's local storage, which is already flagged as a stand-in for on-chain
  discovery.

## Alternatives considered

- **Do it now** — rejected on timing. It touches the whole action layer, the identity
  model and the storage of signed objects, none of which the bounty asks for, and the
  demo it would replace is the thing being presented.
- **Ship a hosted read-only build meanwhile** — still possible and cheap; it publishes the
  graph, the proposals and the documents without any key. It just is not the same product.

## Consequences

**Positive:**
- The presentation stays simple: no wallet prompts between a claim and the screen that
  proves it.
- The v2 boundary is now written down rather than remembered, including the four places
  that actually block it.

**Negative:**
- The app cannot be shared as a working demo, only as a read-only site or a repo to run.

**Neutral (worth knowing):**
- Nothing in the contracts changes for this. The enforcer, the resolver and the governor
  do not care whether a signature came from a demo key or a hardware wallet.

## References

- Related ADR: `docs/adr/0011-frontend-demo-keys.md` — why the keys are dev-only.
- Related code: `src/lib/actions/common.ts` (`requireOwnerKey`, `submitterClient`),
  `src/lib/config/app-config.ts` (session storage of signed grants).
