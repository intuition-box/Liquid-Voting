# 0001 — Rules adapted from Hourglass for a custom-enforcer repo

**Status:** Accepted
**Date:** 2026-08-17
**Triggered by:** Bootstrap §2 (repo setup) — rule files copied from `~/Project/Hourglass`, then adapted per the update protocol in `.claude/rules/00-INDEX.md`.

## Context

This repo bootstraps from Hourglass's `.claude/rules/`, agents, ADR template, and the
Intuition skill. Hourglass is a recurring-ERC20-subscription POC; this repo is the
ERC-7710 Liquid Democracy POC. Several rules encoded Hourglass-specific facts that are
false here — most importantly, `metamask-delegation.md` said *"there are no custom
caveat enforcers in this repo — writing one is a scope expansion."* In this repo the
exact opposite is true: the custom `GraphDomainCaveatEnforcer` is the core deliverable.

## Decision

Copy the rule set wholesale, then adapt in place:

- **`metamask-delegation.md` — rewritten.** The custom enforcer is in scope (any
  *additional* enforcer is not). Added the verified framework facts for chain 13579
  (v1.3.0, `_terms` signed / `_args` untrusted, leaf→root ordering, native revocation),
  swapped the subscription flow for the 3-level delegation chain, and kept the two
  standing prohibitions: no relayers/paymasters, and no Safe-module pattern (Hourglass
  wrapped delegation in a Safe module; here plain `HybridDeleGator` accounts redeem
  directly).
- **`solidity.md`** — added the pragma exception for framework-importing contracts
  (ADR 0006) and replaced the Hourglass contract inventory (`MockERC20`) with this
  repo's (`GraphDomainCaveatEnforcer`, `MockGovernor`, `MockMultiVault`).
- **`security.md`** — front-running and signature-replay sections now describe this
  repo's threat surface (permissionless graph writes → ADR 0004; untrusted `_args` →
  ADR 0003) instead of subscription charging.
- **`code.md` / `ui.md`** — path and stack references updated (`src/lib`,
  `src/components`, viem instead of wagmi). Content unchanged.
- **`workflow.md`** — scope line and verification commands updated for this repo.

## Alternatives considered

- **Write rules from scratch** — rejected; the Hourglass rules encode house style that
  has caught real failures (independent post-deploy verification, term_id-not-label),
  and the bounty mandates reuse.
- **Copy without adapting** — rejected; a rule stating the enforcer is out of scope
  would have blocked the core deliverable.

## Consequences

**Positive:**
- House style continuity with Hourglass; a reviewer of both repos sees one discipline.

**Negative:**
- The rules carry more text than a minimal POC strictly needs.

**Neutral (worth knowing):**
- Hourglass's `.claude/choices/` history was *not* copied — this repo's ADRs start
  fresh at 0001. Hourglass ADR 0003 (predicate-reuse methodology) is cited by
  reference from ADR 0008.

## References

- Related rule: `.claude/rules/metamask-delegation.md`, `.claude/rules/solidity.md`,
  `.claude/rules/security.md`
- Related ADR: `.claude/choices/0006-pragma-0.8.23.md`, `.claude/choices/0008-*.md`
- Update protocol: `.claude/rules/00-INDEX.md`
