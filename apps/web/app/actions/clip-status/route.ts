import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { clipId?: unknown; status?: unknown } | null;
  if (typeof body?.clipId !== "string" || typeof body.status !== "string") {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }

  const response = await fetch(`${API_URL}/clips/${encodeURIComponent(body.clipId)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: body.status }),
  });
  const result = await response.json().catch(() => ({}));
  return NextResponse.json(result, { status: response.status });
}
