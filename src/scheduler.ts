import { CardState, Rating, ReviewEntry } from "./types";

// SM-2 chosen for v1: ~50 lines, no state beyond ease/interval/reps.
// Everything goes through `schedule()` so FSRS (ts-fsrs) can slot in later
// behind the same call site without touching the store or the parser.

const MIN_EASE = 1.3;
const DAY = 86_400_000;

export function initialState(hash: string, notePath: string, now = new Date()): CardState {
  const iso = now.toISOString();
  return {
    hash,
    notePath,
    ease: 2.5,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: iso, // due immediately -> shows up as new
    created: iso,
    lastReviewed: null,
    reviewLog: [],
  };
}

/** Apply one review and return a NEW state (never mutates the input). */
export function schedule(state: CardState, rating: Rating, now = new Date()): CardState {
  let { ease, interval, reps, lapses } = state;

  if (rating === 1) {
    // Again -> lapse, relearn from a short step.
    reps = 0;
    lapses += 1;
    interval = 1;
    ease = Math.max(MIN_EASE, ease - 0.2);
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    reps += 1;

    // Ease adjustment per rating (Hard/Good/Easy).
    if (rating === 2) ease = Math.max(MIN_EASE, ease - 0.15);
    else if (rating === 4) ease = ease + 0.15;
    // rating === 3 (Good): ease unchanged.
  }

  const due = new Date(now.getTime() + interval * DAY).toISOString();
  const entry: ReviewEntry = { ts: now.toISOString(), rating, intervalAfter: interval };

  return {
    ...state,
    ease,
    interval,
    reps,
    lapses,
    due,
    lastReviewed: now.toISOString(),
    reviewLog: [...state.reviewLog, entry],
  };
}

export function isDue(state: CardState, now = new Date()): boolean {
  return new Date(state.due).getTime() <= now.getTime();
}

/** Push every sibling's due date to match the just-reviewed card's new due
 *  date, so none of them shows up as due again in the same/next session
 *  before the user has forgotten what reviewing this card just revealed
 *  about them -- a reverse pair's other side, or the other cloze cards from
 *  the same source block (see types.ts Card.reverseOf / Card.siblingGroup,
 *  decks.ts siblingHashesOf()). Each sibling's own ease/reps/lapses/
 *  reviewLog is left untouched; only `due` is coordinated. Returns NEW
 *  CardState objects (never mutates input). */
export function coordinateSiblingsDue(siblings: CardState[], updatedState: CardState): CardState[] {
  return siblings.map((s) => ({ ...s, due: updatedState.due }));
}

/** Decide a reverse pair's sibling's new due date after this side was just
 *  reviewed. v1: mirror the same due timestamp, so the untested side won't
 *  also show up as due in the same/next session -- its own ease/reps/
 *  lapses/reviewLog stay untouched, only scheduling timing is coordinated. */
export function coordinateSiblingDue(sibling: CardState, updatedState: CardState): CardState {
  return coordinateSiblingsDue([sibling], updatedState)[0];
}
