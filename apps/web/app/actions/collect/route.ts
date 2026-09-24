import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function POST(request: Request) {
  const destination = new URL("/", request.url);
  const [kickResponse, twitchResponse] = await Promise.all([
    fetch(`${API_URL}/kick/collect`, { method: "POST" }),
    fetch(`${API_URL}/twitch/collect`, { method: "POST" }),
  ]);
  const ok = kickResponse.ok && twitchResponse.ok;
  destination.searchParams.set(ok ? "collect" : "error", ok ? "queued" : "queue-failed");
  return NextResponse.redirect(destination, 303);
}
