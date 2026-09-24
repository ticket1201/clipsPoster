import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTikTokPostStatus, getTikTokChunkPlan, listTikTokVideos } from "../src/tiktok-client.js";

afterEach(() => vi.unstubAllGlobals());

describe("getTikTokChunkPlan", () => {
  it("uploads files up to 64 MiB as one chunk", () => {
    expect(getTikTokChunkPlan(4 * 1024 * 1024)).toEqual({ chunkSize: 4 * 1024 * 1024, totalChunkCount: 1 });
    expect(getTikTokChunkPlan(64 * 1024 * 1024)).toEqual({ chunkSize: 64 * 1024 * 1024, totalChunkCount: 1 });
  });

  it("splits larger files into sequential 32 MiB chunks", () => {
    expect(getTikTokChunkPlan(100 * 1024 * 1024)).toEqual({ chunkSize: 32 * 1024 * 1024, totalChunkCount: 3 });
  });

  it("rejects an empty video", () => {
    expect(() => getTikTokChunkPlan(0)).toThrow();
  });
});

describe("TikTok analytics responses", () => {
  it("preserves the exact int64 public post id returned by TikTok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7688066768421572123]},"error":{"code":"ok"}}',
      { status: 200, headers: { "content-type": "application/json" } },
    )));

    await expect(fetchTikTokPostStatus("token", "publish-id")).resolves.toEqual({
      status: "PUBLISH_COMPLETE",
      publicPostIds: ["7688066768421572123"],
    });
  });

  it("reads public video metrics and their real publication time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: {
        videos: [{ id: "7688066768421572123", title: "clip", create_time: 1_700_000_000, view_count: 120, like_count: 8, comment_count: 2, share_count: 1 }],
        has_more: false,
      },
      error: { code: "ok" },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(listTikTokVideos("token", 20)).resolves.toEqual([{
      id: "7688066768421572123",
      title: "clip",
      createdAt: new Date(1_700_000_000_000),
      views: 120n,
      likes: 8n,
      comments: 2n,
      shares: 1n,
    }]);
  });
});
