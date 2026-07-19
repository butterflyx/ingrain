// Pure domain types. IMPORTANT: this module must never import "obsidian",
// so that all logic built on top of it stays headless-testable with vitest.

/** Review grades, Anki-style. Kept numeric for a stable review log. */
export type Rating = 1 | 2 | 3 | 4; // 1=Again, 2=Hard, 3=Good, 4=Easy

export type CardKind = "cloze" | "callout-qa" | "basic";

/**
 * A Card is produced fresh by the parser on every re-parse of a note.
 * Nothing here is persisted directly — the `hash` is the bridge to CardState.
 */
export interface Card {
  /** Content identity. Stable as long as the learnable content is unchanged. */
  hash: string;
  /** Current location. Mutable metadata only — NOT part of identity. */
  notePath: string;
  /** Primary/display deck, e.g. "flashcards/network/suricata". Always
   *  equal to decks[0] — kept as its own field since it's what gets shown
   *  (e.g. the review Modal title), independent of how many decks below
   *  the card also belongs to. */
  deck: string;
  /** Every deck this card belongs to (every matching tag), in resolution
   *  order. Card identity (hash) never depends on this — a card with
   *  multiple decks is still reviewed exactly once; deck-scoped review
   *  (M5) would show it under any of these. */
  decks: string[];
  kind: CardKind;
  front: string;
  back: string;
  reverse: boolean;
  /** For a reverse Q&A pair: the sibling card's hash. Set on both sides,
   *  pointing at each other, so reviewing one can push the other's due
   *  date out (see scheduler.ts coordinateSiblingDue()). Undefined for
   *  non-reversible callout cards and all cloze cards. */
  reverseOf?: string;
  /** For cloze cards: 0-based index of this card's cloze GROUP within the
   *  source block (clozes sharing a seq collapse into one group/card). */
  clozeIndex?: number;
  /** Hint shown for a blanked cloze occurrence. For a grouped card this is
   *  the first member's hint — each occurrence still renders its own hint
   *  in `front`, this field is just a representative single value. */
  hint?: string;
  /** Sequence number that grouped this card's clozes (classic clozes,
   *  callout-only — see extractClozes()). Undefined for ungrouped cards. */
  seq?: string;
  /** Raw source block the card was derived from. Basis for hashing + locating. */
  sourceBlock: string;
  /** Nearest heading above this card's source block, for context at review
   *  time. Falls back to the note's filename when no heading precedes it. */
  context: string;
}

export interface ReviewEntry {
  ts: string; // ISO
  rating: Rating;
  intervalAfter: number; // days, after applying this review
}

/**
 * The persisted scheduling state. Keyed in the store by `hash` alone.
 * `notePath` is stored for display/navigation and is updated on every parse.
 */
export interface CardState {
  hash: string;
  notePath: string;
  // --- SM-2 fields ---
  ease: number; // ease factor, starts at 2.5
  interval: number; // days
  reps: number; // consecutive correct reviews
  lapses: number; // times rating was "Again" after graduating
  due: string; // ISO date the card is next due
  // --- for the plugin's own analytics view (Bases is intentionally out) ---
  created: string; // ISO
  lastReviewed: string | null; // ISO
  reviewLog: ReviewEntry[];
}

/** hash -> state. This is the whole persisted store (plus a schema version). */
export type StateMap = Record<string, CardState>;

export interface PersistedData {
  schema: 1;
  states: StateMap;
  settings: SiftSettings;
  /** ISO timestamp of the last time a review reminder was shown (see
   *  reminder.ts). Optional for back-compat with data.json files saved
   *  before this field existed. */
  lastReminderShown?: string | null;
}

/** Where cloze markers are recognized: everywhere in the note body, or only
 *  inside callouts (an explicit "this is a card" container). Does not affect
 *  callouts themselves — those are always card candidates regardless. */
export type ClozeScope = "anywhere" | "callout-only";

/** User-configurable cloze syntax. Highlight and bold are both toggleable. */
export interface ClozeConfig {
  highlight: boolean; // ==answer==
  bold: boolean; // **answer**
  scope: ClozeScope;
}

export interface SiftSettings {
  deckTagRoot: string; // tag prefix that marks a note as containing cards, e.g. "flashcards"
  reverseEmoji: string; // marks a card as reversible, e.g. "🔁"
  calloutType: string; // only callouts of this type (case-insensitive) become cards, e.g. "card"
  cloze: ClozeConfig;
  /** Show a review reminder after this many days without a review, but only
   *  when cards are actually due (see reminder.ts). 0 disables it. */
  reminderIntervalDays: number;
}

export const DEFAULT_SETTINGS: SiftSettings = {
  deckTagRoot: "flashcards",
  reverseEmoji: "🔁",
  calloutType: "card",
  cloze: { highlight: true, bold: true, scope: "anywhere" },
  reminderIntervalDays: 0,
};
