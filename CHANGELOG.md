# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-14

Initial release.

### Added

- Callouts become question/answer cards; highlighted or bolded text
  becomes cloze cards. No dedicated flashcard syntax required.
- Note-level deck tags (`#flashcards/...`), with per-callout overrides
  and multi-deck support.
- Reversible callout cards (front ↔ back) and cloze sibling grouping
  (shared-reference clozes blank together, reveal together).
- SM-2 spaced-repetition scheduling.
- Content-hash card identity — renaming or moving a note never resets its
  cards' progress; editing a card's content does, deliberately.
- A review session (command palette, keyboard shortcuts `1`–`4`) and a
  deck overview page with per-deck due counts and a colored
  Again/Hard/Good/Easy/New breakdown, linkable via
  `obsidian://ingrain-decks`.
- Automatic re-indexing on note create/edit and on parsing-relevant
  settings changes, plus a manual "Rebuild index" command.
- A time-based review reminder (optional, off by default).
- Settings for the deck tag root, reverse-card emoji, callout type, cloze
  recognition (highlight/bold, independently toggleable), cloze scope,
  and the reminder interval, plus a "reset all progress" escape hatch.
- English and German UI, following Obsidian's own language setting.
- Persisted per-file parse cache, so a warm load doesn't re-scan the
  whole vault.
- Cross-device sync support: a `data.json` update from another device
  (e.g. via Obsidian Sync) is picked up live, without restarting
  Obsidian, merging per-card progress by whichever side has more review
  history rather than blindly overwriting.

[0.1.0]: https://github.com/butterflyx/ingrain/releases/tag/0.1.0
