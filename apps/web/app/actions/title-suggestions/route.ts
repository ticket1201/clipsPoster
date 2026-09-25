import { NextResponse, type NextRequest } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function GET(request: NextRequest) {
  const clipId = request.nextUrl.searchParams.get("clipId");
  if (!clipId) return NextResponse.json({ error: "clipId is required" }, { status: 400 });
  const response = await fetch(`${API_URL}/clips/${encodeURIComponent(clipId)}/title-suggestions`, { cache: "no-store" });
  return NextResponse.json(await response.json(), { status: response.status });
}
