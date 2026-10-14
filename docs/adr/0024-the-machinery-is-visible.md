# 0024 — The machinery is visible

**Status:** Accepted
**Date:** 2026-10-14
**Triggered by:** the Intuition Box review, 2026-10-13 — "each delegation action should
surface the underlying transactions", and the user: without it you see nothing, and for a
developer the machinery is hard to follow.

## Context

Everything of consequence here goes through a self-bundled user operation, which from the
outside is one `EntryPoint.handleOps` transaction. The delegation being redeemed, the caveat
recomputing a triple id and checking a stake against the live vault, the weight moving in
the register — none of it left a trace a reader could follow. Numbers on screen changed and
you took it on faith.

For this project that is close to fatal. The machinery *is* the product: the pitch is that
authority resolves through a knowledge graph, and if nobody can watch that happen they are
being asked to believe a claim about a thing they cannot see.

A second confusion came up repeatedly in the demo. A delegation is an EIP-712 signature —
free, off-chain, sitting in a file until somebody redeems it — and nothing on screen
distinguished that from the transaction that records the weight transfer. The most
interesting property of the design read as an implementation detail.

## Decision

A transcript at the foot of the page. Collapsed to one line by default, since the page is
about governance rather than plumbing, and still showing the latest step so it is worth
reading closed. Open it and every step is there: the action, how it reached the chain, who
acted, the contract and function with its arguments, the gas and the cost in tTRUST, and a
link to the explorer that appears the moment there is a hash to link to.

Four kinds, because the distinction is the lesson: `signature` costs nothing and touches
nothing, `userop` is the self-bundled ERC-4337 path, `tx` is a plain transaction from an
EOA, `local` never leaves the browser.

**Each step is described by the action that performs it, not decoded back out of its
calldata.** The action already knows it is redeeming two chains to reach `castVoteFor`;
recovering that from a nested `redeemDelegations` blob would be a lot of work to arrive
back where we started, and would drift silently the first time an encoder changed.

**A redemption names the signature it is spending.** This is the sharpest thing the log
does and it was missing at first. "B votes, carrying A" is true and says nothing: not which
signature is being spent, nor who made it, nor what scope they fixed into it. The row reads
*"B redeems the delegation A signed, and votes with it in A's name"*, and expands to the
chain link by link in the order the DelegationManager walks it — each link naming the
delegation it guards, the scope signed into its terms, and the witness supplied, as domain
labels rather than term ids.

The delegation hash is the join. It is printed under the same key when the delegation is
signed, so the two rows can be matched by eye: this object, signed then and sent nowhere, is
the one touching the chain now. That is the demonstration this repository exists to make,
and it was previously something a reader had to be told rather than shown. `bun run
acceptance` asserts it rather than leaving it to be admired: every hash the redemption row
names has to be one of the signatures made in that run.

The module is free of React and of the DOM, so the CLI scripts that import the same actions
read the same log — which is how `bun run acceptance` prints its own transcript.

## Consequences

The wait during session setup (ADR 0023) stopped being dead time and became the clearest
explanation of the stack the demo has to offer.

A failed step says why, in the same place, which is what made adding OZ's errors to the
revert decoder worth doing.

The log is capped at 200 steps and cleared by a button that says what it does not do:
nothing on chain is undone, which is rather the point of it being on chain.

It is not a substitute for a block explorer and does not try to be. Every row links out.
