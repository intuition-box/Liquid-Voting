/**
 * The two states this function used to confuse, and the bug that came of it.
 *
 * "I voted here" and "my delegate voted here, for me" were one state, so an account
 * whose voice had already been spent was offered a vote the governor was always going to
 * refuse — and the refusal arrived as `GovernorAlreadyCastVote(0x…)`, which is true and
 * unhelpful. Telling them apart is the whole job.
 */
import { describe, expect, test } from "bun:test";

import { ballotFor } from "./ballots";
import type { Ballot, BallotEntry } from "./actions";
import type { Role } from "./roles";

const address = (role: Role): `0x${string}` => `0x${role.repeat(40)}` as `0x${string}`;

function entry(principal: Role, carriedBy: Role, weight: bigint): BallotEntry {
  return {
    principal,
    principalAddress: address(principal),
    carriedBy,
    carriedByAddress: address(carriedBy),
    weight,
  };
}

/** `readAllBallots` puts the voter's own share first and the carried ones after. */
function ballot(support: number, entries: BallotEntry[]): Ballot {
  return { support, entries, total: entries.reduce((sum, e) => sum + e.weight, 0n) };
}

describe("ballotFor", () => {
  test("says nothing when the account has no share of any ballot", () => {
    const ballots = [ballot(1, [entry("C", "C", 100n)])];
    expect(ballotFor(ballots, "A")).toBeNull();
    expect(ballotFor(undefined, "A")).toBeNull();
    expect(ballotFor([], "A")).toBeNull();
  });

  test("an account that voted itself reports no carrier and the whole ballot's weight", () => {
    const ballots = [ballot(1, [entry("B", "B", 100n), entry("A", "B", 100n)])];
    const mine = ballotFor(ballots, "B");
    expect(mine).not.toBeNull();
    expect(mine?.carriedBy).toBeNull();
    // The whole ballot, because B cast all of it — its own voice and the one it carried.
    expect(mine?.weight).toBe(200n);
    expect(mine?.carried).toEqual(["A"]);
    expect(mine?.support).toBe(1);
  });

  test("an account whose delegate voted for it names the carrier, not itself", () => {
    const ballots = [ballot(1, [entry("B", "B", 100n), entry("A", "B", 100n)])];
    const mine = ballotFor(ballots, "A");
    expect(mine).not.toBeNull();
    // The bug: this used to be null, so the row offered A a vote it could not cast.
    expect(mine?.carriedBy).toBe("B");
    // A's own share, not the 200 the ballot counted — the rest was somebody else's voice.
    expect(mine?.weight).toBe(100n);
    expect(mine?.carried).toEqual([]);
  });

  test("finds the account's share whichever ballot on the proposal holds it", () => {
    const ballots = [ballot(0, [entry("C", "C", 100n)]), ballot(1, [entry("B", "B", 100n), entry("A", "B", 100n)])];
    expect(ballotFor(ballots, "A")?.carriedBy).toBe("B");
    expect(ballotFor(ballots, "C")?.carriedBy).toBeNull();
    expect(ballotFor(ballots, "C")?.support).toBe(0);
  });

  test("a lender who kept nothing still appears, under whoever spent it", () => {
    // A delegated everything, so its own share is zero and no entry was written for it
    // as a voter — only as a principal on B's ballot.
    const ballots = [ballot(1, [entry("B", "B", 100n), entry("A", "B", 100n)])];
    const mine = ballotFor(ballots, "A");
    expect(mine?.carriedBy).toBe("B");
  });
});
