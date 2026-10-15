/**
 * Two small functions that each fixed a visible problem, and would be easy to break back.
 */
import { describe, expect, test } from "bun:test";

import { deepestVoice, readDescription, type RedeemedVoice } from "./voting";
import type { Delegation } from "../delegation/encoding";

describe("readDescription", () => {
  test("takes the timestamp off a title and hands it back separately", () => {
    const read = readDescription("Decide the next step for micro-grants (2026-10-14T13:58)");
    expect(read.title).toBe("Decide the next step for micro-grants");
    expect(read.recordedAt).toBe("2026-10-14T13:58");
  });

  test("leaves a description that was never stamped alone", () => {
    const read = readDescription("Fund the Q3 identity refresh");
    expect(read.title).toBe("Fund the Q3 identity refresh");
    expect(read.recordedAt).toBeNull();
  });

  test("does not mistake an ordinary parenthesis for a stamp", () => {
    const read = readDescription("Fund the refresh (phase two)");
    expect(read.title).toBe("Fund the refresh (phase two)");
    expect(read.recordedAt).toBeNull();
  });
});

/** Only the length matters here, so the links need no contents. */
function voice(links: number): RedeemedVoice {
  const link = {} as Delegation & { hash: `0x${string}` };
  return { chain: Array.from({ length: links }, () => link), witnesses: [] };
}

describe("deepestVoice", () => {
  test("nothing to redeem is not an error", () => {
    expect(deepestVoice([])).toBeNull();
  });

  test("picks the longest lineage, so the most signatures get walked", () => {
    const own = voice(1);
    const relayed = voice(2);
    expect(deepestVoice([own, relayed])).toBe(relayed);
    expect(deepestVoice([relayed, own])).toBe(relayed);
  });

  test("keeps the first of equals rather than drifting with argument order", () => {
    const first = voice(2);
    const second = voice(2);
    expect(deepestVoice([first, second])).toBe(first);
  });
});
