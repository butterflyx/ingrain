import { Card, CardState, StateMap } from "./types";
import { isDue } from "./scheduler";

// PURE: deck-tree building and deck-scoped filtering for the sidebar
// picker (M5). No "obsidian" import — the DeckPickerModal in main.ts is
// DOM-wiring glue that delegates counting/filtering entirely to this module.

export interface DeckNode {
  path: string; // full path, e.g. "flashcards/spanish/verbs"
  name: string; // last segment, e.g. "verbs"
  dueCount: number; // due cards in this deck or any subdeck
  children: DeckNode[];
}

/**
 * Build the deck tree from due states. Counts DISTINCT card hashes per
 * node, not deck memberships — a card belonging to multiple decks (see
 * Card.decks) is counted once at a shared ancestor (e.g. the tag root),
 * so that root count matches dueCards().length rather than double-counting.
 */
export function buildDeckTree(
  states: StateMap,
  cardsByHash: Record<string, Card>,
  now = new Date(),
): DeckNode[] {
  const hashesByPath = new Map<string, Set<string>>();
  for (const state of Object.values(states)) {
    if (!isDue(state, now)) continue;
    const card = cardsByHash[state.hash];
    if (!card) continue;
    for (const deck of card.decks) {
      const segments = deck.split("/");
      for (let i = 1; i <= segments.length; i++) {
        const path = segments.slice(0, i).join("/");
        if (!hashesByPath.has(path)) hashesByPath.set(path, new Set());
        hashesByPath.get(path)!.add(state.hash);
      }
    }
  }

  const nodes = new Map<string, DeckNode>();
  for (const [path, hashes] of hashesByPath) {
    const segments = path.split("/");
    nodes.set(path, { path, name: segments[segments.length - 1], dueCount: hashes.size, children: [] });
  }

  const roots: DeckNode[] = [];
  for (const [path, node] of nodes) {
    const segments = path.split("/");
    if (segments.length === 1) {
      roots.push(node);
    } else {
      const parentPath = segments.slice(0, -1).join("/");
      nodes.get(parentPath)!.children.push(node);
    }
  }

  const sortTree = (list: DeckNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of list) sortTree(n.children);
  };
  sortTree(roots);
  return roots;
}

/**
 * Reduce an already-computed due list to cards belonging to deckPath or
 * one of its subdecks (prefix match on "/"). deckPath === undefined means
 * "no filter" (review everything) -- one code path for both cases.
 */
export function filterByDeck(
  due: readonly CardState[],
  cardsByHash: Record<string, Card>,
  deckPath: string | undefined,
): CardState[] {
  if (deckPath === undefined) return [...due];
  return due.filter((state) => {
    const card = cardsByHash[state.hash];
    if (!card) return false;
    return card.decks.some((d) => d === deckPath || d.startsWith(`${deckPath}/`));
  });
}
