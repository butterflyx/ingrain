import { describe, it, expect } from "vitest";
import { initialState, schedule, isDue, coordinateSiblingDue } from "../scheduler";

const now = new Date("2026-07-13T00:00:00Z");

describe("scheduler (SM-2)", () => {
  it("starts due immediately with default ease", () => {
    const s = initialState("h", "n.md", now);
    expect(s.ease).toBe(2.5);
    expect(isDue(s, now)).toBe(true);
  });

  it("graduates 1 -> 6 -> interval*ease on repeated Good", () => {
    let s = initialState("h", "n.md", now);
    s = schedule(s, 3, now);
    expect(s.interval).toBe(1);
    s = schedule(s, 3, now);
    expect(s.interval).toBe(6);
    s = schedule(s, 3, now);
    expect(s.interval).toBe(Math.round(6 * 2.5));
  });

  it("Again lapses, resets reps and lowers ease", () => {
    let s = initialState("h", "n.md", now);
    s = schedule(s, 3, now);
    s = schedule(s, 1, now);
    expect(s.reps).toBe(0);
    expect(s.lapses).toBe(1);
    expect(s.interval).toBe(1);
    expect(s.ease).toBeCloseTo(2.3);
  });

  it("never mutates the input state", () => {
    const s = initialState("h", "n.md", now);
    const before = JSON.stringify(s);
    schedule(s, 4, now);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("logs every review", () => {
    let s = initialState("h", "n.md", now);
    s = schedule(s, 3, now);
    s = schedule(s, 2, now);
    expect(s.reviewLog).toHaveLength(2);
    expect(s.reviewLog[1].rating).toBe(2);
  });
});

describe("coordinateSiblingDue", () => {
  it("sets the sibling's due to the just-reviewed card's new due", () => {
    const sibling = initialState("sib", "n.md", now);
    const updated = schedule(initialState("main", "n.md", now), 3, now);
    const result = coordinateSiblingDue(sibling, updated);
    expect(result.due).toBe(updated.due);
  });

  it("leaves the sibling's own scheduling history untouched", () => {
    let sibling = initialState("sib", "n.md", now);
    sibling = schedule(sibling, 4, now); // sibling has its own independent history
    const updated = schedule(initialState("main", "n.md", now), 1, now);
    const result = coordinateSiblingDue(sibling, updated);
    expect(result.ease).toBe(sibling.ease);
    expect(result.reps).toBe(sibling.reps);
    expect(result.lapses).toBe(sibling.lapses);
    expect(result.reviewLog).toEqual(sibling.reviewLog);
  });

  it("does not mutate either input", () => {
    const sibling = initialState("sib", "n.md", now);
    const updated = schedule(initialState("main", "n.md", now), 3, now);
    const siblingBefore = JSON.stringify(sibling);
    const updatedBefore = JSON.stringify(updated);
    coordinateSiblingDue(sibling, updated);
    expect(JSON.stringify(sibling)).toBe(siblingBefore);
    expect(JSON.stringify(updated)).toBe(updatedBefore);
  });
});
