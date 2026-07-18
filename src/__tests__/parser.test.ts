import { describe, it, expect } from "vitest";
import { parseNote, extractDeck, extractClozes, hasDeckTag } from "../parser";
import { cardHash } from "../hash";
import { DEFAULT_SETTINGS } from "../types";

const S = DEFAULT_SETTINGS;

describe("extractDeck", () => {
  it("reads a subtag path from inline tags", () => {
    const md = "some text #flashcards/network/suricata more";
    expect(extractDeck(md, S)).toBe("flashcards/network/suricata");
  });

  it("falls back to the root when no matching tag exists", () => {
    expect(extractDeck("no tags here", S)).toBe("flashcards");
  });

  it("reads from a frontmatter tag list", () => {
    const md = `---\ntags: [flashcards/os, other]\n---\nbody`;
    expect(extractDeck(md, S)).toBe("flashcards/os");
  });
});

describe("hasDeckTag", () => {
  it("true when an inline tag is present", () => {
    expect(hasDeckTag("some text #flashcards/network more", S)).toBe(true);
  });

  it("true when a frontmatter tag list contains the root", () => {
    const md = `---\ntags: [flashcards/os, other]\n---\nbody`;
    expect(hasDeckTag(md, S)).toBe(true);
  });

  it("false when no tag matches the root anywhere", () => {
    expect(hasDeckTag("no tags here, just prose", S)).toBe(false);
  });
});

describe("extractClozes", () => {
  it("finds highlight and bold clozes with hints and sequences when seq is allowed", () => {
    const found = extractClozes("==A==^[hintA] and **B**[^2]", S, true);
    expect(found.map((c) => c.answer)).toEqual(["A", "B"]);
    expect(found[0].hint).toBe("hintA");
    expect(found[1].seq).toBe("2");
  });

  it("ignores [^seq] entirely when seq is not allowed, leaving it as trailing text", () => {
    const text = "==A==^[hintA] and **B**[^2]";
    const found = extractClozes(text, S, false);
    expect(found.map((c) => c.answer)).toEqual(["A", "B"]);
    expect(found[0].hint).toBe("hintA");
    expect(found[1].seq).toBeUndefined();
    // the match itself must stop right after **B**, leaving "[^2]" untouched
    expect(text.slice(found[1].end)).toBe("[^2]");
  });
});

describe("parseNote — callouts", () => {
  it("turns a plain callout into a Q&A card (title front, body back)", () => {
    const md = `#flashcards/net\n\n> [!card] What is OSI layer 3?\n> Network — routing`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe("callout-qa");
    expect(cards[0].front).toBe("What is OSI layer 3?");
    expect(cards[0].back).toBe("Network — routing");
    expect(cards[0].deck).toBe("flashcards/net");
  });

  it("emits a second reversed card when the emoji is present", () => {
    const md = `#flashcards\n\n> [!card] Term 🔁\n> Definition`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(2);
    expect(cards[1].reverse).toBe(true);
    expect(cards[1].front).toBe("Definition");
    expect(cards[1].back).toBe("Term");
  });

  it("treats a callout body with clozes as cloze cards, not Q&A", () => {
    const md = `#flashcards\n\n> [!card] OSI 1\n> The ==physical== layer moves ==bits==`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.kind === "cloze")).toBe(true);
  });

  it("a note without any deck tag produces zero cards, even with callouts and clozes", () => {
    const md = `> [!card] Term 🔁\n> Definition\n\nThe ==physical== layer moves ==bits==.`;
    expect(parseNote(md, "n.md", S)).toEqual([]);
  });
});

describe("configurable callout type", () => {
  it("a non-matching callout type produces no card at default settings", () => {
    const md = `#flashcards\n\n> [!note] Term\n> Definition`;
    expect(parseNote(md, "n.md", S)).toEqual([]);
  });

  it("a custom callout type is recognized, and the old default is ignored", () => {
    const CUSTOM = { ...S, calloutType: "flashcard" };
    const md = `#flashcards\n\n> [!flashcard] Term\n> Definition\n\n> [!card] Ignored\n> Ignored`;
    const cards = parseNote(md, "n.md", CUSTOM);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe("Term");
  });

  it("type matching is case-insensitive", () => {
    const md = `#flashcards\n\n> [!CARD] Term\n> Definition`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(1);
  });
});

describe("cloze scope setting", () => {
  const CALLOUT_ONLY = { ...S, cloze: { ...S.cloze, scope: "callout-only" as const } };

  it("callout-only scope ignores clozes outside callouts", () => {
    const md = `#flashcards\n\nThe ==physical== layer moves ==bits==.`;
    expect(parseNote(md, "n.md", CALLOUT_ONLY)).toEqual([]);
  });

  it("callout-only scope still recognizes clozes inside a callout", () => {
    const md = `#flashcards\n\n> [!card] OSI 1\n> The ==physical== layer moves ==bits==`;
    const cards = parseNote(md, "n.md", CALLOUT_ONLY);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.kind === "cloze")).toBe(true);
  });

  it("callout-only scope leaves plain (non-cloze) callouts and unrelated prose untouched", () => {
    const md = `#flashcards\n\n> [!card] Term\n> Definition\n\nJust prose with **no** flashcard meaning here... wait, **no** is bold.`;
    // "no" is technically a bold cloze match, but callout-only scope must ignore it.
    const cards = parseNote(md, "n.md", CALLOUT_ONLY);
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe("callout-qa");
  });

  it("the default scope (anywhere) is unaffected — outside-callout clozes still work", () => {
    const md = `#flashcards\n\nThe ==physical== layer moves ==bits==.`;
    expect(parseNote(md, "n.md", S)).toHaveLength(2);
  });
});

describe("cloze seq-grouping (callout-only)", () => {
  it("two clozes sharing a seq inside a callout collapse into one card", () => {
    const md = `#flashcards\n\n> [!card] Water\n> Water contains ==Hydrogen==[^1] and ==Oxygen==[^1] atoms.`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe("Water contains [...] and [...] atoms.");
    expect(cards[0].back).toBe("Water contains Hydrogen and Oxygen atoms.");
  });

  it("the same [^seq]-shaped text outside a callout is neither grouped nor swallowed (footnote-safe)", () => {
    const md = `#flashcards\n\nWater contains ==Hydrogen==[^1] and ==Oxygen==[^1] atoms.`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(2); // NOT grouped -- sibling model, unaffected by this feature
    expect(cards[0].seq).toBeUndefined();
    expect(cards[0].back).toContain("[^1]"); // footnote-looking text preserved verbatim
  });

  it("hash stability: clozes without seq get the same hashes as before grouping existed", () => {
    const block = "The ==physical== layer moves ==bits==.";
    const md = `#flashcards\n\n${block}`;
    const cards = parseNote(md, "n.md", S);
    expect(cards[0].hash).toBe(cardHash(block, "cloze:0"));
    expect(cards[1].hash).toBe(cardHash(block, "cloze:1"));
  });

  it("a mixed callout block groups same-seq clozes but keeps a seq-less cloze independent", () => {
    const md = `#flashcards\n\n> [!card] Chem\n> ==A==[^1] and ==B==[^1] and ==C==.`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(2);
    expect(cards[0].front).toBe("[...] and [...] and C.");
    expect(cards[1].front).toBe("A and B and [...].");
  });

  it("a grouped card shows each blanked occurrence's own hint", () => {
    const md = `#flashcards\n\n> [!card] Chem\n> ==A==^[elementA][^1] and ==B==^[elementB][^1].`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe("[elementA] and [elementB].");
  });

  it("cross-step: a non-matching callout type with same-seq highlights produces no card at all", () => {
    const md = `#flashcards\n\n> [!note] Chem\n> ==A==[^1] and ==B==[^1].`;
    expect(parseNote(md, "n.md", S)).toEqual([]);
  });
});

describe("card context (nearest heading)", () => {
  it("a card under a heading gets that heading as context", () => {
    const md = `#flashcards\n\n## Cell biology\n\n> [!card] Term\n> Definition`;
    const cards = parseNote(md, "n.md", S);
    expect(cards[0].context).toBe("Cell biology");
  });

  it("a card with no heading anywhere falls back to the note's filename", () => {
    const md = `#flashcards\n\n> [!card] Term\n> Definition`;
    const cards = parseNote(md, "folder/My Note.md", S);
    expect(cards[0].context).toBe("My Note");
  });

  it("a card under the second of two headings gets the nearer one", () => {
    const md = `#flashcards\n\n## First\n\nSome text.\n\n## Second\n\n> [!card] Term\n> Definition`;
    const cards = parseNote(md, "n.md", S);
    expect(cards[0].context).toBe("Second");
  });

  it("works for cloze cards outside a callout too", () => {
    const md = `#flashcards\n\n## Geography\n\nThe capital of France is ==Paris==.`;
    const cards = parseNote(md, "n.md", S);
    expect(cards[0].context).toBe("Geography");
  });
});

describe("parseNote — inline clozes", () => {
  it("produces one sibling card per cloze, back reveals all", () => {
    const md = `#flashcards\n\nThe ==physical== layer moves ==bits==.`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(2);
    expect(cards[0].front).toContain("[...]");
    expect(cards[0].front).toContain("bits"); // sibling revealed
    expect(cards[0].back).toBe("The physical layer moves bits.");
  });

  it("uses the hint on the front when present", () => {
    const md = `#flashcards\n\nBrazilians speak ==Portuguese==^[language].`;
    const cards = parseNote(md, "n.md", S);
    expect(cards[0].front).toContain("[language]");
  });
});
