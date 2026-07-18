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
  lifecycle, events, commands, settings tab. No parsing/scheduling logic here.
- `src/parser.ts`, `src/scheduler.ts`, `src/reconcile.ts`, `src/hash.ts`,
  `src/types.ts` — PURE. Never import "obsidian". This is where the real work
  lives and where all tests point. You can iterate here fully headless.

When adding behaviour: write the vitest test in `src/__tests__/` first, then
implement in the pure module. Only wire it into `main.ts` once tests are green.

## Identity model (do not break)

- A card's identity is `cardHash(content, discriminator)`. Path is NOT part of
  identity — it is mutable metadata refreshed on every parse.
- Consequence: rename/move never resets scheduling (re-links by hash). Editing
  content DOES reset (new hash → old state orphaned and deleted). This is
  intended behaviour, tested in `reconcile.test.ts`.
- Identical cards colliding vault-wide is an accepted, ignored edge case.

## Things only the user can do (not you)

- Reload the plugin in Obsidian (Cmd/Ctrl+R) after a build.
- Inspect the live review UI. So keep logic in pure functions you CAN test.

## Reference

- Obsidian API types: `node_modules/obsidian/obsidian.d.ts` (read this for API).
- Behaviour reference (the plugin we're deliberately diverging from):
  `st3v3nmw/obsidian-spaced-repetition`.

## v1 scope / roadmap (see README for the full checklist)

- M1 (done here): parser subset + hash + SM-2 + reconcile, all tested.
- M2: persist settings, richer parser (seq-grouped clozes, overlapping actions).
- M3: the review Modal (mobile + desktop) — plugs in at `startReview()`.
- M4: configurable cloze patterns UI, optional Bases note-aggregate export.
- Explicitly NOT in v1: reviewing whole notes.

## ideas for roadmap planning

- [ ] Schalter, mit dem festgelegt wird, ob cloze pattern nur innerhalb von
  callouts gelten soll oder für die gesamte Notiz in den Einstellungen des plugins
- [ ] cards should contain the headline of the paragraph where the card lives in the note, to give the student context. If there is no card, use the note name
- [ ] icon für die sidebar um Karten zu lernen
- [ ] icon in sidebar führt auf eine Übersichtsseite, auf der ich die subdecks zum lernen auswählen kann, oder root alle Karten
