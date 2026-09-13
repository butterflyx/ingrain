import { describe, it, expect } from "vitest";
import {
  computeFingerprint,
  withFingerprint,
  getCachedCards,
  withEntry,
  withoutPath,
  pruneToPaths,
} from "../indexCache";
import { Card, FileCache, IngrainSettings, DEFAULT_SETTINGS } from "../types";

function card(hash: string): Card {
  return {
    hash,
    notePath: "n.md",
    deck: "flashcards",
    decks: ["flashcards"],
    kind: "basic",
    front: "f",
    back: "b",
    reverse: false,
    sourceBlock: "src",
    context: "note",
  };
}

function settings(overrides: Partial<IngrainSettings> = {}): IngrainSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    cloze: { ...DEFAULT_SETTINGS.cloze, ...overrides.cloze },
  };
}

describe("computeFingerprint", () => {
  it("produces the same fingerprint for identical settings", () => {
    expect(computeFingerprint(settings())).toBe(computeFingerprint(settings()));
  });

  it("produces a different fingerprint when deckTagRoot differs", () => {
    expect(computeFingerprint(settings({ deckTagRoot: "other" }))).not.toBe(
      computeFingerprint(settings()),
    );
  });

  it("produces a different fingerprint when reverseEmoji differs", () => {
    expect(computeFingerprint(settings({ reverseEmoji: "⏪" }))).not.toBe(
      computeFingerprint(settings()),
    );
  });

  it("produces a different fingerprint when calloutType differs", () => {
    expect(computeFingerprint(settings({ calloutType: "flashcard" }))).not.toBe(
      computeFingerprint(settings()),
    );
  });

  it("produces a different fingerprint when cloze.highlight differs", () => {
    expect(computeFingerprint(settings({ cloze: { ...DEFAULT_SETTINGS.cloze, highlight: false } }))).not.toBe(
      computeFingerprint(settings()),
    );
  });

  it("produces a different fingerprint when cloze.bold differs", () => {
    expect(computeFingerprint(settings({ cloze: { ...DEFAULT_SETTINGS.cloze, bold: false } }))).not.toBe(
      computeFingerprint(settings()),
    );
  });

  it("produces a different fingerprint when cloze.scope differs", () => {
    expect(
      computeFingerprint(settings({ cloze: { ...DEFAULT_SETTINGS.cloze, scope: "callout-only" } })),
    ).not.toBe(computeFingerprint(settings()));
  });

  it("produces the SAME fingerprint when only reminderIntervalDays differs", () => {
    expect(computeFingerprint(settings({ reminderIntervalDays: 7 }))).toBe(
      computeFingerprint(settings({ reminderIntervalDays: 0 })),
    );
  });
});

describe("withFingerprint", () => {
  const fp = computeFingerprint(settings());

  it("returns the given cache unchanged when its fingerprint matches", () => {
    const cache: FileCache = { fingerprint: fp, files: { "n.md": { mtime: 1, cards: [card("a")] } } };
    expect(withFingerprint(cache, fp)).toBe(cache);
  });

  it("returns a fresh empty cache when the fingerprint differs", () => {
    const cache: FileCache = { fingerprint: "old", files: { "n.md": { mtime: 1, cards: [card("a")] } } };
    expect(withFingerprint(cache, fp)).toEqual({ fingerprint: fp, files: {} });
  });

  it("returns a fresh empty cache when given undefined", () => {
    expect(withFingerprint(undefined, fp)).toEqual({ fingerprint: fp, files: {} });
  });
});

describe("getCachedCards", () => {
  const fp = computeFingerprint(settings());
  const cache: FileCache = { fingerprint: fp, files: { "n.md": { mtime: 100, cards: [card("a")] } } };

  it("returns the cached cards when path, mtime, and fingerprint all match", () => {
    expect(getCachedCards(cache, "n.md", 100, fp)).toEqual([card("a")]);
  });

  it("returns undefined when the path isn't in the cache", () => {
    expect(getCachedCards(cache, "other.md", 100, fp)).toBeUndefined();
  });

  it("returns undefined when mtime differs from the cached entry", () => {
    expect(getCachedCards(cache, "n.md", 999, fp)).toBeUndefined();
  });

  it("returns undefined when the fingerprint differs, even if mtime matches", () => {
    expect(getCachedCards(cache, "n.md", 100, "different-fp")).toBeUndefined();
  });

  it("returns undefined when cache itself is undefined", () => {
    expect(getCachedCards(undefined, "n.md", 100, fp)).toBeUndefined();
  });
});

describe("withEntry", () => {
  const fp = computeFingerprint(settings());

  it("adds a new entry without mutating the input cache", () => {
    const cache: FileCache = { fingerprint: fp, files: {} };
    const next = withEntry(cache, "n.md", 100, [card("a")]);
    expect(next.files["n.md"]).toEqual({ mtime: 100, cards: [card("a")] });
    expect(cache.files["n.md"]).toBeUndefined();
  });

  it("overwrites an existing entry for the same path", () => {
    const cache: FileCache = { fingerprint: fp, files: { "n.md": { mtime: 1, cards: [card("a")] } } };
    const next = withEntry(cache, "n.md", 2, [card("b")]);
    expect(next.files["n.md"]).toEqual({ mtime: 2, cards: [card("b")] });
  });

  it("leaves other paths' entries untouched", () => {
    const cache: FileCache = { fingerprint: fp, files: { "other.md": { mtime: 1, cards: [card("a")] } } };
    const next = withEntry(cache, "n.md", 2, [card("b")]);
    expect(next.files["other.md"]).toEqual({ mtime: 1, cards: [card("a")] });
  });
});

describe("withoutPath", () => {
  const fp = computeFingerprint(settings());

  it("removes the entry for the given path", () => {
    const cache: FileCache = { fingerprint: fp, files: { "n.md": { mtime: 1, cards: [card("a")] } } };
    expect(withoutPath(cache, "n.md").files["n.md"]).toBeUndefined();
  });

  it("is a no-op when the path isn't present", () => {
    const cache: FileCache = { fingerprint: fp, files: { "other.md": { mtime: 1, cards: [card("a")] } } };
    expect(withoutPath(cache, "n.md")).toBe(cache);
  });

  it("does not mutate the input cache", () => {
    const cache: FileCache = { fingerprint: fp, files: { "n.md": { mtime: 1, cards: [card("a")] } } };
    withoutPath(cache, "n.md");
    expect(cache.files["n.md"]).toBeDefined();
  });
});

describe("pruneToPaths", () => {
  const fp = computeFingerprint(settings());

  it("drops entries for paths not in the live set", () => {
    const cache: FileCache = {
      fingerprint: fp,
      files: { "a.md": { mtime: 1, cards: [] }, "b.md": { mtime: 1, cards: [] } },
    };
    const pruned = pruneToPaths(cache, new Set(["a.md"]));
    expect(pruned.files["b.md"]).toBeUndefined();
  });

  it("keeps entries for paths in the live set", () => {
    const cache: FileCache = { fingerprint: fp, files: { "a.md": { mtime: 1, cards: [] } } };
    const pruned = pruneToPaths(cache, new Set(["a.md"]));
    expect(pruned.files["a.md"]).toEqual({ mtime: 1, cards: [] });
  });

  it("does not mutate the input cache", () => {
    const cache: FileCache = {
      fingerprint: fp,
      files: { "a.md": { mtime: 1, cards: [] }, "b.md": { mtime: 1, cards: [] } },
    };
    pruneToPaths(cache, new Set(["a.md"]));
    expect(cache.files["b.md"]).toBeDefined();
  });
});
