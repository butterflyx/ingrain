# Flowcards

Reading-flow-first spaced repetition for Obsidian. Your notes stay readable;
cards are derived from callouts and inline clozes rather than dedicated blocks.

## Why a new plugin

Card identity is a **content hash**, so scheduling survives rename/move and
resets cleanly on edit — without a note UUID (Obsidian has none natively) and
without mutating your notes' frontmatter. Per-card stats live in a plugin store;
an optional flat note-aggregate for Bases is a later, opt-in feature.

## Setup

```bash
npm install
npm test          # everything green = pure logic verified, no Obsidian needed
npm run dev       # esbuild watch -> main.js
```

Symlink the repo into a test vault to try it live:

```bash
ln -sfn "$(pwd)" "/path/to/DevVault/.obsidian/plugins/flowcards"
```

Then enable Flowcards in the vault and reload with Cmd/Ctrl+R after each build.

## Requirements → where they live

| Requirement | Status | Module |
| --- | --- | --- |
| Reading flow preserved | core design | `parser.ts` (no required syntax) |
| Mobile + desktop | ✅ | `manifest.json` isDesktopOnly:false, `hash.ts` sync hash |
| No plugin dependency | ✅ | self-contained |
| No AI dependency | ✅ | — |
| Multiple cards per note | ✅ | `parser.ts` → many `Card`s |
| Callouts as cards | ✅ (subset) | `parser.ts` findCallouts |
| Callout title=front / body=back when no cloze | ✅ | `parser.ts` calloutCards |
| Clozes via highlight or bold | ✅ | `parser.ts` extractClozes |
| Clozes with hints and sequence numbers | ⚠️ parsed, not yet grouped | `parser.ts` (TODO: seq grouping) |
| Configurable cloze pattern | ⚠️ toggle only | `types.ts` ClozeConfig (TODO: pattern UI) |
| Emoji marks reverse cards | ✅ | `parser.ts` calloutCards |
| Tags as decks + subtag logic | ✅ | `parser.ts` extractDeck |
| Per-card stats in a store | ✅ | `reconcile.ts` + store in `main.ts` |
| Bases for aggregate analysis | later, opt-in | (note-aggregate export, M4) |
| No whole-note review in v1 | ✅ by omission | — |

Legend: ✅ implemented & tested · ⚠️ partial/stub with a marked TODO.

## Design decisions (settled)

- **Store only, no per-card frontmatter** (Bases can't unfold multiple cards
  per note into rows; per-card analytics is a plugin view instead).
- **Content-hash identity**, path as mutable metadata.
- **Reset on edit** via hard-deleting the orphaned state.
- **SM-2** for v1, behind an interface so **FSRS (ts-fsrs)** can replace it later.
