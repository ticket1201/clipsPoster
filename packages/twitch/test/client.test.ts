import { describe, expect, it, vi } from "vitest";
import { normalizeTwitchLogin, TwitchClient } from "../src/index.js";

describe("TwitchClient", () => {
  it("normalizes channel logins", () => {
    expect(normalizeTwitchLogin(" @TwitchDev ")).toBe("twitchdev");
  });

  it("rejects URLs as channel logins", () => {
    expect(() => normalizeTwitchLogin("https://twitch.tv/twitchdev")).toThrow("Invalid Twitch channel login");
  });

  it("gets a user and reuses the app access token", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{
        id: "141981764",
        login: "twitchdev",
        display_name: "TwitchDev",
        profile_image_url: "https://example.com/avatar.png",
      }] }), { status: 200 }));
    const client = new TwitchClient({ clientId: "id", clientSecret: "secret" }, request);

    await expect(client.getUser("TwitchDev")).resolves.toMatchObject({ id: "141981764" });
    await expect(client.getAppAccessToken()).resolves.toBe("token");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("loads clips from the selected 24 hour window", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: "clip-id",
          url: "https://clips.twitch.tv/clip-id",
          embed_url: "https://clips.twitch.tv/embed?clip=clip-id",
          broadcaster_id: "123",
          broadcaster_name: "Streamer",
          creator_id: "456",
          creator_name: "Viewer",
          video_id: "789",
          game_id: "10",
          language: "en",
          title: "Example clip",
          view_count: 42,
          created_at: "2026-09-17T10:00:00Z",
          thumbnail_url: "https://example.com/clip.jpg",
          duration: 30,
        }],
        pagination: {},
      }), { status: 200 }));
    const client = new TwitchClient({ clientId: "id", clientSecret: "secret" }, request);

    const clips = await client.getFreshClips("123", { now: new Date("2026-09-17T12:00:00Z") });

    expect(clips[0]?.view_count).toBe(42);
    const clipsUrl = request.mock.calls[1]?.[0];
    expect(String(clipsUrl)).toContain("started_at=2026-09-16T12%3A00%3A00.000Z");
  });

  it("loads public channel data and clips without credentials", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { user: {
        id: "123",
        login: "streamer",
        displayName: "Streamer",
        profileImageURL: "https://example.com/avatar.png",
      } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { user: {
        id: "123",
        login: "streamer",
        displayName: "Streamer",
        profileImageURL: "https://example.com/avatar.png",
        clips: {
          edges: [{
            cursor: null,
            node: {
              slug: "PublicClip",
              title: "Public clip",
              viewCount: 99,
              durationSeconds: 28,
              createdAt: "2026-09-17T11:00:00Z",
              thumbnailURL: "https://example.com/clip.jpg",
              game: { name: "Counter-Strike" },
              broadcaster: { id: "123", login: "streamer", displayName: "Streamer" },
              curator: { id: "456", login: "viewer", displayName: "Viewer" },
            },
          }],
          pageInfo: { hasNextPage: false },
        },
      } } }), { status: 200 }));
    const client = new TwitchClient(undefined, request);

    await expect(client.getUser("streamer")).resolves.toMatchObject({ display_name: "Streamer" });
    const clips = await client.getFreshClips("123", {
      login: "streamer",
      now: new Date("2026-09-17T12:00:00Z"),
    });

    expect(clips[0]).toMatchObject({ id: "PublicClip", view_count: 99, game_name: "Counter-Strike" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("selects the highest quality public clip video", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { clip: {
      id: "1",
      slug: "PublicClip",
      title: "Public clip",
      videoQualities: [
        { sourceURL: "https://example.com/720.mp4", quality: "720", frameRate: 60 },
        { sourceURL: "https://example.com/1080.mp4", quality: "1080", frameRate: 60 },
      ],
      playbackAccessToken: {
        value: JSON.stringify({ clip_uri: "https://example.com/720.mp4" }),
        signature: "signature",
      },
    } } }), { status: 200 }));
    const client = new TwitchClient(undefined, request);

    await expect(client.getClipVideoUrl("PublicClip")).resolves.toContain("https://example.com/720.mp4?sig=signature&token=");
  });
});
