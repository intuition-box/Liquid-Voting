# 0025 — The interface hands over the whole vote

**Status:** Accepted
**Date:** 2026-10-14
**Amends:** [ADR 0019](0019-weight-is-lent-in-parts.md)
**Triggered by:** user request — delegate the vote, not a part of it, because it is simpler.

## Context

ADR 0019 made a lending an amount rather than an address, so a lender could hand over part
of a balance and keep the rest. The interface exposed it as a slider beside the delegate
picker.

In front of an audience it cost more than it bought. The demo's claim is about *scope* —
which domains a delegation reaches, and how a graph decides that — and a second dial asking
*how much* invited the question "why 73?", which has no interesting answer. Every number the
slider could produce needed explaining, and none of them illustrated anything the graph
does.

## Decision

The interface hands over the whole of an account's weight on a domain. The slider is gone,
along with the two-branch outcome message and the header's lending readout.

**The contract keeps the capability.** `delegateWeight` still takes an amount,
`lendingOf` still reports it, and `_keptBy` still subtracts it, because the arithmetic is
sound, it is tested, and ADR 0019's reasoning about real delegation has not stopped being
true. What changed is what the demo chooses to show.

It also still matters on the inside. The ledger of ADR 0020 counts weight rather than
raising a flag precisely because a lending *can* be partial: a boolean would silence a
lender who handed over a quarter and had the rest to cast. Removing the slider did not
remove that case; it removed the only way to reach it from the UI.

The removed interface is kept on `keep/partial-delegation-slider`, at `fae0c9c`, so it can
come back without being rebuilt from the diff.

## Consequences

One fewer control, and the handover panel now reads as one decision instead of two.

A reader of ADR 0019 should know it describes a contract capability the interface does not
expose, which is what this note is for.

If partial lending comes back, the slider is a branch away and the contract needs nothing.
