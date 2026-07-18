// PURE: string dictionary + lookup for every user-visible plugin string.
// No "obsidian" import -- main.ts reads the active locale once from
// moment.locale() at onload() and passes it into every t() call.

export type Locale = "en" | "de";

export const strings = {
  en: {
    // Commands + ribbon
    cmdReviewDue: "Review due cards",
    cmdRebuildIndex: "Rebuild index (sweep orphans)",
    cmdOpenDecks: "Open deck overview",
    cmdInsertSkeleton: "Insert card skeleton",
    ribbonOpenDecks: "Open deck overview",
    // Notices
    noticeReminderDue: "Flowcards: {count} card(s) due. Click to review.",
    noticeNoCardsDue: "Flowcards: no cards due.",
    noticeNoCardsDueInDeck: "Flowcards: no cards due in {deck}.",
    noticeStillIndexing: "Flowcards: still indexing, try again in a moment.",
    noticeProgressReset: "Flowcards: all learning progress has been reset.",
    // ReviewModal
    reviewProgressTitle: "{deck} — {current} of {total}",
    reviewShowAnswer: "Show answer",
    ratingAgain: "Again",
    ratingHard: "Hard",
    ratingGood: "Good",
    ratingEasy: "Easy",
    ratingNew: "New",
    reviewComplete: "Review complete",
    reviewedCount: "Reviewed {count} card(s).",
    close: "Close",
    // DecksView
    decksViewTitle: "Flowcards decks",
    decksRefreshAction: "Refresh",
    decksHeading: "Decks",
    decksAllDue: "All decks ({count} due)",
    decksEmpty: "No cards indexed yet.",
    // ConfirmResetModal
    confirmResetTitle: "Reset all learning progress?",
    confirmResetBody:
      "This permanently deletes scheduling history (ease, interval, review log) for every card in your vault. This cannot be undone.",
    cancel: "Cancel",
    resetEverything: "Reset everything",
    // Settings tab
    deckTagRootName: "Deck tag root",
    deckTagRootDesc: "Tag prefix that marks notes containing cards, e.g. flashcards",
    reverseEmojiName: "Reverse emoji",
    reverseEmojiDesc: "Marks a Q&A card as reversible",
    calloutTypeName: "Callout type",
    calloutTypeDesc: "Only callouts of this type (e.g. [!card]) become cards",
    clozeHighlightName: "Cloze: highlight (==...==)",
    clozeBoldName: "Cloze: bold (**...**)",
    clozeScopeName: "Cloze scope",
    clozeScopeDesc:
      "Where cloze markers count as cards. Callouts are always card candidates either way — this only controls loose clozes in the rest of the note.",
    clozeScopeAnywhere: "Whole note",
    clozeScopeCalloutOnly: "Inside callouts only",
    reminderName: "Review reminder",
    reminderDesc:
      "Show a reminder if you haven't reviewed in this many days (0 disables it). Only shown when cards are actually due.",
    dangerZone: "Danger zone",
    resetName: "Reset all learning progress",
    resetDesc: "Deletes every card's scheduling history and starts fresh. This cannot be undone.",
  },
  de: {
    cmdReviewDue: "Fällige Karten lernen",
    cmdRebuildIndex: "Index neu aufbauen (verwaiste Einträge entfernen)",
    cmdOpenDecks: "Kartenstapel-Übersicht öffnen",
    cmdInsertSkeleton: "Karten-Grundgerüst einfügen",
    ribbonOpenDecks: "Kartenstapel-Übersicht öffnen",
    noticeReminderDue: "Flowcards: {count} Karte(n) fällig. Klicken zum Lernen.",
    noticeNoCardsDue: "Flowcards: Keine Karten fällig.",
    noticeNoCardsDueInDeck: "Flowcards: Keine Karten fällig in {deck}.",
    noticeStillIndexing: "Flowcards: Wird noch indexiert, bitte gleich erneut versuchen.",
    noticeProgressReset: "Flowcards: Der gesamte Lernfortschritt wurde zurückgesetzt.",
    reviewProgressTitle: "{deck} — {current} von {total}",
    reviewShowAnswer: "Antwort zeigen",
    ratingAgain: "Nochmal",
    ratingHard: "Schwer",
    ratingGood: "Gut",
    ratingEasy: "Leicht",
    ratingNew: "Neu",
    reviewComplete: "Lernsitzung abgeschlossen",
    reviewedCount: "{count} Karte(n) gelernt.",
    close: "Schließen",
    decksViewTitle: "Flowcards-Kartenstapel",
    decksRefreshAction: "Aktualisieren",
    decksHeading: "Kartenstapel",
    decksAllDue: "Alle Stapel ({count} fällig)",
    decksEmpty: "Noch keine Karten indexiert.",
    confirmResetTitle: "Gesamten Lernfortschritt zurücksetzen?",
    confirmResetBody:
      "Dies löscht den Lernverlauf (Ease, Intervall, Bewertungslog) für jede Karte im gesamten Vault dauerhaft. Das kann nicht rückgängig gemacht werden.",
    cancel: "Abbrechen",
    resetEverything: "Alles zurücksetzen",
    deckTagRootName: "Basis-Tag für Kartenstapel",
    deckTagRootDesc: "Tag-Präfix, das Notizen mit Karten kennzeichnet, z. B. flashcards",
    reverseEmojiName: "Emoji für Umkehrkarten",
    reverseEmojiDesc: "Kennzeichnet eine Frage/Antwort-Karte als umkehrbar",
    calloutTypeName: "Callout-Typ",
    calloutTypeDesc: "Nur Callouts dieses Typs (z. B. [!card]) werden zu Karten",
    clozeHighlightName: "Lückentext: Hervorhebung (==...==)",
    clozeBoldName: "Lückentext: Fett (**...**)",
    clozeScopeName: "Lückentext-Bereich",
    clozeScopeDesc:
      "Wo Lückentext-Markierungen als Karten zählen. Callouts sind so oder so immer Kartenkandidaten — dies steuert nur lose Lücken im restlichen Text der Notiz.",
    clozeScopeAnywhere: "Ganze Notiz",
    clozeScopeCalloutOnly: "Nur innerhalb von Callouts",
    reminderName: "Lern-Erinnerung",
    reminderDesc:
      "Zeigt eine Erinnerung, wenn seit so vielen Tagen nicht gelernt wurde (0 deaktiviert dies). Erscheint nur, wenn auch tatsächlich Karten fällig sind.",
    dangerZone: "Gefahrenzone",
    resetName: "Gesamten Lernfortschritt zurücksetzen",
    resetDesc: "Löscht den Lernverlauf jeder Karte und beginnt neu. Das kann nicht rückgängig gemacht werden.",
  },
} as const;

export type Key = keyof typeof strings.en;

/** Simple {placeholder} interpolation -- no plural rules, matches this
 *  plugin's existing "N card(s)" English-only pluralization compromise.
 *  Unknown locale or (structurally impossible, but defensive) missing key
 *  falls back to English. */
export function t(locale: string, key: Key, vars?: Record<string, string | number>): string {
  const dict = locale in strings ? strings[locale as Locale] : strings.en;
  let text: string = dict[key] ?? strings.en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}
