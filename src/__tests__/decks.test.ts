import { describe, it, expect } from "vitest";
import { buildDeckTree, filterByDeck, siblingHashesOf } from "../decks";
import { initialState, schedule } from "../scheduler";
import { Card, Rating, StateMap } from "../types";

const now = new Date("2026-07-13T00:00:00Z");

function card(hash: string, decks: string[], extra: Partial<Card> = {}): Card {
  return {
    hash,
    notePath: "n.md",
    deck: decks[0],
    decks,
    kind: "basic",
    front: "f",
    back: "b",
    reverse: false,
    sourceBlock: "src",
    context: "note",
    ...extra,
  };
}

function dueState(hash: string) {
  return initialState(hash, "n.md", now); // due immediately, no reviewLog -> "new"
}

function notDueState(hash: string) {
  return { ...initialState(hash, "n.md", now), due: new Date("2099-01-01").toISOString() };
}

/** A due card that HAS been reviewed before, with `rating` as its most
 *  recent review. schedule() always pushes `due` into the future, so it's
 *  forced back to `now` here -- only the reviewLog entry (and thus the
 *  rating classification) matters for these tests. */
function ratedDueState(hash: string, rating: Rating) {
  const scheduled = schedule(initialState(hash, "n.md", now), rating, now);
  return { ...scheduled, due: now.toISOString() };
}

describe("buildDeckTree", () => {
  it("returns an empty array when there are no cards at all", () => {
    expect(buildDeckTree({}, {}, now)).toEqual([]);
  });

  it("builds a nested path from a single due card", () => {
    const states: StateMap = { a: dueState("a") };
    const cardsByHash = { a: card("a", ["flashcards/spanish/verbs"]) };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ path: "flashcards", name: "flashcards", dueCount: 1, totalCount: 1 });
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0]).toMatchObject({ path: "flashcards/spanish", dueCount: 1, totalCount: 1 });
    expect(tree[0].children[0].children[0]).toMatchObject({
      path: "flashcards/spanish/verbs",
      name: "verbs",
      dueCount: 1,
      totalCount: 1,
    });
  });

  it("two cards under different top-level decks produce two root nodes", () => {
    const states: StateMap = { a: dueState("a"), b: dueState("b") };
    const cardsByHash = { a: card("a", ["flashcards/spanish"]), b: card("b", ["work/todo"]) };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree.map((n) => n.path)).toEqual(["flashcards", "work"]);
    expect(tree[0].dueCount).toBe(1);
    expect(tree[1].dueCount).toBe(1);
  });

  it("a card belonging to two decks under the same root is counted once at the root", () => {
    const states: StateMap = { a: dueState("a") };
    const cardsByHash = { a: card("a", ["flashcards/a", "flashcards/b"]) };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree).toHaveLength(1);
    expect(tree[0].dueCount).toBe(1); // NOT 2 -- same card, deduped
    expect(tree[0].totalCount).toBe(1); // same dedup applies to totalCount
    const [nodeA, nodeB] = tree[0].children;
    expect(nodeA).toMatchObject({ path: "flashcards/a", dueCount: 1, totalCount: 1 });
    expect(nodeB).toMatchObject({ path: "flashcards/b", dueCount: 1, totalCount: 1 });
  });

  it("children are sorted alphabetically", () => {
    const states: StateMap = { a: dueState("a"), b: dueState("b") };
    const cardsByHash = {
      a: card("a", ["flashcards/zebra"]),
      b: card("b", ["flashcards/apple"]),
    };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree[0].children.map((n) => n.name)).toEqual(["apple", "zebra"]);
  });

  it("a deck with cards but none currently due still appears, with dueCount 0", () => {
    const states: StateMap = { a: notDueState("a") };
    const cardsByHash = { a: card("a", ["flashcards/spanish"]) };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ path: "flashcards", dueCount: 0, totalCount: 1 });
  });

  it("totalCount reflects all cards, dueCount only the due subset, within one deck", () => {
    const states: StateMap = { a: dueState("a"), b: notDueState("b") };
    const cardsByHash = {
      a: card("a", ["flashcards/spanish"]),
      b: card("b", ["flashcards/spanish"]),
    };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree[0]).toMatchObject({ dueCount: 1, totalCount: 2 });
  });

  it("a due card with an empty reviewLog is classified as new", () => {
    const states: StateMap = { a: dueState("a") };
    const cardsByHash = { a: card("a", ["flashcards/spanish"]) };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree[0].dueByRating).toEqual({ new: 1, again: 0, hard: 0, good: 0, easy: 0 });
  });

  it("a due card's most recent rating determines its category", () => {
    const states: StateMap = {
      a: ratedDueState("a", 1),
      b: ratedDueState("b", 2),
      c: ratedDueState("c", 3),
      d: ratedDueState("d", 4),
    };
    const cardsByHash = {
      a: card("a", ["flashcards/x"]),
      b: card("b", ["flashcards/x"]),
      c: card("c", ["flashcards/x"]),
      d: card("d", ["flashcards/x"]),
    };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree[0].dueByRating).toEqual({ new: 0, again: 1, hard: 1, good: 1, easy: 1 });
  });

  it("a multi-deck card's rating is counted once at a shared ancestor", () => {
    const states: StateMap = { a: ratedDueState("a", 4) };
    const cardsByHash = { a: card("a", ["flashcards/a", "flashcards/b"]) };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree[0].dueByRating).toEqual({ new: 0, again: 0, hard: 0, good: 0, easy: 1 }); // root, deduped
    const [nodeA, nodeB] = tree[0].children;
    expect(nodeA.dueByRating.easy).toBe(1);
    expect(nodeB.dueByRating.easy).toBe(1);
  });

  it("a not-due card is excluded from dueByRating even though it would be new", () => {
    const states: StateMap = { a: notDueState("a") };
    const cardsByHash = { a: card("a", ["flashcards/spanish"]) };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree[0].dueByRating).toEqual({ new: 0, again: 0, hard: 0, good: 0, easy: 0 });
  });

  it("a cloze sibling group of 3 due cards counts as ONE learning unit", () => {
    const states: StateMap = { a: dueState("a"), b: dueState("b"), c: dueState("c") };
    const cardsByHash = {
      a: card("a", ["flashcards/x"], { kind: "cloze", siblingGroup: "g1" }),
      b: card("b", ["flashcards/x"], { kind: "cloze", siblingGroup: "g1" }),
      c: card("c", ["flashcards/x"], { kind: "cloze", siblingGroup: "g1" }),
    };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree[0]).toMatchObject({ dueCount: 1, totalCount: 1 });
    expect(tree[0].dueByRating).toEqual({ new: 1, again: 0, hard: 0, good: 0, easy: 0 });
  });

  it("a reverse Q&A pair, both due, counts as ONE learning unit", () => {
    const states: StateMap = { front: dueState("front"), back: dueState("back") };
    const cardsByHash = {
      front: card("front", ["flashcards/x"], { reverseOf: "back" }),
      back: card("back", ["flashcards/x"], { reverseOf: "front" }),
    };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree[0]).toMatchObject({ dueCount: 1, totalCount: 1 });
  });

  it("solo cards plus one sibling group add up correctly", () => {
    const states: StateMap = {
      a: dueState("a"),
      b: dueState("b"),
      c: dueState("c"),
      d: dueState("d"),
      e: dueState("e"),
    };
    const cardsByHash = {
      a: card("a", ["flashcards/x"]),
      b: card("b", ["flashcards/x"]),
      c: card("c", ["flashcards/x"], { kind: "cloze", siblingGroup: "g1" }),
      d: card("d", ["flashcards/x"], { kind: "cloze", siblingGroup: "g1" }),
      e: card("e", ["flashcards/x"], { kind: "cloze", siblingGroup: "g1" }),
    };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree[0]).toMatchObject({ dueCount: 3, totalCount: 3 }); // a, b, {c,d,e}
  });
});

describe("filterByDeck", () => {
  const states: StateMap = { a: dueState("a"), b: dueState("b"), c: dueState("c") };
  const cardsByHash = {
    a: card("a", ["flashcards/spanish"]),
    b: card("b", ["flashcards/spanish/verbs"]),
    c: card("c", ["flashcards/biology"]),
  };
  const due = Object.values(states);

  it("undefined deckPath returns the list unchanged", () => {
    expect(filterByDeck(due, cardsByHash, undefined)).toHaveLength(3);
  });

  it("includes exact matches and subdecks, excludes unrelated decks", () => {
    const result = filterByDeck(due, cardsByHash, "flashcards/spanish");
    expect(result.map((s) => s.hash).sort()).toEqual(["a", "b"]);
  });

  it("a multi-deck card is included if any of its decks matches", () => {
    const multi = { ...states, a: dueState("a") };
    const multiCards = { ...cardsByHash, a: card("a", ["flashcards/biology", "flashcards/spanish"]) };
    const result = filterByDeck(Object.values(multi), multiCards, "flashcards/spanish");
    expect(result.map((s) => s.hash)).toContain("a");
  });
});

describe("siblingHashesOf", () => {
  it("returns [reverseOf] for a reverse-pair card", () => {
    const front = card("front", ["flashcards"], { reverseOf: "back" });
    const back = card("back", ["flashcards"], { reverseOf: "front" });
    const cardsByHash = { front, back };
    expect(siblingHashesOf(front, cardsByHash)).toEqual(["back"]);
  });

  it("returns every other hash sharing the same siblingGroup + notePath for a cloze card", () => {
    const cardsByHash = {
      c1: card("c1", ["flashcards"], { kind: "cloze", siblingGroup: "g1" }),
      c2: card("c2", ["flashcards"], { kind: "cloze", siblingGroup: "g1" }),
      c3: card("c3", ["flashcards"], { kind: "cloze", siblingGroup: "g1" }),
      unrelated: card("unrelated", ["flashcards"], { kind: "cloze", siblingGroup: "g2" }),
    };
    const result = siblingHashesOf(cardsByHash.c1, cardsByHash);
    expect(result.sort()).toEqual(["c2", "c3"]);
  });

  it("returns [] for a card with neither reverseOf nor siblingGroup", () => {
    const plain = card("plain", ["flashcards"]);
    expect(siblingHashesOf(plain, { plain })).toEqual([]);
  });

  it("does not cross notePath boundaries for cloze siblings", () => {
    const cardsByHash = {
      c1: card("c1", ["flashcards"], { kind: "cloze", siblingGroup: "g1", notePath: "a.md" }),
      c2: card("c2", ["flashcards"], { kind: "cloze", siblingGroup: "g1", notePath: "b.md" }),
    };
    expect(siblingHashesOf(cardsByHash.c1, cardsByHash)).toEqual([]);
  });

  it("returns [] when no other card shares the siblingGroup", () => {
    const solo = card("solo", ["flashcards"], { kind: "cloze", siblingGroup: "g1" });
    expect(siblingHashesOf(solo, { solo })).toEqual([]);
  });
});
