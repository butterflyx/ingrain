import { describe, it, expect } from "vitest";
import { lastReviewedAt, shouldShowReminder } from "../reminder";
import { CardState, StateMap } from "../types";

const now = new Date("2026-07-13T00:00:00Z");
const DAY = 86_400_000;

/** ISO timestamp `n` days before `now`. Negative `n` -> a future timestamp,
 *  handy for building a not-yet-due CardState with the same helper. */
function daysAgo(n: number): string {
  return new Date(now.getTime() - n * DAY).toISOString();
}

function state(hash: string, opts: Partial<CardState> = {}): CardState {
  return {
    hash,
    notePath: "n.md",
    ease: 2.5,
    interval: 1,
    reps: 1,
    lapses: 0,
    due: now.toISOString(), // due by default
    created: now.toISOString(),
    lastReviewed: null,
    reviewLog: [],
    ...opts,
  };
}

describe("lastReviewedAt", () => {
  it("returns null for an empty store", () => {
    expect(lastReviewedAt({})).toBeNull();
  });

  it("returns the most recent lastReviewed across all states", () => {
    const states: StateMap = {
      a: state("a", { lastReviewed: daysAgo(5) }),
      b: state("b", { lastReviewed: daysAgo(1) }),
      c: state("c", { lastReviewed: daysAgo(3) }),
    };
    expect(lastReviewedAt(states)?.toISOString()).toBe(daysAgo(1));
  });

  it("ignores states that have never been reviewed", () => {
    const states: StateMap = {
      a: state("a", { lastReviewed: null }),
      b: state("b", { lastReviewed: daysAgo(2) }),
    };
    expect(lastReviewedAt(states)?.toISOString()).toBe(daysAgo(2));
  });
});

describe("shouldShowReminder", () => {
  it("false when the interval is 0 (disabled)", () => {
    const states: StateMap = { a: state("a") };
    expect(shouldShowReminder(states, 0, null, now)).toBe(false);
  });

  it("false when there are no due cards", () => {
    const states: StateMap = { a: state("a", { due: daysAgo(-10) }) }; // future
    expect(shouldShowReminder(states, 3, null, now)).toBe(false);
  });

  it("true when never reviewed and cards are due", () => {
    const states: StateMap = { a: state("a", { lastReviewed: null }) };
    expect(shouldShowReminder(states, 3, null, now)).toBe(true);
  });

  it("false when reviewed more recently than the interval", () => {
    const states: StateMap = { a: state("a", { lastReviewed: daysAgo(1) }) };
    expect(shouldShowReminder(states, 3, null, now)).toBe(false);
  });

  it("true when last review is older than the interval", () => {
    const states: StateMap = { a: state("a", { lastReviewed: daysAgo(5) }) };
    expect(shouldShowReminder(states, 3, null, now)).toBe(true);
  });

  it("false when the reminder was already shown less than a day ago (throttle)", () => {
    const states: StateMap = { a: state("a", { lastReviewed: daysAgo(5) }) };
    expect(shouldShowReminder(states, 3, daysAgo(0.5), now)).toBe(false);
  });

  it("true again once the throttle window has passed", () => {
    const states: StateMap = { a: state("a", { lastReviewed: daysAgo(5) }) };
    expect(shouldShowReminder(states, 3, daysAgo(2), now)).toBe(true);
  });
});
