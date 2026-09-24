import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function POST(request: Request) {
  const data = await request.formData();
  const clipId = data.get("clipId");
  const destination = new URL("/", request.url);
  if (typeof clipId !== "string") {
    if (request.headers.get("accept")?.includes("application/json")) {
      return NextResponse.json({ error: "invalid-clip" }, { status: 400 });
    }
    destination.searchParams.set("error", "invalid-clip");
    return NextResponse.redirect(destination, 303);
  }
  const response = await fetch(`${API_URL}/clips/${encodeURIComponent(clipId)}/process`, {
    method: "POST",
  });
  if (request.headers.get("accept")?.includes("application/json")) {
    const result = await response.json().catch(() => ({}));
    return NextResponse.json(result, { status: response.status });
  }
  destination.searchParams.set(response.ok ? "processing" : "error", response.ok ? clipId : "processing-failed");
  return NextResponse.redirect(destination, 303);
}

export async function GET(request: Request) {
  const clipId = new URL(request.url).searchParams.get("clipId");
  if (!clipId) return NextResponse.json({ error: "invalid-clip" }, { status: 400 });

  const response = await fetch(`${API_URL}/clips/${encodeURIComponent(clipId)}/status`, {
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  return NextResponse.json(result, { status: response.status });
}
