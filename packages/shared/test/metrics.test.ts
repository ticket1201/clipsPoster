import { describe, expect, it } from "vitest";
import { calculateViralScore } from "../src/metrics.js";

describe("calculateViralScore", () => {
  const observedAt = new Date("2026-09-17T12:00:00Z");

  it("rewards fresh clips with strong velocity and acceleration", () => {
    const score = calculateViralScore({
      views: 2_000,
      viewsPerMinute: 30,
      acceleration: 3,
      sourceCreatedAt: new Date("2026-09-17T11:00:00Z"),
      observedAt,
    });
    expect(score).toBeGreaterThan(75);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("penalizes old clips without current growth", () => {
    const score = calculateViralScore({
      views: 2_000,
      viewsPerMinute: 0,
      acceleration: 0,
      sourceCreatedAt: new Date("2026-09-14T12:00:00Z"),
      observedAt,
    });
    expect(score).toBeLessThan(25);
  });

  it("clamps invalid negative signals", () => {
    expect(calculateViralScore({
      views: -1,
      viewsPerMinute: -10,
      acceleration: -2,
      sourceCreatedAt: observedAt,
      observedAt,
    })).toBe(20);
  });
});
