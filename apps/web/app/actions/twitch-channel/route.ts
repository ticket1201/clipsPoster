import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function POST(request: Request) {
  const data = await request.formData();
  const login = data.get("login");
  const destination = new URL("/", request.url);

  if (typeof login !== "string") {
    destination.searchParams.set("error", "invalid-twitch-channel");
    return NextResponse.redirect(destination, 303);
  }

  const response = await fetch(`${API_URL}/twitch/channels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login }),
  });
  destination.searchParams.set(response.ok ? "added" : "error", response.ok ? login : "twitch-channel-failed");
  return NextResponse.redirect(destination, 303);
}
