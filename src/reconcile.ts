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
