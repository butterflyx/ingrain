import { describe, it, expect } from "vitest";
import { reconcileNote, sweepOrphans, renameNotePath } from "../reconcile";
import { Card, StateMap } from "../types";

function card(hash: string, notePath: string): Card {
  return {
    hash,
    notePath,
    deck: "flashcards",
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
