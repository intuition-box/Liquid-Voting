/**
 * Reading a proposal's ballots from the point of view of one account.
 *
 * Pure, and out of the component on purpose: this is where the interface got a fact
 * wrong once, and a fact worth getting wrong is a fact worth testing. The bug was that
 * "I voted here" and "my delegate voted here for me" were one state, so an account whose
 * voice had already been spent was offered a vote the governor was always going to
 * refuse.
 */
import type { Ballot } from "./actions";
import type { Role } from "./roles";

/** What is already on a proposal's ballot in the viewer's name. */
export interface OwnBallot {
  support: number;
  /** What was counted in this account's name. */
  weight: bigint;
  /** Who put it there. Null when the account cast it itself. */
  carriedBy: Role | null;
  /** The other voices it carried, when it voted itself. */
  carried: Role[];
}

/**
 * What the viewer's voice has already done on a proposal, if anything.
 *
 * Two states, not one, and conflating them is what made the interface misleading. An
 * account that voted itself is the obvious case. An account whose delegate voted for it
 * never submitted anything — so looking only for a ballot it *cast* found nothing, left
 * the buttons enabled, and let it click through to `GovernorAlreadyCastVote`. Which was
 * the right refusal, phrased as a contract error rather than as the plain fact: its voice
 * is already on this ballot, because somebody carried it there.
 *
 * Read from what the governor logged rather than from anything held locally, so a vote
 * cast in an earlier session — or from the CLI — still shows up here. And it keeps showing
 * up after the delegation is taken back: the grant is state and can be withdrawn, the
 * record of its use is history and cannot.
 */
export function ballotFor(ballots: Ballot[] | undefined, role: Role): OwnBallot | null {
  for (const ballot of ballots ?? []) {
    const mine = ballot.entries.find((entry) => entry.principal === role);
    if (!mine) continue;
    const carriedBy = mine.carriedBy === role ? null : mine.carriedBy;
    const carried =
      carriedBy === null
        ? ballot.entries
            .filter((entry) => entry.principal !== role && entry.principal !== null)
            .map((entry) => entry.principal as Role)
        : [];
    // The weight shown is this account's own share, not the whole ballot: when a delegate
    // carried it, the rest of that ballot was somebody else's voice.
    return { support: ballot.support, weight: carriedBy === null ? ballot.total : mine.weight, carriedBy, carried };
  }
  return null;
}
