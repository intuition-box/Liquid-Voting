# 0028 — The interface is a system, not a pile of rules

**Status:** Accepted
**Date:** 2026-10-14
**Triggered by:** user request — simpler and more playful, keeping every function and
without touching the domain tree.

## Context

Three agents measured the app before anything was changed, which is the only reason this
is a decision rather than a redecoration. What they found was not ugliness. It was a set
of rules that had each been reasonable when written and had stopped adding up.

**The type scale had fifteen steps and eleven of them sat within a pixel of a
neighbour** — an unbroken chain from 10px to 16px in half-pixel increments. The
half-pixel sizes carried 28% of the app's text, and half-pixels round differently per
engine, so roughly a quarter of the type never rendered at the size it was authored at.
The clearest tell was a definition term at 11.5px beside its own value at 12px, in the
same grid row: invisible as hierarchy, destructive to a shared baseline.

**The 4px scale was bypassed 47 times out of 65**, beneath a comment saying "never an
ad-hoc number". Fifteen of those were exact token values typed as literals, which is the
dangerous kind: they look conformant and would not move if the scale were ever retuned.
`margin-top: 48px` sat next to `padding-top: 20px` in one rule — one a token written out,
the other not a token at all.

**Three places were tighter inside than between.** The log's argument rows had a 1px row
gap against a 12px column gap; 1px is six per cent of a line box, which is no gap. The
identity cards' facts had 2px inside a card whose own rhythm is 12px. The flow steps had
2px between two lines of one step and 8px between separate steps — proximity reading
backwards, the parts looking less related than the wholes.

**One gold did six jobs.** Current tab, primary button, focus ring, progress fill,
in-flight transaction and warning were all `--accent`, so "you are here", "do this",
"working", "selected" and "careful" were one colour.

**And `--role-c` was `#57c98a`, the same hex as `--ok`.** An actor's name, a passing
status and an open proposal rendered identically, and no amount of context told them
apart.

## Decision

**Seven type steps**, named, with no font-size literal left anywhere. Each old size went
to the nearest step that preserved its rank against the sizes it shares a component with.
The half-pixels are gone entirely.

**The spacing scale gained the two steps it was missing** — 2px, because badge rows and
two-column fact grids need something between a hairline and a full step, and 64px,
because there was nothing between 32 and 48 and so everything large landed on 48, one
token carrying four unrelated relationships. Sixty-five literals became fifteen, ten of
which are badge and hairline padding a 4px minimum would ruin. The six that remain are
further than a half-step from any token: moving them is a visible change and belongs in a
pass that can be looked at in a browser rather than reasoned about.

**Two meanings came out of the accent.** `--caution` for a condition short of a failure,
which had been reading as "selected" — nearly its opposite. `--focus`, same value today,
named because it answers to accessibility rather than to brand and the two should be able
to move independently.

**In-flight work is told apart by movement, not hue.** The pending dot pulses. A temporal
state is better shown temporally than by inventing a colour that then has to be learnt,
and it stills itself for anyone who asks for reduced motion.

**C is violet.** The three actors now sit clear of both verdict colours. All six stay
above 6.4:1 on the page background.

**Errors go to the transaction log.** A failed chain read was a banner carrying the public
RPC's full complaint — method, entire call arguments, contract, docs link, viem version —
several hundred characters pushing the interface down to say something a reader cannot
act on. Moving them out of the way would have moved them out of sight, so the log opens
itself when the failure count rises.

**The navigation stays on screen.** It was the only thing saying which of the sections you
were in, and the only one of the three persistent surfaces that scrolled away while the
domain rail and the log stayed pinned. Its active marker went from 1px to 2px, because
every separator in the file is a 1px hairline including the bar's own rule sixteen pixels
below — "you are here" and "section ends" drawn with one stroke.

**The three identities became one component.** They had been described three times over:
a toggle saying who you were, a token readout saying what they held, and a strip listing
their addresses. One card each now, carrying everything true of that account at once.

**And the page reads in the order you use it**: header, navigation, the controls, then
the work. The masthead had been wedged between the nav and the cards, 190 pixels of
paragraph between the thing that says where you are and the thing you act on.

## Consequences

Roughly 150 lines of dead CSS went, including an entire superseded nav bar whose metrics
record every measure of presence being reduced on the way to the current one — smaller
type, no padding, a halved indicator, and the old rules never deleted.

The domain tree was not touched, as asked.

"Playful" is three things and none of them is an adjective: the pending dot pulses, a
handover draws an arc from giver to receiver across the cards for the few seconds after
it confirms, and a proposal names its voters on the row. Each animates or surfaces
something that was already happening and had no representation.

What this does not cover: none of it was seen in a browser. Every measurement here came
from the stylesheet and every judgement from arithmetic. Proportions are the one thing
that cannot be audited this way, and they are the first thing to check.
