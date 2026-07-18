// Content hashing for card identity.
//
// Constraints that dictate the choice:
//  - Must run on Obsidian Mobile => no Node `crypto`, no reliance on WebCrypto.
//  - Must be synchronous => the parser runs on render; async hashing is a pain.
//  - Non-cryptographic is fine => we only need content identity, not security.
//
// cyrb53 gives a well-distributed 53-bit hash, is tiny, sync, and dependency-free.

export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Normalization is the real tuning knob for "reset on change".
 * Conservative on purpose: only line-ending, trailing-whitespace and edge trim.
 * Widen this later (collapse internal whitespace, strip emphasis) if too many
 * trivial edits cause resets — but beware merging near-identical cards.
 */
export function normalize(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * Card identity. `discriminator` folds in whatever distinguishes cards derived
 * from the same block (e.g. cloze index / reverse direction) so siblings don't
 * collide.
 */
export function cardHash(content: string, discriminator = ""): string {
  return cyrb53(normalize(content) + "\u0000" + discriminator).toString(16);
}
