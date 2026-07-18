import { describe, expect, it } from "vitest";
import { strings, t } from "../i18n";

describe("t", () => {
  it("returns the English string for a known key", () => {
    expect(t("en", "close")).toBe("Close");
  });

  it("returns the German translation for a known key", () => {
    expect(t("de", "close")).toBe("Schließen");
  });

  it("falls back to English for an unknown locale", () => {
    expect(t("fr", "close")).toBe(t("en", "close"));
  });

  it("interpolates {placeholder} vars", () => {
    expect(t("en", "reviewedCount", { count: 5 })).toBe("Reviewed 5 card(s).");
  });

  it("interpolates vars in the German string too", () => {
    expect(t("de", "reviewedCount", { count: 5 })).toContain("5");
  });

  it("has a German translation for every English key", () => {
    for (const key of Object.keys(strings.en)) {
      expect(strings.de[key as keyof typeof strings.en]).toBeDefined();
    }
  });
});
