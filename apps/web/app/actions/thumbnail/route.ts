import { NextResponse } from "next/server";

const allowedHosts = new Set(["static-cdn.jtvnw.net"]);

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("url");
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
    return new NextResponse(null, { status: 400 });
  }

  const upstream = await fetch(url, { redirect: "manual", next: { revalidate: 900 } });
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location") ?? "";
    if (upstream.headers.has("x-404-redirect") || location.includes("404_preview")) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.redirect(new URL(location, url));
  }
  if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: 404 });

  return new NextResponse(upstream.body, {
    headers: {
      "cache-control": "public, max-age=900, stale-while-revalidate=3600",
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
    },
  });
}
