import { StateMap } from "./types";
import { dueCards } from "./reconcile";

// PURE: review-reminder scheduling logic (M7). No "obsidian" import — main.ts
// wires this to a registerInterval() timer + Notice, both untestable here.

const DAY = 86_400_000;

/** Most recent CardState.lastReviewed across the whole store, or null if
 *  nothing has ever been reviewed. Derived rather than persisted separately,
 *  so it stays correct after e.g. resetAllProgress() without needing its
 *  own reset logic. */
export function lastReviewedAt(states: StateMap): Date | null {
  let latest: number | null = null;
  for (const state of Object.values(states)) {
    if (!state.lastReviewed) continue;
    const t = new Date(state.lastReviewed).getTime();
    if (latest === null || t > latest) latest = t;
  }
  return latest === null ? null : new Date(latest);
}

/**
 * Whether a review reminder should fire right now: cards are due AND at
 * least `reminderIntervalDays` have passed since the last actual review
 * (never-reviewed counts as always overdue) AND the reminder hasn't
 * already been shown within the last day (throttle, independent of the
 * configured interval, so an hourly timer tick doesn't re-notify
 * repeatedly once the condition becomes true).
 */
export function shouldShowReminder(
  states: StateMap,
  reminderIntervalDays: number,
  lastReminderShown: string | null,
  now = new Date(),
): boolean {
  if (reminderIntervalDays <= 0) return false; // 0 = disabled
  if (dueCards(states, now).length === 0) return false;

  const lastReview = lastReviewedAt(states);
  const daysSinceReview = lastReview ? (now.getTime() - lastReview.getTime()) / DAY : Infinity;
  if (daysSinceReview < reminderIntervalDays) return false;

  if (lastReminderShown) {
    const daysSinceShown = (now.getTime() - new Date(lastReminderShown).getTime()) / DAY;
    if (daysSinceShown < 1) return false;
  }
  return true;
}
