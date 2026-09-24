import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function POST(request: Request) {
  const data = await request.formData();
  const slug = data.get("slug");
  const destination = new URL("/", request.url);

  if (typeof slug !== "string") {
    destination.searchParams.set("error", "invalid-channel");
    return NextResponse.redirect(destination, 303);
  }

  const response = await fetch(`${API_URL}/kick/channels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug }),
  });
  destination.searchParams.set(response.ok ? "added" : "error", slug);
  return NextResponse.redirect(destination, 303);
}
