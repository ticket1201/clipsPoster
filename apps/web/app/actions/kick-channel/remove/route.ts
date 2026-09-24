import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function POST(request: Request) {
  const data = await request.formData();
  const channelId = data.get("channelId");
  const destination = new URL("/", request.url);

  if (typeof channelId !== "string") {
    destination.searchParams.set("error", "invalid-channel");
    return NextResponse.redirect(destination, 303);
  }

  const response = await fetch(`${API_URL}/kick/channels/${encodeURIComponent(channelId)}`, {
    method: "DELETE",
  });
  destination.searchParams.set(response.ok ? "removed" : "error", response.ok ? "channel" : "remove-failed");
  return NextResponse.redirect(destination, 303);
}
