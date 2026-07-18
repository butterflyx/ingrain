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
  lifecycle, events, commands, settings tab, and the `ReviewModal`/
  `DecksView` classes (DOM wiring only — they delegate every state
  transition/count to `review.ts`/`decks.ts`). No parsing/scheduling/
  session logic here.
- `src/parser.ts`, `src/scheduler.ts`, `src/reconcile.ts`, `src/review.ts`,
  `src/decks.ts`, `src/hash.ts`, `src/types.ts` — PURE. Never import
  "obsidian". This is where the real work lives and where all tests point.
  You can iterate here fully headless.

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
| Cloze tables | done | `parser.ts` `extractClozes`/`tableHeaderRanges` — string-splicing already preserved structure; real bug found later via dev-vault repro (bold/highlighted header rows were misread as clozes), now filtered out regardless of callout scope |
| Multi-deck tags (`Card.decks`) | done | `types.ts` `Card.decks`, `parser.ts` `extractDecks` |
| Settings-triggered reindex | done | `main.ts` `FlowcardsSettingTab.hide()` → `saveSettings()` → `rebuildIndex()` |
| Reverse-card due-date coordination | done | `types.ts` `Card.reverseOf`, `scheduler.ts` `coordinateSiblingDue` |
| Per-callout deck-tag override | done | `parser.ts` `calloutCards()` — local `findDeckTags()` on the callout's own text |
| Deck overview page + deck-scoped review | done | `main.ts` `DecksView` (linkable via `obsidian://flowcards-decks`), `decks.ts` `buildDeckTree`/`filterByDeck` |
| Configurable cloze pattern (custom regex) | dropped | user doesn't need this — highlight/bold toggle stays the permanent design |
| Bases note-aggregate export | dropped | user doesn't need this — store-only stays the permanent design |

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
- **M4 (done): cloze/review correctness follow-ups.** Reliable cloze
  tables (string-splicing was already safe; a real bug was found later —
  bold/highlighted table header rows were misread as clozes, fixed via
  `tableHeaderRanges()`), multi-deck tags (`Card.decks`, a card belongs to
  every matching tag, reviewed once, first tag used for display), settings
  changes reindex automatically on settings-tab close (not per keystroke
  — see `FlowcardsSettingTab.hide()`), reverse-card due-date coordination
  (`Card.reverseOf` + `coordinateSiblingDue()`), per-callout deck-tag
  override. See Implementation status above.
- **M5 (done): deck overview page & deck-scoped review.** `DecksView`
  (an `ItemView`, opened as a normal tab — not a Modal) lists every deck
  hierarchically with due/total counts (`decks.ts` `buildDeckTree`,
  dedupes multi-deck cards per node) and an "All decks" shortcut.
  Reachable via the ribbon icon (`graduation-cap`), the "Open deck
  overview" command, or a plain Markdown link from any note —
  `[Decks](obsidian://flowcards-decks)`, registered via
  `registerObsidianProtocolHandler` since Obsidian wikilinks can't target
  a view without file backing. Picking a deck opens `ReviewModal` scoped
  to it (`startReview()` takes an optional `deckPath`, filtered via
  `decks.ts` `filterByDeck()`) and passes an `onClose` callback so the
  page's counts refresh the instant the review Modal closes. See
  Implementation status above.
- ~~M6: configurable cloze pattern UI, Bases export~~ — **dropped**, user
  doesn't need this. See Implementation status above.
- **M6 (not started): Canvas-based image clozes (P:2).** "Bilder cloze
  mittels Canvas in Obsidian umsetzen. Boardmittel wo immer möglich."
  Image-occlusion-style clozes (mark a region over an image, review shows
  the image with that region blanked) using Obsidian's Canvas format.
  Unresearched: `.canvas` files are JSON, a completely different track
  from the Markdown string-parsing this plugin does today (`parser.ts`
  doesn't apply at all) — needs investigation into the Canvas file format
  and whatever rendering API Obsidian exposes before a real plan can be
  written. "Boardmittel wo immer möglich" (prefer built-in means) points
  toward reusing Canvas's native node/edge model rather than inventing a
  new file format.
- **M7 (not started): time-based review reminder (P:2).** "Eine
  Erinnerung Zeit-basiert und konfigurierbar, zb alle N Tage." Needs a
  design decision before implementing: a new `FlowcardsSettings` field
  for the interval, a trigger mechanism (`Plugin.registerInterval()` for
  an in-app timer is the obvious Obsidian-native option), and clarity on
  what "every N days" means precisely (calendar-day interval? hours since
  last review? only when cards are actually due?) — ask the user before
  building this one.
- **M8 (not started, was M7): polish & convenience.** All `(P:3)` from
  the idea backlog — lowest urgency, ship after everything above.
  1. Default CSS icon for card callouts, so they're visually distinct in
     Reading/Live Preview without the user picking one manually.
  2. Translate the settings tab (and other UI strings) into other
     languages, starting with German.
  3. A command that inserts a card-callout skeleton at the cursor —
     Templater-snippet-style, to create cards faster.
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

- (none right now — Canvas image clozes and the time-based reminder went
  into M6/M7 above; the P:1 "linkable learning page" idea turned out to
  already be satisfied by the M5 DecksView work — `obsidian://flowcards-decks`
  — so it wasn't triaged into a milestone, just dropped from this list)