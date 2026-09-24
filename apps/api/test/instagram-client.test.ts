import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInstagramReelContainer,
  getInstagramContainerStatus,
} from "../src/instagram-client.js";
import type { InstagramApiError } from "../src/instagram-client.js";

afterEach(() => vi.restoreAllMocks());

describe("Instagram publishing client", () => {
  it("creates a public Reel container with the expected metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "container-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(createInstagramReelContainer(
      "access-token",
      "v25.0",
      "ig-user-1",
      "https://example.com/video.mp4",
      "Clip caption",
    )).resolves.toBe("container-1");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://graph.instagram.com/v25.0/ig-user-1/media");
    expect(String(init?.body)).toContain("media_type=REELS");
    expect(String(init?.body)).toContain("share_to_feed=true");
    expect(String(init?.body)).toContain("video_url=https%3A%2F%2Fexample.com%2Fvideo.mp4");
  });

  it("surfaces Graph API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Invalid token", code: 190 },
    }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }));

    await expect(getInstagramContainerStatus("bad-token", "v25.0", "container-1"))
      .rejects.toEqual(expect.objectContaining<Partial<InstagramApiError>>({
        name: "InstagramApiError",
        message: "Invalid token",
        status: 401,
        code: "190",
      }));
  });
});
