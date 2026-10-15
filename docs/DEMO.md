# Demo script

Live walkthrough for the Intuition core team. ~13 minutes at a calm pace. Every beat lists
what to say, what to expect on screen, and the recovery move if it misbehaves.

## Before you start (2 minutes, off-camera)

```bash
cd ~/Project/Liquid-Demo
bun run reset         # back to the opening state after a rehearsal (~15 s)
bun run verify        # read-only, ~5 s, asserts every claim below against live state
bun run dev           # http://localhost:5173
```

`bun run reset` is the one to run after rehearsing. It takes every delegation back and
records a fresh proposal on any domain whose only open one has been voted on. Votes
cannot be withdrawn — a governor that could retract a counted vote would be a poor
governor — so a voted proposal is replaced rather than cleared. Running it twice costs
nothing.

`bun run verify` must end with **"Demo is ready — every panel verified against live
state."** If a line says FAIL, fix it before presenting:

| FAIL line | Fix |
|---|---|
| `edge … does NOT authorize` | `bun run seed` — the attestor stake is missing |
| `delegation chain is revoked` | `bun run delegate` — sign a fresh chain (new salt) |
| `… has no unvoted proposal` | `bun run reset` — records one per domain |

**The fallback, if the browser misbehaves.** A second terminal with `bun run acceptance`
ready but **not** executed. It proves every counting rule against the live chain in about
a minute — both voices counted once, a revoked lender refused, a three-level chain
reaching 300, and the log naming the signature it redeemed. Eighteen checks, all of them
things you were about to claim.

**Rehearsing the live extension without spoiling it:** `bun run rehearse` runs the whole
flow under a throwaway label, so the domain you add on stage stays uncreated.

**Gas.** The submitter is `0xAA7a2Dfe…615A`. Keep at least **0.05 tTRUST** on it; check
with `cast balance 0xAA7a2Dfe6524dAE444A64BBd4efb69cadb92615A --rpc-url
https://testnet.rpc.intuition.systems/http --ether`.

Also open, in a background tab, the
[enforcer](https://testnet.explorer.intuition.systems/address/0x6FC726eCCfbAA30D08FbcC7F4afb3bAa30298C59)
on the explorer, for anyone who wants to read it.

**The three identities.** Three cards under the navigation. Clicking one switches who you
are acting as, and everything on screen is written from that account's point of view.

| | Account | Colour |
|---|---|---|
| A | `0x446FF798…417B` | orange |
| B | `0xd99c420d…6fa4` | blue |
| C | `0x91C69d59…A5b2` | violet |

Each card reads `holds / delegating / carrying / casts`. At the opening state all three
hold 100, delegate nothing, carry nothing, and cast 100.

**The log.** A collapsed bar at the foot of the page. Open it once before you start so the
audience knows it is there, then let it fill. It is where the mechanism becomes visible,
and it is where errors go — if something fails, it opens itself.

---

## 1 · The graph is the scope (1.5 min)

Point at the left rail.

> "These are governance domains, and they are not a list — they are a tree, and the tree
> lives on Intuition. Seventeen atoms and sixteen triples, each one saying *this is a
> sub-domain of that*, each staked by a curator."

Expand `treasury`. Point at `grants`, then `micro-grants` three levels down.

> "Nothing here is in a contract. If I add a domain to this tree later, I am not
> redeploying anything."

**What to expect:** every node drawn, no `unusable` flags.

**If a node shows `unusable`:** its edge carries no attestor stake. Say so — it is the
honest case, and §5 is about exactly that — or run `bun run seed` and reload.

---

## 2 · Weight follows the graph (2.5 min)

Acting as **A**, go to **Delegations**. The panel reads *Who holds "treasury"* and says
nobody does.

> "A is going to put B in charge of the treasury. Not of everything — of the treasury,
> and of whatever the graph says sits under it."

Pick **B** and press **hand it to B**.

**What to expect, in order:**

1. An arc runs from A's card to B's, labelled `A → B on treasury`. It holds a couple of
   seconds and fades.
2. A's card now reads `delegating 100 on treasury`; B's reads `carrying A on treasury`
   and `casts 200`.
3. The log gains two rows.

Open the log and read the first row aloud:

> "`A signs a delegation of "treasury" to B` — and look at the badge: **no gas**. This is
> an EIP-712 signature. It is an object sitting in a file. Nothing has been sent
> anywhere."

Then the second:

> "*This* is the transaction, and it is not the delegation. It is one line in a register
> beside the governor saying whose weight B may exercise on this domain. The signature
> says B *may* vote; this says what it carries."

**Expand the signature row** and point at `delegation hash`. Say you will come back to it.

**Recovery:** if the operation reverts, the log says why in words — it opens itself. The
usual cause is a stale `data/delegations.json`; `bun run delegate` fixes it.

---

## 3 · Casting a delegated vote (2 min) — the machinery

Switch to **B**. Go to **Proposals**. The panel header reads *Proposals on "treasury" and
below*, and the rows are the domains beneath it.

> "B can vote on anything under treasury now. Not because a contract was told so — because
> the graph says these domains are under it."

Vote **for** on the `grants` proposal.

**What to expect:** the row's tally moves to 200, and a pill appears under the title:
**`B for 200 carrying A`**.

> "Two voices, one vote, and the row says whose. You do not have to open anything."

Now open the log on the new row and read the label:

> "`B redeems the delegation A signed, and votes with it in A's name`."

Expand it. Three calls, in the order the chain walks them:

- `DelegationManager.redeemDelegations` — redeemed by B, one link, `A → B`
- `GraphDomainScope.beforeHook` — the delegation A signed, its signed scope `treasury`,
  and **the witness: `grants → treasury`**
- `OZGovernor.castVoteFor` — recorded as B, *the delegate, not the signer*, on behalf of A

> "The witness is the path. The redeemer supplies it, and the caveat recomputes every hop
> against the live vault before the governor is reached. Nothing here is trusted."

**Then the payoff.** Point at `delegation hash` on this row, and at the same field on the
signature row from §2.

> "Same hash. That object, signed then and sent nowhere, is the one touching the chain
> now."

---

## 4 · What the scope refuses (2 min)

Still as **B**, select `events` in the rail — it is under `community`, not `treasury`.

> "B holds the treasury. Does it hold this?"

B's card reads `carrying —` and `casts 100`.

> "A hundred. Its own. A's weight is not here, and no code was written to exclude it —
> there is simply no attested path from `events` up to `treasury`."

Vote on an `events` proposal. It counts 100.

**If you want the refusal on chain rather than inferred:** `bun run acceptance` in the
second terminal prints `and the chain refuses the dead delegation
CannotUseADisabledDelegation()` among its eighteen checks.

---

## 5 · Taking it back, and what that does not undo (2 min)

This is the case the Intuition Box review found, and it is worth showing deliberately.

Switch to **A**, go to **Delegations**, and **take `treasury` back**.

**What to expect:** A's card returns to `delegating —`, B's to `carrying —`.

> "A has its domain back. B cannot carry it anywhere any more."

Now go to **Proposals** and find the `grants` proposal B voted on in §3, still acting as A.

**What to expect:** the vote buttons are disabled, and the row reads:

> *You have already voted For here: **B** carried your voice, weighing 100. Taking the
> domain back stops the next one — it does not undo this.*

> "A did not vote here. Its delegate did, in its name — which is the same thing, and the
> interface says so. Revocation cuts the future, never the past."

Then say why that holds, because it is the part people ask about:

> "Two records, and only one of them is state. The attribution is an event — history, and
> a log does not get rewritten. The refusal is a ledger keyed on the *proposal*, not on
> the delegation. Had we keyed it on the signature, deleting the signature would have
> handed A its voice back."

**The tally never moved.** Point at it: still 200.

---

## 6 · Depth is a dial (1 min)

As **A**, hand `treasury` to B again, and open **how deep it reaches** before pressing.

> "The scope is a domain plus a number of hops, and the number is signed into the terms.
> It is immutable for the life of the delegation. A grant that reaches one level is a
> different object from one that reaches five — not a setting somebody can change later."

---

## 7 · Extend the graph, live (2.5 min) — the centrepiece

Stay as **B**. Press **+ add a domain** in the rail, parent `grants`, label something the
room suggests.

**What to expect, in the log:** three transactions — the atom minted, the triple written,
the curator's stake. Then the domain appears in the rail.

Switch to **Proposals**, select the new domain, add a proposal on it, and vote as **B**.

**What to expect:** it counts **200**.

> "That domain did not exist ninety seconds ago. The delegation A signed has not been
> touched — same hash, same terms, same signature. No contract was redeployed and nothing
> was re-signed. The scope widened because the graph widened."

**Recovery:** if the mint fails, the log says why. The commonest cause is gas on the
submitter. `bun run rehearse` beforehand tells you it works.

---

## 8 · One holder at a time (1 min)

As **A**, with B still holding `treasury`, look at the handover panel.

**What to expect:** it is locked. B reads *holds it now*, C reads *take it back first*,
and the button offers to take it back rather than to hand it on.

> "A domain has one holder at a time, and the interface will not let me pretend
> otherwise. The contract refuses it too — `AlreadyDelegated` — but you should not have
> to hit a revert to learn a rule. Weight cannot be moved out from under a delegate
> silently; taking it back is the way, and taking it back is visible."

Then select `grants`, which sits *under* the treasury A already gave away.

**What to expect:** B reads *holds it, through "treasury"*, and C reads *not yours to
give*.

> "Handing over a domain hands over everything beneath it. A does not hold `grants` any
> more — B does, through the parent — so there is nothing here for A to give."

And the cycle guard: as **B**, the picker will not offer **A**.

> "Per domain, not globally. A giving B the treasury says nothing about `community` — C
> can still hand that to A."

---

## 9 · Close on the argument (1.5 min)

Open **Overview**.

> "Nobody is competent everywhere. Today a delegation covers everything you vote on or it
> does not happen. This is the finer thing: by subject, with the subject defined by a
> graph anybody can read and extend."

Then the shape, in three sentences:

> "The scope is a signed term. The path is a witness the redeemer supplies and the caveat
> verifies hop by hop against live state — the same split as a Merkle proof: the prover
> offers a witness, never a fact. And the weight comes from a stock OpenZeppelin Governor,
> inherited unmodified, through the one override it declares virtual for the purpose."

Open **How it works** if anyone wants the addresses.

---

## Questions you should expect, and the short answers

**"What stops me inventing an edge?"** Nothing stops you minting one — triples are
permissionless and cost a fraction of a cent. The enforcer does not read existence, it
reads a named attestor's stake. Existence is not attestation (ADR 0004).

**"Who is the attestor?"** A signed term. An organisation's address for institutional
curation, or `address(0)`, which resolves to the delegator so each level of a chain is
read through its own signer's view of the graph.

**"Why not traverse the graph on chain?"** The MultiVault is keyed by
`hash(subject, predicate, object)`. There is no reverse index, so a contract can verify
that a triple exists but can never enumerate the children of a node. On-chain traversal is
impossible, not expensive (ADR 0003).

**"Did you fork OpenZeppelin?"** No. `Governor`, `GovernorSettings`,
`GovernorCountingSimple` and `GovernorVotes` are inherited as published. The integration
is one override of `_getVotes`, which `Governor` declares virtual for exactly this, plus
a `castVoteFor` entry point because OZ's public ones read the voter from `_msgSender()`
and a redemption executes from the root delegator's account.

**"What does a vote cost?"** About 14k gas per hop of the witness, on top of OZ's own.
The benchmarks are in `contracts/test/gas/`.

**"Can anyone try it?"** Yes — the hosted build generates three wallets in your browser
and your own wallet pays once, 0.03 tTRUST, for the whole session (ADR 0027).

---

## If the whole browser demo fails

Switch to the terminal and run `bun run acceptance`. It drives the same `src/lib` the
frontend does and prints eighteen checks against the live chain in about a minute:

```
ok    B votes on `grants`, carrying A
ok    both voices counted, and only once each        for=200
ok    A cannot cast a voice B already spent          GovernorAlreadyCastVote(0x446FF…)
ok    and the tally never moved                      for=200
ok    and the chain refuses the dead delegation      CannotUseADisabledDelegation()
ok    A's voice appears in the governor's log        carriedBy=B  weight=100
ok    the voice of A reached the end of the chain    for=300
ok    the log names the redemption, not just the vote
```

Say what it is: the same code the browser runs, without the browser. Then talk over it.
