# Ingrain — Claude Code working notes

Reading-flow-first spaced repetition plugin for Obsidian. Cards come from
callouts and inline clozes; card identity is a content hash; scheduling state
lives in a plugin store (NOT in note frontmatter — Bases is intentionally out
of scope for per-card stats).

> Personal roadmap notes, milestone history, and dev-environment specifics
> live in `CLAUDE.local.md` (gitignored, not in this repo). Check it too if
> present.

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

## Reference

- Obsidian API types: `node_modules/obsidian/obsidian.d.ts` (read this for API).
- Behaviour reference (the plugin we're deliberately diverging from):
  `st3v3nmw/obsidian-spaced-repetition`.
- User-facing feature docs and syntax examples: `README.md`.
