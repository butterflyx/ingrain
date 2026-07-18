# Flowcards — Claude Code working notes

Reading-flow-first spaced repetition plugin for Obsidian. Cards come from
callouts and inline clozes; card identity is a content hash; scheduling state
lives in a plugin store (NOT in note frontmatter — Bases is intentionally out
of scope for per-card stats).

## Commands

- `npm test` — vitest, headless. Run this after every logic change.
- `npm run test:watch` — vitest in watch mode.
- `npm run typecheck` — tsc, no emit.
- `npm run dev` — esbuild watch, produces `main.js`.
- `npm run build` — typecheck + production bundle.

## Architecture — respect this boundary

- `src/main.ts` — the ONLY file allowed to import "obsidian". Thin glue:
  lifecycle, events, commands, settings tab, and the `ReviewModal` class
  (DOM wiring only — it delegates every state transition to `review.ts`).
  No parsing/scheduling/session logic here.
- `src/parser.ts`, `src/scheduler.ts`, `src/reconcile.ts`, `src/review.ts`,
  `src/hash.ts`, `src/types.ts` — PURE. Never import "obsidian". This is where
  the real work lives and where all tests point. You can iterate here fully
  headless.

When adding behaviour: write the vitest test in `src/__tests__/` first, then
implement in the pure module. Only wire it into `main.ts` once tests are green.

## Identity model (do not break)

- A card's identity is `cardHash(content, discriminator)`. Path is NOT part of
  identity — it is mutable metadata refreshed on every parse.
- Consequence: rename/move never resets scheduling (re-links by hash). Editing
  content DOES reset (new hash → old state orphaned and deleted). This is
  intended behaviour, tested in `reconcile.test.ts`.
- Identical cards colliding vault-wide is an accepted, ignored edge case.

## Note-tag gating (do not break)

- `parseNote()` returns `[]` entirely when `hasDeckTag()` is false — a note
  without the configured deck tag (e.g. `#flashcards`) produces zero cards,
  regardless of callouts/clozes present. This is the real opt-in.
  `extractDeck()`'s fallback to the root deck name is display-only and must
  never be read as "this note is tagged" — a note with a stray `==highlight==`
  and no tag at all used to silently become reviewable; that's exactly the
  bug this gate closes. Tested in `parser.test.ts` (`hasDeckTag` describe
  block + the "no tag -> zero cards" case in `parseNote`).

## Things only the user can do (not you)

- Reload the plugin in Obsidian (Cmd/Ctrl+R) after a build.
- Inspect the live review UI. So keep logic in pure functions you CAN test.
- If Node/npm aren't on PATH in your sandbox, check before assuming they're
  unavailable — the user may have set up fnm/nvm since your last session.

## Reference

- Obsidian API types: `node_modules/obsidian/obsidian.d.ts` (read this for API).
- Behaviour reference (the plugin we're deliberately diverging from):
  `st3v3nmw/obsidian-spaced-repetition`.
- User-facing feature docs and syntax examples: `README.md`.

## Implementation status

| Feature | Status | Module |
| --- | --- | --- |
| Parser: callouts + inline clozes | done | `parser.ts` |
| Note-tag gating | done | `parser.ts` `hasDeckTag` |
| Cloze scope setting (whole note / callout-only) | done | `types.ts` `ClozeConfig.scope` |
| Configurable callout type | done | `types.ts` `FlowcardsSettings.calloutType`, `parser.ts` `findCallouts` |
| SM-2 scheduler | done | `scheduler.ts` |
| Reconcile (hash identity, rename/orphan handling) | done | `reconcile.ts` |
| Review session state machine + Modal | done | `review.ts` + `main.ts` `ReviewModal` |
| Settings persistence | done | `main.ts` `PersistedData.settings`, `saveSettings()` |
| Cloze seq-grouping (classic clozes, Generalized Overlapping) | done | `parser.ts` `groupClozes`/`extractClozes` — callout-only, `[^seq]` stays inert outside callouts to protect real footnotes |
| Card context (nearest heading, filename fallback) | done | `parser.ts` `findHeadings`/`nearestHeading`, `types.ts` `Card.context` |
| Configurable cloze pattern (custom regex) | open | `types.ts` `ClozeConfig` — highlight/bold toggle only, no pattern UI |
| Bases note-aggregate export | open | not started |

## v1 milestones

Backlog ideas have been triaged into the milestones below, grouped by which
part of the codebase they touch and ordered so smaller/independent pieces
ship before the ones they'd otherwise block.

- **M1 (done):** parser subset + hash + SM-2 + reconcile, all tested.
- **M2 (done):** note-tag gating, cloze-scope setting, configurable callout
  type, settings persistence, callout-only cloze seq-grouping, card
  context (nearest heading). See Implementation status above.
- **M3 (done):** the review Modal (mobile + desktop) — `src/review.ts`
  (pure session state machine) + `ReviewModal` in `main.ts` (DOM glue).
- **M4 (not started): sidebar navigation & deck-scoped review.**
  1. Ribbon icon that opens "Review due cards" directly — trivial, zero new
     logic, ships first (`main.ts` `addRibbonIcon`).
  2. An overview view/modal listing decks with due counts, so the user can
     review one subdeck at a time instead of always reviewing everything —
     needs `dueCards()`/`startReview()` to accept an optional deck-path
     filter, plus a small pure helper to build a deck tree + counts from
     the store.
- **M5 (not started, was M4):** configurable cloze pattern UI (custom
  regex beyond the highlight/bold toggle), optional Bases note-aggregate
  export.
- Explicitly NOT in v1: reviewing whole notes.

## Raw ideas (untriaged)

Scratch space for the user to drop ideas as they come up, in whatever shape
they arrive in. Tag priority with `(P:N)` — lower N is more urgent. This
list is expected to be messy; do not silently clean up wording here.

When asked to triage: pick a slot in the v1 milestones above (ordered by
`(P:N)` where given, your judgment otherwise), rewrite it as a proper
milestone bullet (what changes, which files), and remove it from this list.
Don't triage on your own initiative — wait to be asked, since priority
here is the user's call, not yours.

- eigenes default icon für Karten callouts im css (P:3) 
- Markdown-Tabellen mit Clozes müssen zuverlässig funktionieren. Zuvor muss die Gruppierung von Clozes funktionieren. Ein zulässiger Zwischenschritt wäre, dass das zunächst nur für Tabellen innerhalb von cards funktioniert. (P:1)
- Übersetzung der Settings usw in andere Sprachen, iB Deutsch (P:3)
- Settings-Änderung löst Re-Index aus. Das würden die meisten User erwarten (P:2)
- Bei Reverse Karten: wenn eine Seite abgefragt wurde, die andere auf einen späteren Zeitpunkt verschieben, also nicht mehr aktuell offen. (P:2)
- einen Befehl der einen card callout-skeleton an der aktuellen Cursor Position einfügt. Analog einer Vorlage für das templater plugin. Damit man schneller Karten anlegen kann (P:3)