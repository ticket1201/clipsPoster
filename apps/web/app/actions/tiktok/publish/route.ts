import { NextResponse, type NextRequest } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function GET(request: NextRequest) {
  const publicationId = request.nextUrl.searchParams.get("publicationId");
  const clipId = request.nextUrl.searchParams.get("clipId");
  const path = publicationId
    ? `/publications/${encodeURIComponent(publicationId)}/status`
    : clipId ? `/clips/${encodeURIComponent(clipId)}/publish/tiktok/options` : null;
  if (!path) return NextResponse.json({ error: "clipId or publicationId is required" }, { status: 400 });
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  return NextResponse.json(await response.json(), { status: response.status });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { clipId?: string } & Record<string, unknown>;
  if (typeof body.clipId !== "string") {
    return NextResponse.json({ error: "clipId is required" }, { status: 400 });
  }
  const { clipId, ...settings } = body;
  const response = await fetch(`${API_URL}/clips/${encodeURIComponent(clipId)}/draft/tiktok`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consent: settings.consent === true }),
    cache: "no-store",
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
