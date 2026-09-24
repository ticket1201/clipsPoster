import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { username?: unknown } | null;
  if (typeof body?.username !== "string") {
    return NextResponse.json({ error: "invalid-account" }, { status: 400 });
  }
  const response = await fetch(`${API_URL}/publishing/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "TIKTOK", username: body.username }),
  });
  const result = await response.json().catch(() => ({}));
  return NextResponse.json(result, { status: response.status });
}

export async function DELETE(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "invalid-account" }, { status: 400 });
  const response = await fetch(`${API_URL}/publishing/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  });
  if (response.status === 204) return new NextResponse(null, { status: 204 });
  const result = await response.json().catch(() => ({}));
  return NextResponse.json(result, { status: response.status });
}
