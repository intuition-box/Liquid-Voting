# Demo script

Live walkthrough for the Intuition core team. ~12 minutes at a calm pace. Every step
lists what to say, what to expect on screen, and the recovery move if it misbehaves.

## Before you start (2 minutes, off-camera)

```bash
cd ~/Project/Liquid-Demo
bun run verify        # read-only, ~5s — asserts every claim below against live state
bun run dev           # http://localhost:5173
```

`bun run verify` must end with **"Demo is ready — every panel verified against live
state."** If any line says FAIL, fix it before presenting:

| FAIL line | Fix |
|---|---|
| `edge … does NOT authorize` | `bun run seed` — the attestor stake is missing |
| `delegation chain is revoked` | `bun run phase3:delegate` — sign a fresh chain (new salt) |
| `… should pass but got …` | check the RPC is reachable; re-run `verify` |

Have a second terminal open with `bun run phase3:run` ready but **not** executed — it is
the fallback if the browser misbehaves (it proves the same six flows from the CLI).

**Rehearsing step 5 without spoiling it:** `bun run rehearse` runs the whole live
extension flow under a throwaway label, so `motion design` stays uncreated for the real
run. Measured: **4.1 s, 0.0071 tTRUST**. Keep at least **0.05 tTRUST** on the submitter
(`0x8e1e5782425C7F06933C7b50ebF89a29f6621735`) before presenting.

Also open: the [explorer](https://testnet.explorer.intuition.systems/address/0x97874e29cE2b98afF21d1dCad03348ac8A16739b)
on the enforcer, in a background tab, for anyone who wants to see the verified source.

---

## 1 · The graph is the authority (1 min)

**Panel 01 — Domain graph.**

> "These three edges are the whole ontology: `branding` and `UX` are sub-domains of
> `design`, `logo` is a sub-domain of `branding`. `legal` exists as an atom but is
> deliberately linked to nothing."

Point at the two tags on each row:

> "Each edge shows two things read live from the MultiVault: that it is a **positive
> triple** — not a counter-triple — and that our attestor **holds a position** on it.
> Both must be true for the edge to authorize anything. I'll come back to why."

**Expect:** three rows, each with `positive triple` and `attested · 0.0099 shares` in
green. `legal` appears under the list as unlinked.

**If the panel is empty:** the RPC is slow — reload once. Fall back to
`bun run verify`, whose first three lines are the same data.

---

## 2 · The delegation chain (1 min)

**Panel 02 — Delegation chain.**

> "Two delegations, signed off-chain, zero transactions. The voter granted the delegate
> everything under `design`. The delegate then narrowed it: the executor only gets `UX`.
> Both are EIP-712 signatures over the Delegation Manager's domain — nothing is on chain
> until someone redeems."

> "Note the attestor row: it names *whose* view of the graph this delegation is read
> through. That single field is a governance dial and I'll come back to it too."

**Expect:** two levels, both `active`, scopes `design` and `UX`, max depth 3.

---

## 3 · Exact match, then one hop (2 min)

**Panel 03 — Propose.**

**3a.** Domain `UX`, redeem through **full chain**. Before clicking anything, point at
the witness block:

> "The path is computed here, in the browser, from the graph. For the executor's `UX`
> scope it's an exact match — zero hops. For the voter's `design` scope it's `UX → design`,
> one hop the enforcer will verify on chain."

Click **simulate** → green. Then **submit on chain**.

**Expect:** "proposal recorded on chain, in the voter's name" + a tx link, and a new row
in *recorded proposals* whose address is the **voter's** smart account.

> "That's the point of delegation: the executor pressed the button, but the governor
> recorded the proposal in the voter's name."

**3b.** Domain `branding`, redeem through **root only**.

> "Now through the voter's delegation alone, scoped to `design`. `branding` isn't
> `design` — but it's one attested hop beneath it."

Click **simulate** → green, then **submit**.

**If a submit fails:** read the revert on screen — it is the real reason. Most likely
cause during a demo is a revoked chain from an earlier run: re-sign with
`bun run phase3:delegate`, reload the page. Do not retry blindly.

---

## 4 · What must fail, fails (2 min)

**4a — out of scope.** Domain `legal`, redeem through **root only**.

Point at the witness block *before* simulating:

> "No attested path exists from `legal` up to `design`, so the client can't build a
> witness. We submit one anyway — that's how you see the contract's own answer."

Click **simulate**.

**Expect:** red — `NotATriple(0x4385e3…)`.

> "That hex is the triple id the enforcer computed for `legal — is a sub-domain of —
> design` and looked for. It was never created, so the hop fails. The enforcer doesn't
> trust the path — it recomputes every id itself."

**4b — narrowing.** Domain `branding`, redeem through **full chain**.

> "`branding` just passed under the voter's `design` delegation. Now the same proposal
> through the full chain, which also has to satisfy the executor's `UX` scope."

Click **simulate**.

**Expect:** red — `NotATriple(0x5b52dc…)`, and the witness block shows `none up to UX`
next to a valid `branding → design`.

> "Valid at one level, rejected at the other. We wrote no narrowing code — the framework
> runs every caveat in the chain and they compound. Narrowing is emergent."

---

## 5 · Extend the graph, live (3 min) — the centrepiece

**Panel 05 — Extend the graph, live.**

New domain `motion design`, parent `design`.

**5a.** Click **check it fails today**.

**Expect:** red — *"motion design (0x…) does not exist on chain yet — no path can reach
it, so no delegation authorizes it."*

> "Nothing in this system knows what `motion design` is. And remember: those two
> delegations were signed before this conversation started."

**5b.** Click **create + attest**.

**Expect:** green, with three links — atom created, triple created, deposit. Three
transactions, ~4 seconds end to end (measured in rehearsal).

> "Three writes to the Intuition graph: a new atom, a new triple linking it under
> `design`, and a stake from our attestor — because an edge nobody staked authorizes
> nothing."

**5c.** Scroll up to **Panel 01**: `motion design → design` is now in the graph, attested.
Then **Panel 03**: choose `motion design`, redeem through **root only**.

> "Same delegation. Same signature. Untouched. Watch the witness."

**Expect:** witness shows `motion design → design`. Simulate → green. Submit → recorded.

> "A delegation signed ten minutes ago just authorized a domain that did not exist when
> it was signed. No contract redeploy, no new signature. The scope came from the graph,
> and the graph moved."

**If a transaction fails:** most likely the submitter ran out of tTRUST — check the
terminal. Recovery: use a different domain name (the atom id is derived from the label,
so a retried name that half-succeeded still works — the script is idempotent per step).

---

## 6 · Revocation (1.5 min)

**Panel 04 — Revoke.**

> "One call from the voter, and everything below dies. This is native to the framework —
> we wrote zero lines for it."

Click **revoke root delegation**.

**Expect:** green — *"both downstream accounts are dead — executor:
CannotUseADisabledDelegation, delegate: CannotUseADisabledDelegation"*, plus a tx link.
Panels 02 shows both levels as revoked/dead.

Optionally go back to Panel 03 and simulate anything: red, `CannotUseADisabledDelegation`.

> "The delegate's authority is the hash of the voter's delegation. Disable that hash and
> the whole subtree is gone in one transaction."

**To reset for a second run:** `bun run phase3:delegate` (fresh salt), reload.

---

## 7 · Close on the argument (1.5 min)

Say it in this order — it is the submission's thesis:

> "There is no reverse index in the MultiVault. You can ask *does this triple exist*, you
> can never ask *what are the children of this node*. So on-chain traversal isn't
> expensive — it's impossible. The redeemer supplies the path as a witness and the
> enforcer verifies every hop against live state: about 14k gas per hop. That's not
> 'on-chain reads *or* an off-chain proof' — it's both, and the split is forced by your
> storage layout, not chosen by us."

> "And permissionless minting means existence proves nothing — anyone can mint
> `legal is a sub-domain of design` for a fraction of a cent. So authorization follows
> *stake*, not existence. Whose stake is a field in the signed terms: an org address for
> institutional curation, or `address(0)` which resolves to the delegator — so every
> level of the chain is read through its own signer's view of the graph. That's the part
> that makes this a trust-layer integration and not a lookup table."

Then the ask: **Mission 11** — see the slide outline.

---

## Questions you should expect, and the short answers

| Question | Answer |
|---|---|
| *What stops anyone creating the triple?* | Nothing — and it doesn't matter. Creation is permissionless; authorization requires the attestor's stake on that edge (ADR-B). Show Panel 01: every edge carries an attesting position. |
| *What does traversal cost at depth 5?* | ~100k gas live, ~14k per hop, strictly linear, bounded by the signed `maxDepth`. Table in WRITEUP.md §3. |
| *What if the graph changes after I sign?* | That's the feature — it's the demo you just watched. It's bounded: scope only widens along edges *your* attestor staked. If you're your own attestor, nobody can widen your scope at all. |
| *Why not just read the graph off-chain and pass a signed result?* | That adds a trusted signer and a liveness dependency, and gives up the property that the graph itself is the authority. The witness pattern gets the same gas profile with no new trust. |
| *Why is `isTriple` not enough?* | It returns true for counter-triples — the "against" vault. An enforcer built on it would accept a hop meaning the negation of the edge. We use `getVaultType == 1`. There's a fork test proving the trap is real on your deployment. |
| *Is this audited?* | No — it's a POC. It has 100 % coverage on the enforcer, 46 tests including fork tests against the live MultiVault, a threat-model review with no code findings, and Slither clean. Mission 11 should budget a real audit. |
| *Why user operations instead of direct calls?* | `DeleGatorCore.execute` is `onlyEntryPoint`, and there's no bundler on 13579 — so we submit `handleOps` ourselves. A public bundler on the chain would remove that step for everyone, not just us. |

## If the whole browser demo fails

Switch to the terminal and run `bun run phase3:run`. It executes the same six flows
against the same live contracts and prints them as pass/fail lines with the same revert
reasons. It takes about 40 seconds and it is the same code path — the panels and the
runner share `src/lib`.
