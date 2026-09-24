import { describe, expect, it } from "vitest";
import { calculateClipGrowth } from "../src/metrics.js";

describe("calculateClipGrowth", () => {
  const now = new Date("2026-09-17T12:00:00Z");

  it("calculates velocity and rolling view growth", () => {
    const growth = calculateClipGrowth(220, now, [
      { recordedAt: new Date("2026-09-17T11:55:00Z"), views: 200, viewsPerMinute: 2 },
      { recordedAt: new Date("2026-09-17T11:45:00Z"), views: 160, viewsPerMinute: 1.5 },
      { recordedAt: new Date("2026-09-17T11:00:00Z"), views: 100, viewsPerMinute: 1 },
    ]);

    expect(growth.viewsPerMinute).toBe(4);
    expect(growth.viewsLast5Minutes).toBe(20);
    expect(growth.viewsLast15Minutes).toBe(60);
    expect(growth.viewsLast60Minutes).toBe(120);
    expect(growth.acceleration).toBe(0.4);
  });

  it("returns null windows until enough history exists", () => {
    expect(calculateClipGrowth(10, now, [])).toEqual({
      viewsPerMinute: null,
      viewsLast5Minutes: null,
      viewsLast15Minutes: null,
      viewsLast60Minutes: null,
      acceleration: null,
    });
  });
});
