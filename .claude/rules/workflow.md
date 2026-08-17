# Workflow rules

Load at the start and end of **every** task.

## Scope discipline

This repo is a focused POC: an ERC-7710 liquid-democracy delegation chain whose domain scope is resolved from the Intuition knowledge graph (the five deliverables in `CLAUDE.md`). If a task seems to need something outside that, **stop and ask**. Explicitly out of scope: a real Governor integration, relayers/paymasters, anything upgradeable.

Drift signals — when you catch yourself thinking any of these, stop:

- "while we're at it, let's also…"
- "it would be better if we also…"
- "this is a good opportunity to refactor…"
- "I noticed we could easily add…"
- "let me make this more flexible for the future…"

Every signal triggers a stop. Either the user authorizes the scope expansion explicitly, or the idea goes in a `FUTURE.md` for later.

## Git hygiene

- **Conventional commits.** `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. Scope prefix when useful: `feat(core): …`, `feat(web): …`, `feat(contract): …`.
- **Atomic commits.** One logical change per commit. Tests that go with a feature ship in the same commit as the feature.
- **No "fix typo" commits after the fact.** Either squash before the PR is up, or live with it.
- **No `--no-verify`.** If a hook fails, fix the underlying issue.
- **No force-push to `main`.** Force-push to feature branches is fine.

## Communication style (when reporting to the user)

End-of-task report has three parts and no more:

```
**What shipped**
<one sentence, concrete: file paths, line counts, deployed address, etc.>

**What I decided**
<any non-obvious choice, with the one-sentence reason. If nothing non-obvious, write "nothing notable".>

**What's next or blocked**
<the next logical task, or what the user needs to unblock>
```

Do not:
- Write multi-paragraph narratives unless asked.
- Use emoji.
- Use excessive bold.
- Apologize for reasonable choices.
- Hedge ("I think maybe...").
- Restate the task back before doing it.
- Write filler ("I'll now proceed to...").

## Change verification

A change is **not** complete until it has been verified against the rules and the deliverable actually works. The protocol:

1. Finish the implementation work.
2. Run the relevant checks: `bun run typecheck` for TS; `forge test` (+ `forge coverage`) for contracts; the web app builds with `bun run build`.
3. For contract changes, run the `contract-reviewer` agent. For web/UI changes, run the `ui-reviewer` agent.
4. Spot-check the change against the loaded rules (no `any`, custom errors, NatSpec, no dead code).
5. If a check fails → fix and re-run. Do not declare done.

## Recording decisions

If during a task you make a non-obvious decision (a design tradeoff, a deviation from an obvious approach, an architectural choice not pre-specified), write an ADR in `.claude/choices/` using the template.

Examples of "non-obvious" worth recording:
- Choosing one library over another that was also viable.
- Picking an algorithm with a particular tradeoff (e.g., O(n) write for O(1) read).
- Deciding the boundary between two layers.
- Deviating from a rule (with justification — rules can be broken with cause, but the break must be recorded).

Things **not** worth an ADR:
- Standard patterns from the rules or the docs.
- "I named this file X." Trivial.
- Bug fixes where the right answer was obvious.

## Asking for clarification

Stop and ask, do not guess, when:

- A task contradicts the decided architecture (`CLAUDE.md`, ADRs 0002–0007).
- The user's instruction would expand scope.
- A delegation / caveat encoding detail is ambiguous (which caveat, which terms, which chain).
- A deployment or write targets anything other than Intuition testnet 13579 (mainnet requires explicit confirmation and is out of scope for this POC).
- A rule and a task spec disagree.

Ten minutes of clarification saves a day of rework. The cost of asking is near zero. The cost of guessing wrong is the cost of the rework plus the trust damage.
