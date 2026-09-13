import { Card, CardState, StateMap } from "./types";
import { initialState } from "./scheduler";

// Identity lives in the hash, NOT the path. Rename/move are therefore free:
// a moved card re-links by hash on the next parse. Path is mutable metadata.

export interface ReconcileResult {
  states: StateMap; // the new store after reconciling this note
  fresh: string[]; // hashes newly created (default scheduling)
  kept: string[]; // hashes carried over unchanged
  orphaned: string[]; // hashes removed from THIS note (edited/deleted -> reset)
}

/**
 * Reconcile the freshly parsed cards of ONE note against the store.
 *  - hash present in store  -> keep state, refresh notePath (handles rename)
 *  - hash new               -> create default state
 *  - state claims this note but hash is gone -> orphan (delete = the "reset")
 *
 * Orphan detection is scoped to states whose notePath == this note, so that a
 * rename never looks like a deletion.
 */
export function reconcileNote(
  parsed: Card[],
  store: StateMap,
  notePath: string,
  now = new Date(),
): ReconcileResult {
  const next: StateMap = { ...store };
  const fresh: string[] = [];
  const kept: string[] = [];
  const parsedHashes = new Set(parsed.map((c) => c.hash));

  for (const card of parsed) {
    const existing = next[card.hash];
    if (existing) {
      next[card.hash] = { ...existing, notePath }; // re-link on rename/move
      kept.push(card.hash);
    } else {
      next[card.hash] = initialState(card.hash, notePath, now);
      fresh.push(card.hash);
    }
  }

  const orphaned: string[] = [];
  for (const state of Object.values(store)) {
    if (state.notePath === notePath && !parsedHashes.has(state.hash)) {
      delete next[state.hash]; // hard delete: "sicher ist sicher"
      orphaned.push(state.hash);
    }
  }

  return { states: next, fresh, kept, orphaned };
}

/**
 * Cleanup for states left behind by fully deleted notes (never re-parsed).
 * Pass every hash that still exists anywhere in the vault; the rest are purged.
 * Intended to run on plugin load / via a manual command, not per keystroke.
 */
export function sweepOrphans(store: StateMap, liveHashes: Set<string>): {
  states: StateMap;
  purged: string[];
} {
  const next: StateMap = {};
  const purged: string[] = [];
  for (const [hash, state] of Object.entries(store)) {
    if (liveHashes.has(hash)) next[hash] = state;
    else purged.push(hash);
  }
  return { states: next, purged };
}

/** Non-load-bearing convenience: keep notePath fresh on a rename event. */
export function renameNotePath(store: StateMap, oldPath: string, newPath: string): StateMap {
  const next: StateMap = {};
  for (const [hash, state] of Object.entries(store)) {
    next[hash] = state.notePath === oldPath ? { ...state, notePath: newPath } : state;
  }
  return next;
}

export function dueCards(store: StateMap, now = new Date()): CardState[] {
  return Object.values(store)
    .filter((s) => new Date(s.due).getTime() <= now.getTime())
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
}

/** Randomize order WITHIN each calendar day of `due` (UTC), while keeping
 *  earlier days strictly before later days -- so cards overdue since an
 *  earlier day still surface before today's, but cards that became due
 *  together (e.g. reviewed in the same past sitting) don't repeat in the
 *  exact same order every session. Never mutates the input; `rng` is
 *  injectable for deterministic tests, defaulting to Math.random. */
export function shuffleDueCards(cards: CardState[], rng: () => number = Math.random): CardState[] {
  const buckets = new Map<string, CardState[]>();
  for (const card of cards) {
    const day = card.due.slice(0, 10);
    const bucket = buckets.get(day);
    if (bucket) bucket.push(card);
    else buckets.set(day, [card]);
  }

  const result: CardState[] = [];
  for (const day of Array.from(buckets.keys()).sort()) {
    const bucket = buckets.get(day)!;
    for (let i = bucket.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
    }
    result.push(...bucket);
  }
  return result;
}

/** Pick whichever of two CardStates for the same hash represents more
 *  progress: more reviewLog entries wins (a review always appends exactly
 *  one, so it's a clean monotonic signal); tied -> later lastReviewed wins
 *  (null treated as -Infinity); still tied -> later due wins; still tied
 *  (unreachable in practice -- due/lastReviewed are derived from the same
 *  schedule() call that appended the reviewLog entry) -> incoming, arbitrary
 *  but deterministic. */
function moreAdvanced(local: CardState, incoming: CardState): CardState {
  if (local.reviewLog.length !== incoming.reviewLog.length) {
    return local.reviewLog.length > incoming.reviewLog.length ? local : incoming;
  }
  const localReviewed = local.lastReviewed ? new Date(local.lastReviewed).getTime() : -Infinity;
  const incomingReviewed = incoming.lastReviewed
    ? new Date(incoming.lastReviewed).getTime()
    : -Infinity;
  if (localReviewed !== incomingReviewed) {
    return localReviewed > incomingReviewed ? local : incoming;
  }
  const localDue = new Date(local.due).getTime();
  const incomingDue = new Date(incoming.due).getTime();
  if (localDue !== incomingDue) return localDue > incomingDue ? local : incoming;
  return incoming;
}

/**
 * Reconcile two independently-evolved copies of the store -- e.g. this
 * device's in-memory state vs. a data.json just synced in from another
 * device (see main.ts onExternalSettingsChange()). A hash present on only
 * one side passes through unchanged; a hash present on both keeps whichever
 * CardState is more advanced (see moreAdvanced()), so a synced-in file can
 * never silently erase progress made locally since the last save.
 */
export function mergeStates(local: StateMap, incoming: StateMap): StateMap {
  const next: StateMap = { ...local };
  for (const [hash, incomingState] of Object.entries(incoming)) {
    const localState = next[hash];
    next[hash] = localState ? moreAdvanced(localState, incomingState) : incomingState;
  }
  return next;
}
