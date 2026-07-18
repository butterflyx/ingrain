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
  `src/decks.ts`, `src/reminder.ts`, `src/i18n.ts`, `src/hash.ts`,
  `src/types.ts` — PURE. Never import "obsidian". This is where the real
  work lives and where all tests point.
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
| Cloze tables | done | `parser.ts` `extractClozes`/`tableHeaderRanges` — table header rows excluded from cloze matching so bold/highlighted labels aren't misread as clozes |
| Multi-deck tags (`Card.decks`) | done | `types.ts` `Card.decks`, `parser.ts` `extractDecks` |
| Settings-triggered reindex | done | `main.ts` `FlowcardsSettingTab.hide()` → `saveSettings()` → `rebuildIndex()` |
| Reverse-card due-date coordination | done | `types.ts` `Card.reverseOf`, `scheduler.ts` `coordinateSiblingDue` |
| Per-callout deck-tag override | done | `parser.ts` `calloutCards()` — local `findDeckTags()` on the callout's own text |
| Deck overview page + deck-scoped review | done | `main.ts` `DecksView`, `decks.ts` `buildDeckTree`/`filterByDeck`; linkable via `obsidian://flowcards-decks`; refreshes via `FlowcardsPlugin.notifyDecksChanged()` (pushed on every state change) + `active-leaf-change` + a manual refresh action |
| New notes indexed on creation | done | `main.ts` `vault.on("create", ...)`, same path as `modify` |
| Reset all learning progress | done | `main.ts` `FlowcardsPlugin.resetAllProgress()`, `ConfirmResetModal`, settings-tab "Danger zone" |
| DecksView rating breakdown | done | `decks.ts` `DeckNode.dueByRating`/`classify()`, `main.ts` `DecksView.renderBreakdown()` — colored Again/Hard/Good/Easy/New badges + total, replaces the old due/total label. Scoped to currently-due cards, by design (confirmed with user after live-testing raised it) — since `scheduler.ts` gives every rating a minimum 1-day interval, a card rated today always leaves the due set until at least tomorrow, so Again/Hard/Good/Easy can only show counts for cards rated on a *previous* day that are due again now. Same-day testing will only ever show "New" until the vault has multi-day history. Not a bug. A deck with zero due cards in every category shows an explicit "–" placeholder instead of a bare `\| N`. |
| Time-based review reminder | done | `reminder.ts` `shouldShowReminder`/`lastReviewedAt`, `main.ts` `checkReminder()` (hourly `registerInterval` + on-load check) — configurable via `FlowcardsSettings.reminderIntervalDays` (0 = disabled), Notice clickable to the deck overview, throttled to once/day |
| Card callout default styling | done | `styles.css` `.callout[data-callout="card"]` — icon + light background (`var(--background-secondary)`) for the default `calloutType`. Static rule, so it stops applying if `calloutType` is changed in settings (documented in README). |
| Insert card skeleton command | done | `main.ts` `insert-card-skeleton` command, `editorCallback`, reads the configured `calloutType` |
| Full-plugin i18n (English/German) | done | `i18n.ts` `t(locale, key, vars?)`, flat en/de dictionary, `{placeholder}` interpolation, English fallback for unknown locale/key. `FlowcardsPlugin.locale` read once from `moment.locale()` at `onload()`. Covers every visible string (commands, ribbon, Notices, ReviewModal, DecksView, ConfirmResetModal, settings tab) except the numeric `(1)`-`(4)` rating-button suffixes. |
| Configurable cloze pattern (custom regex) | dropped | user doesn't need this — highlight/bold toggle stays the permanent design |
| Bases note-aggregate export | dropped | user doesn't need this — store-only stays the permanent design |

## v1 milestones

Kept intentionally terse — the Implementation status table above is the
source of truth for *what* shipped and *where*; this list is just the
ordering/grouping history plus what's still open.

- **M1 (done):** parser subset + hash + SM-2 + reconcile, all tested.
- **M2 (done):** note-tag gating, cloze-scope setting, configurable
  callout type, settings persistence, callout-only cloze seq-grouping,
  card context.
- **M3 (done):** the review Modal (`review.ts` + `main.ts` `ReviewModal`).
- **M4 (done):** cloze/review correctness follow-ups — cloze tables,
  multi-deck tags, settings-triggered reindex, reverse-card due-date
  coordination, per-callout deck-tag override.
- **M5 (done):** deck overview page (`DecksView`) & deck-scoped review.
- **M6 (done):** DecksView rating breakdown — due cards per deck shown as
  colored Again/Hard/Good/Easy/New badges (last `reviewLog` rating, or
  New if never reviewed) instead of a plain due/total label.
- **M7 (done):** time-based review reminder — `Notice` via hourly
  `registerInterval` + an on-load check (catches an elapsed interval from
  while Obsidian was closed), gated on due cards existing and
  `reminderIntervalDays` since the last actual review, throttled to
  once/day. See Implementation status above.
- **M8 (done): polish & convenience.** DecksView "–" placeholder for a
  deck with zero due cards (triaged in from Raw ideas, P:2); default CSS
  icon + light background for card callouts; a command to insert a
  card-callout skeleton at the cursor; every visible plugin string made
  translatable, starting with German (expanded from the original
  settings-tab-only scope per user correction).
- Explicitly NOT in v1: reviewing whole notes.

## Before v1.0.0 release

Non-code deliverables that still need to happen before the version gets
fixed at v1.0.0 — not implementation, so not part of the M-numbered list
above.

- **Elevator pitch (P:1).** Write a short pitch for the plugin so the
  name "flowcards" can be challenged one more time before the release
  locks it in. Purely a writing task, no files/implementation involved.

## Post-v1 (v2.0.0, deliberately deferred)

- **Canvas-based image clozes.** "Bilder cloze mittels Canvas in Obsidian
  umsetzen. Boardmittel wo immer möglich." Image-occlusion-style clozes
  (mark a region over an image, review shows the image with that region
  blanked) using Obsidian's Canvas format. User has a worked example in
  the dev vault (`Kollisionsdomänen.canvas` — an image plus yellow-bordered
  occlusion cards) to investigate against when this gets picked up.
  Unresearched and explicitly out of v1 scope: `.canvas` files are JSON, a
  completely different track from the Markdown string-parsing this plugin
  does today (`parser.ts` doesn't apply at all) — needs investigation into
  the Canvas file format and whatever rendering API Obsidian exposes
  before a real plan can be written. "Boardmittel wo immer möglich"
  (prefer built-in means) points toward reusing Canvas's native node/edge
  model rather than inventing a new file format.

## Raw ideas (untriaged)

Scratch space for the user to drop ideas as they come up, in whatever shape
they arrive in. Tag priority with `(P:N)` — lower N is more urgent. This
list is expected to be messy; do not silently clean up wording here.

When asked to triage: pick a slot in the v1 milestones (or Post-v1) above
(ordered by `(P:N)` where given, your judgment otherwise), rewrite it as a
proper milestone bullet (what changes, which files), and remove it from
this list. Don't triage on your own initiative — wait to be asked, since
priority here is the user's call, not yours.

(none right now)