import { describe, it, expect } from "vitest";
import { reconcileNote, sweepOrphans, renameNotePath, mergeStates, shuffleDueCards } from "../reconcile";
import { Card, CardState, StateMap } from "../types";
import { initialState, schedule } from "../scheduler";

function card(hash: string, notePath: string): Card {
  return {
    hash,
    notePath,
    deck: "flashcards",
    decks: ["flashcards"],
    kind: "basic",
    front: "f",
    back: "b",
    reverse: false,
    sourceBlock: "src",
    context: "note",
  };
}

const now = new Date("2026-07-13T00:00:00Z");

describe("reconcileNote", () => {
  it("creates fresh state for new cards", () => {
    const r = reconcileNote([card("a", "n.md")], {}, "n.md", now);
    expect(r.fresh).toEqual(["a"]);
    expect(r.states["a"].ease).toBe(2.5);
  });

  it("keeps state for unchanged cards", () => {
    const first = reconcileNote([card("a", "n.md")], {}, "n.md", now);
    const second = reconcileNote([card("a", "n.md")], first.states, "n.md", now);
    expect(second.kept).toEqual(["a"]);
    expect(second.fresh).toEqual([]);
  });

  it("edits reset: old hash orphaned, new hash fresh", () => {
    const first = reconcileNote([card("old", "n.md")], {}, "n.md", now);
    const edited = reconcileNote([card("new", "n.md")], first.states, "n.md", now);
    expect(edited.orphaned).toEqual(["old"]);
    expect(edited.fresh).toEqual(["new"]);
    expect(edited.states["old"]).toBeUndefined();
  });

  it("rename survives: same hash re-links to the new path, no reset", () => {
    const first = reconcileNote([card("a", "old.md")], {}, "old.md", now);
    // simulate a MISSED rename event: no renameNotePath call, just re-parse
    // under the new path. Identity is the hash, so it must be kept.
    const renamed = reconcileNote([card("a", "new.md")], first.states, "new.md", now);
    expect(renamed.kept).toEqual(["a"]);
    expect(renamed.orphaned).toEqual([]);
    expect(renamed.states["a"].notePath).toBe("new.md");
  });
});

describe("renameNotePath", () => {
  it("updates only matching paths", () => {
    const store: StateMap = reconcileNote([card("a", "old.md")], {}, "old.md", now).states;
    const next = renameNotePath(store, "old.md", "new.md");
    expect(next["a"].notePath).toBe("new.md");
  });
});

describe("sweepOrphans", () => {
  it("purges states whose hash no longer exists anywhere", () => {
    const store: StateMap = reconcileNote(
      [card("a", "n.md"), card("b", "n.md")],
      {},
      "n.md",
      now,
    ).states;
    const swept = sweepOrphans(store, new Set(["a"]));
    expect(swept.purged).toEqual(["b"]);
    expect(swept.states["b"]).toBeUndefined();
    expect(swept.states["a"]).toBeDefined();
  });
});

describe("mergeStates", () => {
  it("keeps a hash present only in local", () => {
    const local: StateMap = { a: initialState("a", "n.md", now) };
    expect(mergeStates(local, {})["a"]).toEqual(local["a"]);
  });

  it("keeps a hash present only in incoming", () => {
    const incoming: StateMap = { b: initialState("b", "n.md", now) };
    expect(mergeStates({}, incoming)["b"]).toEqual(incoming["b"]);
  });

  it("picks whichever side has more reviewLog entries, regardless of argument order", () => {
    const base = initialState("a", "n.md", now);
    const twice = schedule(schedule(base, 3, now), 3, now);
    const once = schedule(base, 3, now);

    const local: StateMap = { a: twice };
    const incoming: StateMap = { a: once };
    expect(mergeStates(local, incoming)["a"]).toEqual(twice);
    expect(mergeStates(incoming, local)["a"]).toEqual(twice);
  });

  it("tie-breaks equal reviewLog length by the later lastReviewed", () => {
    const a = schedule(initialState("a", "n.md", now), 3, now);
    const b = { ...a, lastReviewed: new Date("2026-07-14T00:00:00Z").toISOString() };

    expect(mergeStates({ a }, { a: b })["a"]).toEqual(b);
  });

  it("tie-breaks two never-reviewed states by the later due date", () => {
    const a = initialState("a", "n.md", now);
    const b = { ...a, due: new Date("2026-07-14T00:00:00Z").toISOString() };

    expect(mergeStates({ a }, { a: b })["a"]).toEqual(b);
  });

  it("never mutates either input", () => {
    const local: StateMap = { a: initialState("a", "n.md", now) };
    const incoming: StateMap = { a: schedule(initialState("a", "n.md", now), 3, now) };
    const localBefore = JSON.stringify(local);
    const incomingBefore = JSON.stringify(incoming);

    mergeStates(local, incoming);

    expect(JSON.stringify(local)).toBe(localBefore);
    expect(JSON.stringify(incoming)).toBe(incomingBefore);
  });

  it("returns a new object, not either input by reference", () => {
    const local: StateMap = { a: initialState("a", "n.md", now) };
    const incoming: StateMap = {};
    const result = mergeStates(local, incoming);

    expect(result).not.toBe(local);
    expect(result).not.toBe(incoming);
  });
});

function stateAt(hash: string, due: string): CardState {
  return { ...initialState(hash, "n.md", now), due };
}

const constantRng = (value: number) => () => value;

describe("shuffleDueCards", () => {
  it("keeps every earlier-day card before every later-day card, for any rng", () => {
    const dayOne = [stateAt("a", "2026-07-10T08:00:00Z"), stateAt("b", "2026-07-10T09:00:00Z")];
    const dayTwo = [stateAt("c", "2026-07-11T08:00:00Z"), stateAt("d", "2026-07-11T09:00:00Z")];
    const input = [...dayOne, ...dayTwo];

    for (const rng of [constantRng(0), constantRng(0.999999), Math.random]) {
      const result = shuffleDueCards(input, rng);
      const dayOneHashes = new Set(dayOne.map((s) => s.hash));
      const lastDayOneIndex = Math.max(...result.map((s, i) => (dayOneHashes.has(s.hash) ? i : -1)));
      const firstDayTwoIndex = Math.min(
        ...result.map((s, i) => (dayOneHashes.has(s.hash) ? Infinity : i)),
      );
      expect(lastDayOneIndex).toBeLessThan(firstDayTwoIndex);
    }
  });

  it("reorders same-day cards under a controlled rng", () => {
    const input = [
      stateAt("a", "2026-07-10T08:00:00Z"),
      stateAt("b", "2026-07-10T09:00:00Z"),
      stateAt("c", "2026-07-10T10:00:00Z"),
    ];
    const result = shuffleDueCards(input, constantRng(0));
    expect(result.map((s) => s.hash)).not.toEqual(["a", "b", "c"]);
  });

  it("produces the exact Fisher-Yates permutation for a known rng sequence", () => {
    const input = [
      stateAt("a", "2026-07-10T08:00:00Z"),
      stateAt("b", "2026-07-10T09:00:00Z"),
      stateAt("c", "2026-07-10T10:00:00Z"),
    ];
    const result = shuffleDueCards(input, constantRng(0));
    expect(result.map((s) => s.hash)).toEqual(["b", "c", "a"]);
  });

  it("never mutates the input array", () => {
    const input = [stateAt("a", "2026-07-10T08:00:00Z"), stateAt("b", "2026-07-10T09:00:00Z")];
    const before = JSON.stringify(input);

    const result = shuffleDueCards(input, constantRng(0));

    expect(JSON.stringify(input)).toBe(before);
    expect(result).not.toBe(input);
  });

  it("is a no-op for empty and singleton input", () => {
    expect(shuffleDueCards([])).toEqual([]);
    const single = [stateAt("a", "2026-07-10T08:00:00Z")];
    expect(shuffleDueCards(single, constantRng(0))).toEqual(single);
  });
});
