import { Card, CardState, StateMap } from "./types";
import { isDue } from "./scheduler";

// PURE: deck-tree building and deck-scoped filtering for the deck overview
// page (M5). No "obsidian" import — DecksView in main.ts is DOM-wiring
// glue that delegates counting/filtering entirely to this module.

/** Due-card counts by their most recent review rating. `new` covers cards
 *  with an empty reviewLog (never reviewed). */
export interface RatingBreakdown {
  new: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface DeckNode {
  path: string; // full path, e.g. "flashcards/spanish/verbs"
  name: string; // last segment, e.g. "verbs"
  dueCount: number; // due cards in this deck or any subdeck
  totalCount: number; // ALL cards in this deck or any subdeck, due or not
  dueByRating: RatingBreakdown; // breakdown of dueCount by last-rating category
  children: DeckNode[];
}

function addHash(map: Map<string, Set<string>>, path: string, hash: string) {
  if (!map.has(path)) map.set(path, new Set());
  map.get(path)!.add(hash);
}

/** A key shared by every card in the same scheduling-sibling set (see
 *  types.ts Card.reverseOf / Card.siblingGroup) -- a reverse Q&A pair or a
 *  cloze sibling group is a single atomic learning unit: rating any one
 *  member pushes every other member's due date out together (see
 *  decks.ts siblingHashesOf(), scheduler.ts coordinateSiblingsDue()), so
 *  only ~1 member is ever actually reviewed per cycle. Counting each raw
 *  card hash separately would overstate how much there is to learn (e.g. a
 *  13-cloze note with 3 sibling groups is really 3 learning units, not
 *  13). Falls back to the card's own hash when it has no siblings. */
function collapseKey(card: Card): string {
  if (card.reverseOf) return [card.hash, card.reverseOf].sort().join("|");
  if (card.siblingGroup !== undefined) return card.siblingGroup;
  return card.hash;
}

/** A card's rating category, for the DecksView breakdown: its most recent
 *  review rating, or "new" if it has never been reviewed. */
function classify(state: CardState): keyof RatingBreakdown {
  if (state.reviewLog.length === 0) return "new";
  const last = state.reviewLog[state.reviewLog.length - 1].rating;
  if (last === 1) return "again";
  if (last === 2) return "hard";
  if (last === 3) return "good";
  return "easy";
}

/**
 * Build the deck tree from every known card, not just due ones — a deck
 * with cards but nothing currently due should still show up (with
 * dueCount 0) rather than vanish from the overview. Counts DISTINCT
 * learning units per node for both dueCount and totalCount, not deck
 * memberships or raw card hashes — a card belonging to multiple decks (see
 * Card.decks) is counted once at a shared ancestor (e.g. the tag root),
 * and a scheduling-sibling set (reverse Q&A pair or cloze sibling group,
 * see collapseKey()) is counted once as a single unit rather than once per
 * raw card, since only ~1 of its members is ever actually reviewed per
 * cycle. The root's totalCount/dueCount match cardsByHash/dueCards() sizes
 * only when there are no sibling sets — otherwise they're intentionally
 * smaller.
 */
export function buildDeckTree(
  states: StateMap,
  cardsByHash: Record<string, Card>,
  now = new Date(),
): DeckNode[] {
  const totalByPath = new Map<string, Set<string>>();
  const dueByPath = new Map<string, Set<string>>();
  const representative = new Map<string, string>(); // collapseKey -> a hash to classify() by

  for (const card of Object.values(cardsByHash)) {
    const state = states[card.hash];
    if (!state) continue; // not yet reconciled -- defensive, shouldn't normally happen
    const due = isDue(state, now);
    const key = collapseKey(card);
    if (!representative.has(key)) representative.set(key, card.hash);
    for (const deck of card.decks) {
      const segments = deck.split("/");
      for (let i = 1; i <= segments.length; i++) {
        const path = segments.slice(0, i).join("/");
        addHash(totalByPath, path, key);
        if (due) addHash(dueByPath, path, key);
      }
    }
  }

  const nodes = new Map<string, DeckNode>();
  for (const [path, hashes] of totalByPath) {
    const segments = path.split("/");
    const dueHashes = dueByPath.get(path);
    const dueByRating: RatingBreakdown = { new: 0, again: 0, hard: 0, good: 0, easy: 0 };
    for (const key of dueHashes ?? []) dueByRating[classify(states[representative.get(key)!])]++;
    nodes.set(path, {
      path,
      name: segments[segments.length - 1],
      dueCount: dueHashes?.size ?? 0,
      totalCount: hashes.size,
      dueByRating,
      children: [],
    });
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

/** All hashes of `card`'s scheduling siblings -- other cards whose due date
 *  should be pushed out alongside `card`'s after it's rated, because
 *  reviewing it already revealed information about them: a reverse Q&A
 *  pair's other side (Card.reverseOf), or the other cloze cards produced
 *  from the same source block (Card.siblingGroup) -- revealing one cloze
 *  card's back reveals every cloze answer in that shared block. A card
 *  never has both set (calloutCards()'s cloze/qa branches are mutually
 *  exclusive), so at most one branch below ever applies. `notePath` is
 *  checked too, defense-in-depth against the accepted content-hash-collision
 *  edge case (see CLAUDE.md) spuriously merging unrelated blocks from two
 *  different notes into one sibling group. */
export function siblingHashesOf(card: Card, cardsByHash: Record<string, Card>): string[] {
  if (card.reverseOf) return [card.reverseOf];
  if (card.siblingGroup === undefined) return [];
  const siblings: string[] = [];
  for (const other of Object.values(cardsByHash)) {
    if (
      other.hash !== card.hash &&
      other.notePath === card.notePath &&
      other.siblingGroup === card.siblingGroup
    ) {
      siblings.push(other.hash);
    }
  }
  return siblings;
}
