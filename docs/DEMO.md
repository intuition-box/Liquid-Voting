# Demo script

Live walkthrough for the Intuition core team. ~13 minutes at a calm pace. Every step lists
what to say, what to expect on screen, and the recovery move if it misbehaves.

## Before you start (2 minutes, off-camera)

```bash
cd ~/VScode/Liquid-demo
bun run reset         # back to the opening state after a rehearsal
bun run verify        # read-only, ~5s, asserts every claim below against live state
bun run dev           # http://localhost:5173
```

`bun run reset` is the one to run after rehearsing. It takes every delegation back and
records a fresh proposal on any domain whose only open one has been voted on. Votes
themselves cannot be withdrawn, which is why a voted proposal is replaced rather than
cleared. Running it twice costs nothing.

`bun run verify` must end with **"Demo is ready — every panel verified against live
state."** If a line says FAIL, fix it before presenting:

| FAIL line | Fix |
|---|---|
| `edge … does NOT authorize` | `bun run seed` — the attestor stake is missing |
| `delegation chain is revoked` | `bun run delegate` — sign a fresh chain (new salt) |
| `no fresh active proposal on …` | `bun run seed:proposals` — record unvoted proposals |

Have a second terminal with `bun run votes` ready but **not** executed — it is the
fallback if the browser misbehaves, proving the same flows from the CLI in ~40s.

**Rehearsing the live extension without spoiling it:** `bun run rehearse` runs the whole
flow under a throwaway label, so the domain you add on stage stays uncreated. Measured:
**18 s, 0.007 tTRUST**. Keep at least **0.05 tTRUST** on the submitter
(`0xAA7a2Dfe6524dAE444A64BBd4efb69cadb92615A`); it currently holds ~0.58.

Also open, in a background tab, the
[enforcer](https://testnet.explorer.intuition.systems/address/0x948CFe8438161390DbeF07c291Cb8ffDd7955302)
on the explorer — source-verified, for anyone who wants to read it.

**The three identities.** The switcher sits top right; everything on screen is written from
whoever is selected.

| | Account | Colour |
|---|---|---|
| A | `0x446FF798…417B` | orange |
| B | `0xd99c420d…6fa4` | blue |
| C | `0x91C69d59…A5b2` | green |

**The starting state.** A delegated `treasury` to B; B narrowed to `grants` and passed
that on to C.

---

## 1 · The graph is the scope (1.5 min)

Point at the left rail.

```
governance
├── treasury            A → B
│   ├── grants          B → C
│   │   ├── builder-grants
│   │   │   └── micro-grants
│   │   └── retro-funding
│   └── payroll
│       └── contributor-comp
├── protocol
│   ├── parameters → fee-switch, rate-model
│   └── upgrades → emergency-patches
└── community → events, content
```

> "That tree is a DAO's decision surface, read live from the Intuition MultiVault.
> Seventeen domains, five levels. Every edge is a triple somebody staked on — I will come
> back to why the stake matters."

Click **treasury**. The branch and everything under it lights up.

> "A delegation on `treasury` reaches `grants`, `payroll`, and everything below them. The
> shape on screen *is* the shape of the scope. Nothing on the `protocol` or `community`
> side."

**Expect:** the treasury subtree in accent, the rest plain. Two badges: `A → B` on
`treasury`, `B → C` on `grants`.

> "Those badges are the delegations in force. This is what a large DAO actually needs:
> not one delegate for everything, but a treasury delegate, a protocol delegate, and
> sub-delegates below them."

**If the rail is empty:** the RPC is slow — reload once. Fall back to `bun run verify`,
whose first lines are the same data.

---

## 2 · Weight follows the graph (2.5 min)

Stay on **A**. Open **Proposals**, click **treasury** in the rail.

> "Every proposal under `treasury` is listed, because that is what a delegation there
> covers. The right-hand column is what *I* would cast on each one."

**Expect:** the weight column reads `0` throughout.

> "Zero, everywhere under `treasury`. I gave it away — delegating transfers weight, it
> does not copy it."

Click **community** in the rail.

**Expect:** `1`.

> "Here I kept my vote. The delegation is scoped to a branch, not to me."

Switch to **B**, click **payroll**.

**Expect:** `2`.

> "B votes with two: its own, plus mine, because `payroll` sits under the `treasury` I
> delegated. B was never granted `payroll` — the graph carried it."

Click **grants**.

**Expect:** B reads `0`.

> "And zero here, because B passed `grants` on to C."

Switch to **C**, click **micro-grants** — three levels below `grants`.

**Expect:** `3`.

> "Three. C’s own, B’s, and mine, riding down two delegations and three graph hops.
> The totals never grow: three accounts, three votes, wherever they end up."

---

## 3 · Casting a delegated vote (1.5 min)

As **C**, on **micro-grants**, expand *Raise the Micro-Grant Ceiling from 2k to 5k*.

> "The weight line says three, and whose voices they are. Watch the tally."

Click **for**.

**Expect:** green, a tx link, the For column moves by 3.

> "One vote, three voices, recorded as C’s. That is a sub-delegation working: the DAO
> delegated a treasury, the treasury delegated its grants programme, and the decision
> happened four levels down without anyone above having to show up."

---

## 4 · What the scope refuses (2 min)

Switch to **B**, click **events** in the rail, expand a proposal there.

**Expect:** the weight column reads `1`, not 2.

> "One. B can vote on `events` — nothing silences it — but my weight stays behind, because
> no attested path connects `events` to the `treasury` I delegated. The delegation is
> scoped, not a mute button."

> "And that check is not the interface being polite. It is the caveat enforcer, on chain,
> recomputing the triple id for `events — is a sub-domain of — treasury` and finding
> nothing there."

**If you want the revert on screen:** run `bun run votes` in the terminal; the failing
cases print `NotATriple(0x…)` against the live contracts.

---

## 5 · Depth is a dial (1.5 min)

Go to **Delegations** as **A**, click **community** in the rail — a branch A still holds.

> "When I sign, I choose how far the grant reaches."

Point at **how deep it reaches**. Set it to **that domain only**, then hand `community`
to B.

Switch to **B**, open **Proposals**, click **community**.

**Expect:** `2` on the `community` proposal.

Click **events**, one level below.

**Expect:** `1`.

> "One level down and my weight is gone. `maxDepth` is signed into the terms, so it is
> fixed for the life of the delegation — I cannot widen it afterwards, and neither can
> anyone else. A DAO can hand out a whole branch, or exactly one topic."

---

## 6 · Extend the graph, live (2.5 min) — the centrepiece

Left rail, bottom: **+ add a domain**. Select **grants** as the parent, name it
`hackathon-grants`.

> "Nothing in this system knows what `hackathon-grants` is. And the delegations we have
> been using were signed this morning."

Click **add**.

**Expect:** three transactions — a new atom, a triple linking it under `grants`, and the
attestor’s stake — in about 18 seconds. It appears in the tree.

> "Three writes to the Intuition graph. The stake matters: an edge nobody staked
> authorizes nothing, which is what stops anyone widening a delegation for a fraction of
> a cent."

Switch to **C**, click **hackathon-grants**, add a proposal on it, expand it.

**Expect:** the weight column reads `3`.

> "Same delegations. Same signatures. Untouched. They now reach a domain that did not
> exist when they were signed — no redeploy, no new signature. For a DAO that means
> opening a new programme without re-collecting every delegation."

**If a transaction fails:** most likely the submitter ran out of tTRUST — check the
terminal. Recovery: pick a different name; the atom id derives from the label, so a
retried name that half-succeeded still works.

---

## 7 · One holder at a time (1 min)

**Delegations** as **A**, `treasury` selected.

**Expect:** the other accounts are inert; the only action is **take "treasury" back**.

> "A domain has one holder at a time. I cannot hand `treasury` to C while B holds it —
> that would pull the weight out from under B with nothing on screen saying so."

Click **payroll**, still as **A**.

**Expect:** the same lock, and the button reads **take "treasury" back**.

> "Same answer one level down. Giving `treasury` gave `payroll` with it, so handing
> `payroll` to someone else now would promise the same vote twice. The parent has to come
> back first — and the governor checks that against the graph, not against a list."

**To reset for a second run:** the `reset` button under the tree clears session domains
and grants.

---

## 8 · Close on the argument (1.5 min)

Say it in this order — it is the submission’s thesis:

> "There is no reverse index in the MultiVault. You can ask *does this triple exist*; you
> can never ask *what are the children of this node*. So on-chain traversal is not
> expensive, it is impossible. The redeemer supplies the path as a witness and the
> enforcer verifies every hop against live state: about 14k gas per hop. That is not
> ‘on-chain reads *or* an off-chain proof’ — it is both, and the split is forced by
> your storage layout rather than chosen by us."

> "And permissionless minting means existence proves nothing — anyone can mint
> `events is a sub-domain of treasury` for a fraction of a cent. So authorization follows
> *stake*, not existence. Whose stake is a field in the signed terms: an org address for
> institutional curation, or `address(0)`, which resolves to the delegator so every level
> of the chain is read through its own signer’s view of the graph. That is the part
> that makes this a trust-layer integration and not a lookup table."

> "What that buys a large DAO is sub-delegation with real depth. A treasury delegate who
> hands the grants programme to someone closer to it, who hands micro-grants further down
> still — each level scoped by a graph the DAO already curates, each revocable on its own,
> and the whole thing widening when the DAO opens a new programme."

Then the ask: **Mission 11** — see the slide outline.

---

## Questions you should expect, and the short answers

| Question | Answer |
|---|---|
| *What stops anyone creating the triple?* | Nothing, and it does not matter. Creation is permissionless; authorization requires the attestor’s stake on that edge. Every edge in the tree carries one. |
| *Where does the weight actually live?* | In the governor’s register, per domain. The UI reads `weightFor` from it, so what you see is what the vote counts. |
| *Why can B vote on `events` at all?* | Because B has its own vote. Only the delegated weight is scoped — that is the point of scoping by domain rather than all-or-nothing. |
| *How deep can this go?* | As deep as the graph, capped per delegation by the `maxDepth` its signer chose. The demo tree runs five levels; nothing in the enforcer stops more. |
| *What if the graph changes after I sign?* | That is the demo you just watched. It is bounded: scope only widens along edges *your* attestor staked. If you are your own attestor, nobody can widen it. |
| *What does traversal cost at depth 5?* | ~100k gas live, ~14k per hop, strictly linear, bounded by the signed `maxDepth`. Table in `docs/WRITEUP.md` §3. |
| *Why is `isTriple` not enough?* | It returns true for counter-triples — the "against" vault. An enforcer built on it would accept a hop meaning the negation of the edge. We use `getVaultType == 1`, and a fork test proves the trap is real on your deployment. |
| *Is this audited?* | No — it is a POC. 103 tests including fork tests against the live MultiVault, 100 % coverage on the enforcer, a threat-model review with no code findings, Slither clean. Mission 11 should budget a real audit. |
| *Why user operations instead of direct calls?* | `DeleGatorCore.execute` is `onlyEntryPoint`, and there is no bundler on 13579 — so we submit `handleOps` ourselves. A public bundler would remove that step for every app on the chain. |

## If the whole browser demo fails

Switch to the terminal and run `bun run votes`. It executes the same flows against the
same live contracts and prints them as pass/fail lines with the same revert reasons. It
takes about 40 seconds and shares `src/lib` with the panels — the same code path.
