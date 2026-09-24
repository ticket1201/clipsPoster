import { describe, expect, it } from "vitest";
import { isFreshClip } from "../src/index.js";

describe("isFreshClip", () => {
  const now = new Date("2026-09-10T12:00:00Z");

  it("accepts clips from the last 24 hours", () => {
    expect(isFreshClip(new Date("2026-09-09T12:00:01Z"), now)).toBe(true);
  });

  it("rejects older clips", () => {
    expect(isFreshClip(new Date("2026-09-09T11:59:59Z"), now)).toBe(false);
  });
});
