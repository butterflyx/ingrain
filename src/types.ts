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
  /** Full tag path, e.g. "flashcards/network/suricata". */
  deck: string;
  kind: CardKind;
  front: string;
  back: string;
  reverse: boolean;
  /** For cloze cards: which cloze within the source block (0-based). */
  clozeIndex?: number;
  /** Optional hint shown on the front of a cloze card. */
  hint?: string;
  /** Optional sequence number grouping clozes onto one card (classic clozes). */
  seq?: string;
  /** Raw source block the card was derived from. Basis for hashing + locating. */
  sourceBlock: string;
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
}

/** User-configurable cloze syntax. Highlight and bold are both toggleable. */
export interface ClozeConfig {
  highlight: boolean; // ==answer==
  bold: boolean; // **answer**
}

export interface FlowcardsSettings {
  deckTagRoot: string; // tag prefix that marks a note as containing cards, e.g. "flashcards"
  reverseEmoji: string; // marks a card as reversible, e.g. "🔁"
  cloze: ClozeConfig;
}

export const DEFAULT_SETTINGS: FlowcardsSettings = {
  deckTagRoot: "flashcards",
  reverseEmoji: "🔁",
  cloze: { highlight: true, bold: true },
};
