import { afterEach, describe, expect, it, vi } from "vitest";
import { getYouTubeVideoStatistics, sanitizeYouTubeDescription, sanitizeYouTubeTitle } from "../src/youtube-client.js";

afterEach(() => vi.unstubAllGlobals());

describe("sanitizeYouTubeTitle", () => {
  it("removes characters forbidden by YouTube", () => {
    expect(sanitizeYouTubeTitle("ББ ГАМОС<3 > финал")).toBe("ББ ГАМОС3 финал");
  });

  it("normalizes whitespace and provides a safe fallback", () => {
    expect(sanitizeYouTubeTitle("  hello\n   world  ")).toBe("hello world");
    expect(sanitizeYouTubeTitle("<>")).toBe("Stream highlight");
  });

  it("limits titles to one hundred characters", () => {
    expect(sanitizeYouTubeTitle("a".repeat(120))).toHaveLength(100);
  });
});

describe("sanitizeYouTubeDescription", () => {
  it("removes angle brackets while preserving line breaks", () => {
    expect(sanitizeYouTubeDescription("ББ ГАМОС<3\nTwitch: inkmate0")).toBe("ББ ГАМОС3\nTwitch: inkmate0");
  });
});

describe("getYouTubeVideoStatistics", () => {
  it("returns the current title from the YouTube snippet", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      items: [{
        id: "video-1",
        snippet: { title: "Актуальный заголовок", description: "Описание", publishedAt: "2026-09-20T10:00:00Z" },
        statistics: { viewCount: "120", likeCount: "8", commentCount: "2" },
        status: { privacyStatus: "public" },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getYouTubeVideoStatistics("token", ["video-1"])).resolves.toEqual([{
      id: "video-1",
      title: "Актуальный заголовок",
      description: "Описание",
      publishedAt: new Date("2026-09-20T10:00:00Z"),
      views: 120n,
      likes: 8n,
      comments: 2n,
      privacyStatus: "public",
    }]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("part=snippet,statistics,status");
  });
});
