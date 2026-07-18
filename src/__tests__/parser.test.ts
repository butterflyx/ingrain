import { describe, it, expect } from "vitest";
import { parseNote, extractDeck, extractClozes } from "../parser";
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

describe("extractClozes", () => {
  it("finds highlight and bold clozes with hints and sequences", () => {
    const found = extractClozes("==A==^[hintA] and **B**[^2]", S);
    expect(found.map((c) => c.answer)).toEqual(["A", "B"]);
    expect(found[0].hint).toBe("hintA");
    expect(found[1].seq).toBe("2");
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
    const md = `> [!card] Term 🔁\n> Definition`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(2);
    expect(cards[1].reverse).toBe(true);
    expect(cards[1].front).toBe("Definition");
    expect(cards[1].back).toBe("Term");
  });

  it("treats a callout body with clozes as cloze cards, not Q&A", () => {
    const md = `> [!card] OSI 1\n> The ==physical== layer moves ==bits==`;
    const cards = parseNote(md, "n.md", S);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.kind === "cloze")).toBe(true);
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
    const md = `Brazilians speak ==Portuguese==^[language].`;
    const cards = parseNote(md, "n.md", S);
    expect(cards[0].front).toContain("[language]");
  });
});
