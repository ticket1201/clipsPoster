import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function POST(request: Request) {
  await fetch(`${API_URL}/analytics/refresh`, { method: "POST", cache: "no-store" });
  return NextResponse.redirect(new URL("/analytics", request.url), 303);
}
