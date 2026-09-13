// Pure. Never import "obsidian" -- see CLAUDE.md architecture boundary.
//
// rebuildIndex() re-reads and re-parses every markdown file in the vault on
// every plugin load, which is the confirmed root cause of slow indexing on
// large vaults (see CLAUDE.local.md "Performance" backlog). This module
// decides, for a given file, whether its last-parsed Card[] can be reused
// instead of re-reading + re-parsing it -- gated on two things staying
// unchanged: the file's mtime, and a fingerprint of the settings that affect
// parsing. main.ts owns the actual read/parse orchestration; everything here
// is pure data-in/data-out so it can be tested headless.

import { Card, FileCache, IngrainSettings } from "./types";

/** Fingerprint of exactly the settings fields that affect parseNote()'s
 *  output. Deliberately excludes reminderIntervalDays -- changing the
 *  reminder interval must not force a full vault reparse. */
export function computeFingerprint(settings: IngrainSettings): string {
  return JSON.stringify([
    settings.deckTagRoot,
    settings.reverseEmoji,
    settings.calloutType,
    settings.cloze.highlight,
    settings.cloze.bold,
    settings.cloze.scope,
  ]);
}

/** Reuses `cache` as-is if its fingerprint still matches; otherwise starts a
 *  fresh, empty cache (a parsing-relevant setting changed, or there's no
 *  cache yet -- e.g. a data.json saved before this field existed). */
export function withFingerprint(cache: FileCache | undefined, fingerprint: string): FileCache {
  return cache && cache.fingerprint === fingerprint ? cache : { fingerprint, files: {} };
}

/** Returns the cached Card[] for `path` only if the cache's fingerprint and
 *  the entry's mtime both still match -- undefined otherwise (cache miss).
 *  Re-checks the fingerprint itself so it's correct independent of whether
 *  the caller already resolved it via withFingerprint(). */
export function getCachedCards(
  cache: FileCache | undefined,
  path: string,
  mtime: number,
  fingerprint: string,
): Card[] | undefined {
  if (!cache || cache.fingerprint !== fingerprint) return undefined;
  const entry = cache.files[path];
  return entry && entry.mtime === mtime ? entry.cards : undefined;
}

/** Immutable: records a fresh parse result for `path`, without touching any
 *  other path's entry. */
export function withEntry(cache: FileCache, path: string, mtime: number, cards: Card[]): FileCache {
  return { ...cache, files: { ...cache.files, [path]: { mtime, cards } } };
}

/** Immutable: drops the entry for `path`, e.g. after a rename (the old
 *  path's entry can't be safely reused under the new path -- see
 *  CLAUDE.local.md). No-op if the path isn't cached. */
export function withoutPath(cache: FileCache, path: string): FileCache {
  if (!(path in cache.files)) return cache;
  const { [path]: _removed, ...rest } = cache.files;
  return { ...cache, files: rest };
}

/** Immutable: keeps only entries whose path is still in `livePaths` --
 *  drops cache entries for files that no longer exist in the vault. */
export function pruneToPaths(cache: FileCache, livePaths: Set<string>): FileCache {
  const files: FileCache["files"] = {};
  for (const [path, entry] of Object.entries(cache.files)) {
    if (livePaths.has(path)) files[path] = entry;
  }
  return { ...cache, files };
}
