import { CardState, Rating } from "./types";
import { schedule } from "./scheduler";

// Pure review-session state machine. No "obsidian" import — the Modal (M3)
// is DOM-wiring glue in main.ts that delegates every state transition here,
// since the live review UI itself can't be exercised by vitest.

/**
 * A review session is a fixed, ordered snapshot of due CardStates taken at
 * session start (e.g. via dueCards()). Nothing here refreshes or re-sorts
 * the queue mid-session — a card rated "Again" is not requeued within the
 * same session; it simply becomes due again per schedule()'s interval.
 */
export interface ReviewSessionState {
  readonly queue: readonly CardState[];
  readonly index: number;
  readonly revealed: boolean;
}

export interface SessionProgress {
  reviewed: number;
  remaining: number;
  total: number;
}

export interface RateResult {
  session: ReviewSessionState;
  updatedState: CardState;
}

export function startSession(due: readonly CardState[]): ReviewSessionState {
  return { queue: [...due], index: 0, revealed: false };
}

export function currentCard(session: ReviewSessionState): CardState | null {
  return session.index < session.queue.length ? session.queue[session.index] : null;
}

export function isComplete(session: ReviewSessionState): boolean {
  return session.index >= session.queue.length;
}

export function sessionProgress(session: ReviewSessionState): SessionProgress {
  return {
    reviewed: session.index,
    remaining: session.queue.length - session.index,
    total: session.queue.length,
  };
}

export function canReveal(session: ReviewSessionState): boolean {
  return !isComplete(session) && !session.revealed;
}

export function canRate(session: ReviewSessionState): boolean {
  return !isComplete(session) && session.revealed;
}

/** No-op (returns the same session) if already revealed or complete. */
export function reveal(session: ReviewSessionState): ReviewSessionState {
  if (!canReveal(session)) return session;
  return { ...session, revealed: true };
}

/**
 * Rate the current card: schedules it and advances to the next.
 * Throws if !canRate(session) — a caller/programmer-error guard. The Modal
 * only wires rating buttons/keys once canRate() is true, so this should be
 * unreachable through normal UI interaction.
 *
 * `siblingHashes`, if given, are the hashes of this card's scheduling
 * siblings (see types.ts Card.reverseOf / Card.siblingGroup, decks.ts
 * siblingHashesOf()) -- a reverse-pair's other side, or the other cloze
 * cards from the same source block. Their due dates were just pushed into
 * the future by the caller (main.ts recordReview -> scheduler.ts
 * coordinateSiblingsDue()), but that only updates the persisted store, not
 * this already-snapshotted session queue -- so without this, any sibling
 * that was due at session start would still get presented later in the
 * SAME session. Dropping every remaining occurrence of them here keeps the
 * session in sync with that store update. Entries at or before the current
 * index are left alone -- only genuinely upcoming occurrences are removed.
 */
export function rate(
  session: ReviewSessionState,
  rating: Rating,
  now = new Date(),
  siblingHashes: readonly string[] = [],
): RateResult {
  if (!canRate(session)) {
    throw new Error(
      "Ingrain: cannot rate before revealing the answer, or after the session is complete.",
    );
  }
  const state = session.queue[session.index];
  const updatedState = schedule(state, rating, now);
  const queue = siblingHashes.length
    ? session.queue.filter((s, i) => i <= session.index || !siblingHashes.includes(s.hash))
    : session.queue;
  const next: ReviewSessionState = { ...session, queue, index: session.index + 1, revealed: false };
  return { session: next, updatedState };
}
