# Demo script

Live walkthrough for the Intuition core team. ~12 minutes at a calm pace. Every step lists
what to say, what to expect on screen, and the recovery move if it misbehaves.

## Before you start (2 minutes, off-camera)

```bash
cd ~/VScode/Liquid-demo
bun run verify        # read-only, ~5s — asserts every claim below against live state
bun run dev           # http://localhost:5173
```

`bun run verify` must end with **"Demo is ready — every panel verified against live
state."** If any line says FAIL, fix it before presenting:

| FAIL line | Fix |
|---|---|
| `edge … does NOT authorize` | `bun run seed` — the attestor stake is missing |
| `delegation chain is revoked` | `bun run phase3:delegate` — sign a fresh chain (new salt) |
| `no fresh active proposal on …` | `bun run seed:proposals` — record unvoted proposals |

Have a second terminal with `bun run vote:run` ready but **not** executed — it is the
fallback if the browser misbehaves, proving the same five flows from the CLI in ~40s.

**Rehearsing the live extension without spoiling it:** `bun run rehearse` runs the whole
flow under a throwaway label, so `motion design` stays uncreated for the real run.
Measured: **18 s, 0.0071 tTRUST**. Keep at least **0.05 tTRUST** on the submitter
(`0xAA7a2Dfe6524dAE444A64BBd4efb69cadb92615A`) before presenting.

Also open, in a background tab, the
[enforcer](https://testnet.explorer.intuition.systems/address/0x948CFe8438161390DbeF07c291Cb8ffDd7955302)
on the explorer — source-verified, for anyone who wants to read it.

**The three identities.** The switcher sits top right; everything below is written from
whoever is selected.

| | Account | Colour |
|---|---|---|
| A | `0x446FF798…417B` | orange |
| B | `0xd99c420d…6fa4` | blue |
| C | `0x91C69d59…A5b2` | green |

---

## 1 · The graph is the scope (1 min)

Point at the left rail.

> "That tree is the whole ontology, read live from the Intuition MultiVault. `branding`
> and `UX` sit under `design`; `legal` has its own branch. A delegation on a domain
> reaches everything beneath it — the shape on screen *is* the shape of the scope."

Click **design**. The branch and everything under it lights up.

> "One delegation on `design` covers `branding`, `logo` and `UX`. Nothing on the `legal`
> side."

**Expect:** `design`, `branding`, `logo`, `UX` in accent; `legal` and its children plain.
Two badges on the right: `A → B` on `design`, `B → C` on `UX`.

> "Those badges are the delegations already in force. A gave `design` to B; B passed `UX`
> on to C."

**If the rail is empty:** the RPC is slow — reload once. Fall back to `bun run verify`,
whose first lines are the same data.

---

## 2 · Weight follows the graph (2 min)

Stay on **A**. Open the **Proposals** tab, click **design** in the rail.

> "Every proposal under `design` is listed, because that is what a delegation there
> covers. The right-hand column is what *I* would cast on each one."

**Expect:** the weight column reads `0` on the `branding` and `UX` rows.

> "Zero — I gave `design` away. Delegating transfers weight, it does not copy it."

Click **legal** in the rail.

> "Here I kept my vote, so I am back to 1."

Now switch to **B** (top right), and click **design** again.

**Expect:** `branding` rows read `2`.

> "B votes with two: its own, plus mine. And on `UX`?"

Click **UX**.

**Expect:** B reads `0`, because B passed `UX` to C.

Switch to **C**, still on `UX`.

**Expect:** `3`.

> "C carries all three — its own, B's, and mine, riding through B. The totals never grow:
> three accounts, three votes, wherever they end up."

---

## 3 · Casting a delegated vote (2 min)

As **B**, on **design**, expand a `branding` proposal.

> "The weight line says two, and where it comes from. Watch the tally."

Click **for**.

**Expect:** green, a tx link, and the For column moves by 2.

> "Recorded as B's vote, weighted by mine. B pressed the button; my weight travelled with
> the delegation I signed yesterday."

---

## 4 · What the scope refuses (2 min)

Still as **B**, click **legal** in the rail and expand a proposal there.

**Expect:** the weight column reads `1`, not 2.

> "One. B can vote on `legal` — nothing silences it — but my weight stays behind, because
> no attested path connects `legal` to the `design` I delegated. The delegation is
> scoped, not a mute button."

Click **for** to show it lands as 1.

> "And that check is not the interface being polite. It is the caveat enforcer, on chain,
> recomputing the triple id for `legal — is a sub-domain of — design` and finding nothing
> there."

**If you want the revert on screen:** switch to the terminal and run `bun run vote:run`;
case 3 prints `NotATriple(0x4385e3…)` against the live contracts.

---

## 5 · Extend the graph, live (3 min) — the centrepiece

Left rail, bottom: **+ add a domain**. Name it `motion design`, with `design` selected as
the parent.

> "Nothing in this system knows what `motion design` is. And the delegations we have been
> using were signed before this meeting."

Click **add**.

**Expect:** three transactions — a new atom, a triple linking it under `design`, and the
attestor's stake — in about 18 seconds. `motion design` appears in the tree under
`design`.

> "Three writes to the Intuition graph. The stake matters: an edge nobody staked
> authorizes nothing, which is what stops anyone widening a delegation for a fraction of
> a cent."

Switch to **B**, click **motion design** in the rail, add a proposal on it, expand it.

**Expect:** the weight column reads `2`.

> "Same delegation. Same signature. Untouched. It now authorizes a domain that did not
> exist when it was signed — no redeploy, no new signature. The scope came from the
> graph, and the graph moved."

**If a transaction fails:** most likely the submitter ran out of tTRUST — check the
terminal. Recovery: pick a different name; the atom id derives from the label, so a
retried name that half-succeeded still works.

---

## 6 · One holder at a time (1.5 min)

Go to **Delegations** as **A**, with `design` selected.

**Expect:** the other accounts are inert, and the only action is **take "design" back**.

> "A domain has one holder at a time. I cannot hand `design` to C while B holds it — that
> would pull the weight out from under B with nothing on screen saying so. The governor
> refuses it."

Now click **branding** in the rail, still as **A**.

**Expect:** the same lock, and the button reads **take "design" back**.

> "Same answer one level down. Giving `design` gave `branding` with it, so handing
> `branding` to someone else now would promise the same vote twice. The parent has to come
> back first — and the governor checks that against the graph, not against a list."

Click **take "design" back**, then switch to **Proposals** and look at a `branding` row.

**Expect:** A is back to `1`, B down to `1`.

> "Revocation is one call, and the weight comes home."

**To reset for a second run:** the `reset` button under the tree clears session domains and
grants.

---

## 7 · Close on the argument (1.5 min)

Say it in this order — it is the submission's thesis:

> "There is no reverse index in the MultiVault. You can ask *does this triple exist*; you
> can never ask *what are the children of this node*. So on-chain traversal is not
> expensive, it is impossible. The redeemer supplies the path as a witness and the
> enforcer verifies every hop against live state: about 14k gas per hop. That is not
> 'on-chain reads *or* an off-chain proof' — it is both, and the split is forced by your
> storage layout rather than chosen by us."

> "And permissionless minting means existence proves nothing — anyone can mint
> `legal is a sub-domain of design` for a fraction of a cent. So authorization follows
> *stake*, not existence. Whose stake is a field in the signed terms: an org address for
> institutional curation, or `address(0)`, which resolves to the delegator so every level
> of the chain is read through its own signer's view of the graph. That is the part that
> makes this a trust-layer integration and not a lookup table."

Then the ask: **Mission 11** — see the slide outline.

---

## Questions you should expect, and the short answers

| Question | Answer |
|---|---|
| *What stops anyone creating the triple?* | Nothing, and it does not matter. Creation is permissionless; authorization requires the attestor's stake on that edge (ADR-B). Every edge in the tree carries one. |
| *Where does the weight actually live?* | In the governor's register, per domain. The UI reads `weightFor` from it, so what you see is what the vote counts. |
| *Why can B vote on `legal` at all?* | Because B has its own vote. Only the delegated weight is scoped — that is the whole point of scoping by domain rather than all-or-nothing. |
| *What if the graph changes after I sign?* | That is the demo you just watched. It is bounded: scope only widens along edges *your* attestor staked. If you are your own attestor, nobody can widen it. |
| *What does traversal cost at depth 5?* | ~100k gas live, ~14k per hop, strictly linear, bounded by the signed `maxDepth`. Table in WRITEUP.md §3. |
| *Why is `isTriple` not enough?* | It returns true for counter-triples — the "against" vault. An enforcer built on it would accept a hop meaning the negation of the edge. We use `getVaultType == 1`, and a fork test proves the trap is real on your deployment. |
| *Is this audited?* | No — it is a POC. 100 tests including fork tests against the live MultiVault, 100 % coverage on the enforcer, a threat-model review with no code findings, Slither clean. Mission 11 should budget a real audit. |
| *Why user operations instead of direct calls?* | `DeleGatorCore.execute` is `onlyEntryPoint`, and there is no bundler on 13579 — so we submit `handleOps` ourselves. A public bundler would remove that step for every app on the chain. |

## If the whole browser demo fails

Switch to the terminal and run `bun run vote:run`. It executes the same five flows against
the same live contracts and prints them as pass/fail lines with the same revert reasons.
It takes about 40 seconds and shares `src/lib` with the panels — the same code path.
