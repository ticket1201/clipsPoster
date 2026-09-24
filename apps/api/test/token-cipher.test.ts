import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../src/token-cipher.js";

describe("TikTok token cipher", () => {
  it("round-trips a token without storing it as plain text", () => {
    const token = "act.secret-token";
    const encrypted = encryptToken(token, "a-development-key-that-is-long-enough");

    expect(encrypted).not.toContain(token);
    expect(decryptToken(encrypted, "a-development-key-that-is-long-enough")).toBe(token);
  });

  it("rejects decryption with a different key", () => {
    const encrypted = encryptToken("act.secret-token", "the-first-key-is-long-enough-for-testing");

    expect(() => decryptToken(encrypted, "a-different-key-that-is-also-long-enough")).toThrow();
  });
});
