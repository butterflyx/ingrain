import { Card, FlowcardsSettings } from "./types";
import { cardHash } from "./hash";

// PURE parser: string in, Card[] out. No "obsidian" import — fully vitest-able.
// This is deliberately a well-tested SUBSET of the target feature list; the
// clearly-marked TODOs are where the remaining checklist items land.

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

interface ClozeMatch {
  start: number;
  end: number;
  answer: string;
  hint?: string;
  seq?: string;
}

/** Strip frontmatter, returning body + the raw frontmatter block (may be ""). */
function splitFrontmatter(md: string): { body: string; fm: string } {
  const m = md.match(FRONTMATTER);
  if (!m) return { body: md, fm: "" };
  return { body: md.slice(m[0].length), fm: m[1] };
}

/** Collect every tag under the configured root, from frontmatter `tags:` and
 *  inline `#tags` alike. Shared by extractDeck() and hasDeckTag() so the two
 *  never drift out of sync on what counts as "tagged". */
function findDeckTags(md: string, settings: FlowcardsSettings): Set<string> {
  const root = settings.deckTagRoot;
  const tags = new Set<string>();

  const { fm, body } = splitFrontmatter(md);
  for (const line of fm.split("\n")) {
    const t = line.trim().replace(/^-\s*/, "").replace(/^["']|["']$/g, "");
    if (t.startsWith(root)) tags.add(t.replace(/^#/, ""));
    const listMatch = line.match(/tags:\s*\[(.*)\]/);
    if (listMatch) {
      for (const raw of listMatch[1].split(",")) {
        const c = raw.trim().replace(/^["']|["']$/g, "").replace(/^#/, "");
        if (c.startsWith(root)) tags.add(c);
      }
    }
  }
  const inline = body.matchAll(/(?:^|\s)#([\w/]+)/g);
  for (const m of inline) if (m[1].startsWith(root)) tags.add(m[1]);

  return tags;
}

/**
 * Deck = the first tag under the configured root, full path preserved.
 * Looks in both frontmatter `tags:` and inline `#tags`. Subtag hierarchy
 * (tag/subtag) is preserved verbatim so the review layer can build the tree.
 */
export function extractDeck(md: string, settings: FlowcardsSettings): string {
  const tags = findDeckTags(md, settings);
  return tags.size ? [...tags][0] : settings.deckTagRoot;
}

/**
 * True iff the note carries the configured deck-tag-root anywhere
 * (frontmatter tag list or inline #tag). Gates parseNote(): a note without
 * this tag produces zero cards, regardless of callouts/clozes present — this
 * is the actual opt-in that scopes Flowcards to notes the user marked for
 * spaced repetition, rather than any note that happens to contain a
 * highlight or a callout.
 */
export function hasDeckTag(md: string, settings: FlowcardsSettings): boolean {
  return findDeckTags(md, settings).size > 0;
}

/** Find `==answer==` / `**answer**` clozes with optional ^[hint] and [^seq]. */
export function extractClozes(text: string, settings: FlowcardsSettings): ClozeMatch[] {
  const patterns: RegExp[] = [];
  if (settings.cloze.highlight)
    patterns.push(/==([^=]+?)==(?:\^\[([^\]]+)\])?(?:\[\^([^\]]+)\])?/g);
  if (settings.cloze.bold)
    patterns.push(/\*\*([^*]+?)\*\*(?:\^\[([^\]]+)\])?(?:\[\^([^\]]+)\])?/g);

  const found: ClozeMatch[] = [];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      found.push({
        start: m.index!,
        end: m.index! + m[0].length,
        answer: m[1],
        hint: m[2],
        seq: m[3],
      });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Render a block with one target cloze blanked and the rest revealed. */
function renderCloze(text: string, clozes: ClozeMatch[], target: number | null): string {
  let out = "";
  let cursor = 0;
  clozes.forEach((c, i) => {
    out += text.slice(cursor, c.start);
    if (target !== null && i === target) out += c.hint ? `[${c.hint}]` : "[...]";
    else out += c.answer; // revealed, markers stripped
    cursor = c.end;
  });
  out += text.slice(cursor);
  return out.trim();
}

function clozeCards(block: string, deck: string, notePath: string, settings: FlowcardsSettings): Card[] {
  const clozes = extractClozes(block, settings);
  if (!clozes.length) return [];
  const back = renderCloze(block, clozes, null);
  // v1: sibling model — one card per cloze. TODO: group by `seq`, honour
  // Generalized Overlapping actions to hide siblings instead of showing them.
  return clozes.map((c, i) => ({
    hash: cardHash(block, `cloze:${i}`),
    notePath,
    deck,
    kind: "cloze" as const,
    front: renderCloze(block, clozes, i),
    back,
    reverse: false,
    clozeIndex: i,
    hint: c.hint,
    seq: c.seq,
    sourceBlock: block,
  }));
}

interface Callout {
  title: string;
  body: string;
  raw: string;
}

/** Extract `> [!type] Title` + `> body` callout blocks whose type matches
 *  settings.calloutType (case-insensitive). Non-matching callout types
 *  (e.g. [!note], [!warning]) are fully skipped — they never become cards. */
export function findCallouts(body: string, settings: FlowcardsSettings): Callout[] {
  const wantedType = settings.calloutType.toLowerCase();
  const lines = body.split("\n");
  const callouts: Callout[] = [];
  let i = 0;
  while (i < lines.length) {
    const head = lines[i].match(/^>\s*\[!([\w-]+)\][+-]?\s*(.*)$/);
    if (!head) {
      i++;
      continue;
    }
    const type = head[1].toLowerCase();
    const title = head[2].trim();
    const bodyLines: string[] = [];
    const rawLines = [lines[i]];
    i++;
    while (i < lines.length && /^>/.test(lines[i])) {
      rawLines.push(lines[i]);
      bodyLines.push(lines[i].replace(/^>\s?/, ""));
      i++;
    }
    if (type === wantedType) {
      callouts.push({ title, body: bodyLines.join("\n").trim(), raw: rawLines.join("\n") });
    }
  }
  return callouts;
}

function calloutCards(c: Callout, deck: string, notePath: string, settings: FlowcardsSettings): Card[] {
  // If the body carries clozes, it's a cloze card, not Q&A.
  const inner = clozeCards(c.body, deck, notePath, settings);
  if (inner.length) return inner;

  const reverse = c.title.includes(settings.reverseEmoji) || c.body.includes(settings.reverseEmoji);
  const strip = (s: string) => s.replaceAll(settings.reverseEmoji, "").trim();
  const front = strip(c.title);
  const back = strip(c.body);

  const cards: Card[] = [
    {
      hash: cardHash(c.title + "\n" + c.body, "qa"),
      notePath,
      deck,
      kind: "callout-qa",
      front,
      back,
      reverse,
      sourceBlock: c.raw,
    },
  ];
  if (reverse) {
    cards.push({
      hash: cardHash(c.title + "\n" + c.body, "qa-rev"),
      notePath,
      deck,
      kind: "callout-qa",
      front: back,
      back: front,
      reverse: true,
      sourceBlock: c.raw,
    });
  }
  return cards;
}

/** Top-level entry point. */
export function parseNote(md: string, notePath: string, settings: FlowcardsSettings): Card[] {
  if (!hasDeckTag(md, settings)) return [];
  const deck = extractDeck(md, settings);
  const { body } = splitFrontmatter(md);
  const cards: Card[] = [];

  const callouts = findCallouts(body, settings);
  for (const c of callouts) cards.push(...calloutCards(c, deck, notePath, settings));

  // Clozes outside callouts: split remaining text into blank-line blocks,
  // skip anything that was inside a callout, keep blocks that contain clozes.
  // Gated by settings.cloze.scope — "callout-only" skips this entirely,
  // leaving clozes inside callouts (handled above via calloutCards) as the
  // only way to create cloze cards.
  if (settings.cloze.scope !== "callout-only") {
    const calloutRaw = new Set(callouts.map((c) => c.raw));
    const blocks = body.split(/\n\s*\n/);
    for (const block of blocks) {
      if ([...calloutRaw].some((raw) => raw.includes(block.trim()) && block.trim())) continue;
      if (/^>\s*\[!/.test(block.trim())) continue;
      cards.push(...clozeCards(block.trim(), deck, notePath, settings));
    }
  }

  return cards;
}
