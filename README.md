# Flowcards

Reading-flow-first spaced repetition for [Obsidian](https://obsidian.md).
Your notes stay readable — cards come from callouts and highlighted text you
already write, not from dedicated flashcard blocks.

## Why

Most spaced-repetition plugins ask you to write in a special syntax, wrap
everything in dedicated blocks, or clutter your notes with per-card
frontmatter. Flowcards works with the way you already take notes:

- **No required syntax.** A callout is a card. A highlighted or bolded word
  is a cloze. Nothing else changes about how you write.
- **Nothing is written into your notes.** All scheduling progress lives in
  the plugin's own store — your files stay exactly as you wrote them, no
  frontmatter clutter, no note UUIDs.
- **Renaming and moving notes is free.** A card's identity is based on its
  content, not its location, so reorganizing your vault never resets your
  progress. Editing a card's content *does* reset it — that's the point,
  the material changed.
- **Works on mobile and desktop.**

## Installing

Flowcards isn't in the Community Plugins directory yet, so for now you build
it from source:

```bash
git clone <this-repo>
cd flowcards
npm install
npm run build
```

Then copy (or symlink) the folder into your vault's plugins directory:

```bash
ln -sfn "$(pwd)" "/path/to/YourVault/.obsidian/plugins/flowcards"
```

Open Obsidian, go to **Settings → Community plugins**, and enable Flowcards.

## Creating cards

### 1. Tag the note

Flowcards only looks at notes carrying your configured deck tag — `#flashcards`
by default. Add it anywhere: inline in the text, or as a frontmatter tag.
Notes without the tag are left alone entirely, even if they happen to contain
a callout or a highlighted word.

```markdown
---
tags: [flashcards/spanish]
---
```

or simply `#flashcards/spanish` written anywhere in the note.

Subtags build the deck path, so `#flashcards/spanish/verbs` groups those
cards under `spanish/verbs`.

A note can carry more than one deck tag — its cards then belong to all of
those decks (relevant once you review a specific deck rather than
everything), but each card is still reviewed exactly once, not once per
deck. Frontmatter tags take priority over inline tags for which one is
used to *display* the card's deck name.

### 2. Callouts become question/answer cards

```markdown
> [!card] What is the capital of France?
> Paris
```

The callout title becomes the front, the body becomes the back. Only
callouts of the configured type (`card` by default — change it in settings)
are turned into cards, so you can freely use `[!note]`, `[!warning]`, etc.
for regular annotations without them becoming flashcards.

Add the reverse emoji (🔁 by default) to also generate the reverse card:

```markdown
> [!card] Paris 🔁
> Capital of France
```

### 3. Highlight or bold text becomes a cloze card

Just mark the part of a sentence you want to be quizzed on:

```markdown
The ==mitochondria== is the powerhouse of the cell.
```

`**bold**` works the same way as `==highlight==`; both are on by default and
can be toggled independently in settings. Add a hint shown on the front of
the card with `^[hint text]`:

```markdown
The ==mitochondria==^[organelle] is the powerhouse of the cell.
```

A sentence with multiple clozes produces one card per cloze, each revealing
the others so you always see the sentence in context.

### 4. Clozes inside a callout

If a callout's body contains a cloze, it becomes cloze cards instead of a
single Q&A card — the title is ignored in that case:

```markdown
> [!card] Cell respiration
> The ==mitochondria== produces ==ATP== through cellular respiration.
```

## Reviewing

Click the layers icon in the ribbon, or open the command palette and run
**Review due cards**, to review everything that's due across your whole
vault. For each card:

- Reveal the answer with the button, `Space`, or `Enter`.
- Rate it **Again / Hard / Good / Easy** with the buttons or keys `1`–`4`.
- `Esc` ends the session early — everything you've already rated is saved.

Scheduling follows SM-2 (the same algorithm Anki popularized): a card you
rate "Again" comes back soon, "Easy" pushes it further out.

### Reviewing a single deck

Run **Browse decks to review** from the command palette to see every deck
(and subdeck) with a due count, and start a review scoped to just one of
them instead of everything. A card belonging to several deck tags shows
up under each of them, but — like always — is only ever reviewed once.

## Settings

| Setting | What it does |
| --- | --- |
| Deck tag root | The tag prefix that marks a note as containing cards (default `flashcards`). |
| Reverse emoji | Marks a callout card as reversible (default 🔁). |
| Callout type | Only callouts of this type become cards (default `card`). Other callout types are left alone. |
| Cloze: highlight / bold | Turn `==...==` and/or `**...**` recognition on or off independently. |
| Cloze scope | **Whole note** (default): highlighted/bold text anywhere counts. **Inside callouts only**: loose highlights elsewhere in the note are ignored — callouts are unaffected either way. |

## Current limitations

Flowcards is early-stage. Known rough edges:

- Settings changes don't survive an Obsidian restart yet.
- Multiple clozes sharing the same reference number aren't grouped onto a
  single card yet — each becomes its own card.
- No sidebar icon yet; use the command palette to start a review.
- Reviewing an entire note at once is intentionally not supported — cards
  are always reviewed individually.

## Design notes

- **Store only, no per-card frontmatter.** A note can hold several cards, so
  there's no clean 1:1 mapping onto note-level frontmatter or Bases rows.
  Per-card stats live in the plugin's own store instead; an optional
  read-only note-aggregate for Bases may come later.
- **Content-hash identity.** A card's hash is derived from its content, not
  its location — this is what makes renames/moves free and edits reset
  cleanly.
- **SM-2 today**, with an interface designed so a stronger algorithm (e.g.
  FSRS) can replace it later without touching the store format.

## Contributing / development

See `CLAUDE.md` for the internal architecture, module boundaries, and test
workflow.

## License

MIT
