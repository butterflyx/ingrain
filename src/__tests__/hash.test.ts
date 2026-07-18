import { describe, it, expect } from "vitest";
import { cardHash, normalize } from "../hash";

describe("normalize", () => {
  it("ignores line-ending and trailing-whitespace differences", () => {
    expect(normalize("a\r\nb  ")).toBe(normalize("a\nb"));
  });
});

describe("cardHash", () => {
  it("is stable for identical content", () => {
    expect(cardHash("Physical layer")).toBe(cardHash("Physical layer"));
  });

  it("is stable across trivial whitespace edits (conservative normalize)", () => {
    expect(cardHash("Physical layer  \n")).toBe(cardHash("Physical layer"));
  });

  it("changes when learnable content changes -> drives reset-on-change", () => {
    expect(cardHash("Physical layer")).not.toBe(cardHash("Physical layerz"));
  });

  it("separates siblings via discriminator", () => {
    expect(cardHash("block", "cloze:0")).not.toBe(cardHash("block", "cloze:1"));
  });
});
