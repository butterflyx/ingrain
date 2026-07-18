import { describe, it, expect } from "vitest";
import { buildDeckTree, filterByDeck } from "../decks";
import { initialState } from "../scheduler";
import { Card, StateMap } from "../types";

const now = new Date("2026-07-13T00:00:00Z");

function card(hash: string, decks: string[]): Card {
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
  };
}

function dueState(hash: string) {
  return initialState(hash, "n.md", now); // due immediately
}

describe("buildDeckTree", () => {
  it("returns an empty array when nothing is due", () => {
    expect(buildDeckTree({}, {}, now)).toEqual([]);
  });

  it("builds a nested path from a single due card", () => {
    const states: StateMap = { a: dueState("a") };
    const cardsByHash = { a: card("a", ["flashcards/spanish/verbs"]) };
    const tree = buildDeckTree(states, cardsByHash, now);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ path: "flashcards", name: "flashcards", dueCount: 1 });
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0]).toMatchObject({ path: "flashcards/spanish", dueCount: 1 });
    expect(tree[0].children[0].children[0]).toMatchObject({
      path: "flashcards/spanish/verbs",
      name: "verbs",
      dueCount: 1,
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
    const [nodeA, nodeB] = tree[0].children;
    expect(nodeA).toMatchObject({ path: "flashcards/a", dueCount: 1 });
    expect(nodeB).toMatchObject({ path: "flashcards/b", dueCount: 1 });
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

  it("ignores states that aren't due yet", () => {
    const notDue = { ...dueState("a"), due: new Date("2099-01-01").toISOString() };
    const states: StateMap = { a: notDue };
    const cardsByHash = { a: card("a", ["flashcards/spanish"]) };
    expect(buildDeckTree(states, cardsByHash, now)).toEqual([]);
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
