import { describe, expect, it, vi } from "vitest";
import { KickClient, normalizeKickSlug } from "../src/index.js";

describe("KickClient", () => {
  it("normalizes channel slugs", () => {
    expect(normalizeKickSlug(" @XQC ")).toBe("xqc");
  });

  it("rejects invalid channel slugs", () => {
    expect(() => normalizeKickSlug("https://kick.com/xqc")).toThrow("Invalid Kick channel slug");
  });

  it("parses fresh clips from the experimental web endpoint", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          clips: [
            {
              id: "clip_123",
              title: "Example",
              clip_url: "https://clips.kick.com/example.m3u8",
              thumbnail_url: "https://clips.kick.com/example.webp",
              view_count: 42,
              duration: 30,
              created_at: "2026-09-17T10:00:00Z",
              category: { id: 1552, name: "Counter-Strike 2", slug: "counter-strike-2" },
              channel: { id: 668, username: "xQc", slug: "xqc" },
              creator: { id: 10, username: "viewer", slug: "viewer" },
            },
          ],
          nextCursor: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new KickClient(undefined, request);

    const result = await client.getFreshClips("XQC");

    expect(result.clips[0]?.id).toBe("clip_123");
    expect(result.clips[0]?.view_count).toBe(42);
    expect(result.clips[0]?.category?.name).toBe("Counter-Strike 2");
    expect(request).toHaveBeenCalledOnce();
  });

  it("caches app access tokens", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 }),
    );
    const client = new KickClient({ clientId: "id", clientSecret: "secret" }, request);

    await expect(client.getAppAccessToken()).resolves.toBe("token");
    await expect(client.getAppAccessToken()).resolves.toBe("token");
    expect(request).toHaveBeenCalledOnce();
  });
});
