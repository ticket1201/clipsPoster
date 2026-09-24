import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    source?: unknown;
    channelId?: unknown;
    contentAccountId?: unknown;
    platform?: unknown;
    enabled?: unknown;
  } | null;
  if (
    (body?.source !== "TWITCH" && body?.source !== "KICK")
    || (body.platform !== "TIKTOK" && body.platform !== "YOUTUBE" && body.platform !== "INSTAGRAM")
    || typeof body.channelId !== "string"
    || (body.contentAccountId !== null && typeof body.contentAccountId !== "string")
    || (body.enabled !== undefined && typeof body.enabled !== "boolean")
  ) {
    return NextResponse.json({ error: "invalid-assignment" }, { status: 400 });
  }
  const response = await fetch(`${API_URL}/publishing/assignments`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      platform: body.platform,
      contentAccountId: body.contentAccountId,
      enabled: body.enabled,
      ...(body.source === "TWITCH"
        ? { twitchChannelId: body.channelId }
        : { kickChannelId: body.channelId }),
    }),
  });
  const result = await response.json().catch(() => ({}));
  return NextResponse.json(result, { status: response.status });
}
