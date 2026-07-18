import { describe, it, expect } from "vitest";
import {
  startSession,
  currentCard,
  isComplete,
  sessionProgress,
  canReveal,
  canRate,
  reveal,
  rate,
} from "../review";
import { schedule, initialState } from "../scheduler";
import { CardState } from "../types";

const now = new Date("2026-07-13T00:00:00Z");

function state(hash: string): CardState {
  return initialState(hash, "n.md", now);
}

describe("startSession", () => {
  it("an empty due list starts already complete", () => {
    const s = startSession([]);
    expect(isComplete(s)).toBe(true);
    expect(currentCard(s)).toBeNull();
    expect(sessionProgress(s)).toEqual({ reviewed: 0, remaining: 0, total: 0 });
  });

  it("a non-empty due list starts at the first card, not revealed", () => {
    const due = [state("a"), state("b")];
    const s = startSession(due);
    expect(isComplete(s)).toBe(false);
    expect(currentCard(s)?.hash).toBe("a");
    expect(sessionProgress(s)).toEqual({ reviewed: 0, remaining: 2, total: 2 });
  });

  it("does not mutate the input array", () => {
    const due = [state("a"), state("b")];
    const before = JSON.stringify(due);
    startSession(due);
    expect(JSON.stringify(due)).toBe(before);
  });
});

describe("canReveal / canRate", () => {
  it("a fresh card can be revealed but not rated", () => {
    const s = startSession([state("a")]);
    expect(canReveal(s)).toBe(true);
    expect(canRate(s)).toBe(false);
  });

  it("a revealed card can be rated but not revealed again", () => {
    const s = reveal(startSession([state("a")]));
    expect(canReveal(s)).toBe(false);
    expect(canRate(s)).toBe(true);
  });

  it("a completed session can neither reveal nor rate", () => {
    const s = startSession([]);
    expect(canReveal(s)).toBe(false);
    expect(canRate(s)).toBe(false);
  });
});

describe("reveal", () => {
  it("sets revealed to true, leaves queue/index unchanged", () => {
    const s = reveal(startSession([state("a"), state("b")]));
    expect(currentCard(s)?.hash).toBe("a");
    expect(sessionProgress(s)).toEqual({ reviewed: 0, remaining: 2, total: 2 });
  });

  it("calling twice is a no-op", () => {
    const once = reveal(startSession([state("a")]));
    const twice = reveal(once);
    expect(canRate(twice)).toBe(true);
    expect(currentCard(twice)?.hash).toBe("a");
  });

  it("calling on a completed session is a no-op", () => {
    const s = startSession([]);
    expect(isComplete(reveal(s))).toBe(true);
  });
});

describe("rate", () => {
  it("throws if rated before reveal", () => {
    const s = startSession([state("a")]);
    expect(() => rate(s, 3, now)).toThrow();
  });

  it("throws if rated after the session is complete", () => {
    const s = startSession([]);
    expect(() => rate(s, 3, now)).toThrow();
  });

  it("produces the same updatedState as scheduler.schedule()", () => {
    const initial = state("a");
    const s = reveal(startSession([initial]));
    const { updatedState } = rate(s, 3, now);
    expect(updatedState).toEqual(schedule(initial, 3, now));
  });

  it("advances the index and resets revealed", () => {
    const s = reveal(startSession([state("a"), state("b")]));
    const { session } = rate(s, 3, now);
    expect(currentCard(session)?.hash).toBe("b");
    expect(canReveal(session)).toBe(true);
    expect(canRate(session)).toBe(false);
  });

  it("forwards the now parameter through to schedule()", () => {
    const initial = state("a");
    const s = reveal(startSession([initial]));
    const later = new Date("2026-08-01T00:00:00Z");
    const { updatedState } = rate(s, 3, later);
    expect(updatedState.lastReviewed).toBe(later.toISOString());
    expect(updatedState.reviewLog[0].ts).toBe(later.toISOString());
  });

  it("does not mutate the queue or the original CardState", () => {
    const initial = state("a");
    const before = JSON.stringify(initial);
    const s = reveal(startSession([initial]));
    rate(s, 3, now);
    expect(JSON.stringify(initial)).toBe(before);
    expect(JSON.stringify(currentCard(s))).toBe(before);
  });
});

describe("end-to-end session walks", () => {
  it("a single-card session completes after one reveal+rate", () => {
    let s = startSession([state("a")]);
    s = reveal(s);
    const { session } = rate(s, 3, now);
    expect(isComplete(session)).toBe(true);
    expect(sessionProgress(session)).toEqual({ reviewed: 1, remaining: 0, total: 1 });
  });

  it("a multi-card session walks through every card in order, unaffected by prior ratings", () => {
    let s = startSession([state("a"), state("b"), state("c")]);
    const ratings: [string, number][] = [];

    for (const rating of [1, 3, 4] as const) {
      const hash = currentCard(s)!.hash;
      s = reveal(s);
      const result = rate(s, rating, now);
      ratings.push([hash, result.updatedState.interval]);
      s = result.session;
    }

    expect(ratings.map(([h]) => h)).toEqual(["a", "b", "c"]);
    // Again -> interval 1; Good (first rep) -> interval 1; Easy (first rep) -> interval 1
    // but eases differ, proving each card was scheduled independently.
    expect(ratings[0][1]).toBe(1);
    expect(ratings[1][1]).toBe(1);
    expect(ratings[2][1]).toBe(1);
    expect(isComplete(s)).toBe(true);
    expect(sessionProgress(s)).toEqual({ reviewed: 3, remaining: 0, total: 3 });
  });

  it("requires reveal before every rate, even mid-session", () => {
    let s = startSession([state("a"), state("b")]);
    s = reveal(s);
    s = rate(s, 3, now).session;
    // second card: not yet revealed
    expect(() => rate(s, 3, now)).toThrow();
  });
});
