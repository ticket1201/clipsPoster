import { type NextRequest, NextResponse } from "next/server";

const publicAppHostname = process.env.PUBLIC_APP_HOSTNAME ?? "clipposter.website";
const publicTunnelPaths = new Set([
  "/",
  "/public",
  "/terms",
  "/privacy",
  "/actions/tiktok/connect",
  "/actions/tiktok/callback",
  "/actions/youtube/connect",
  "/actions/youtube/callback",
  "/actions/instagram/connect",
  "/actions/instagram/callback",
]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = (request.headers.get("host") ?? request.nextUrl.hostname).replace(/:\d+$/, "");
  const isPublicHostname = hostname === publicAppHostname || hostname.endsWith(".trycloudflare.com");
  if (!isPublicHostname) return NextResponse.next();

  if (pathname === "/") {
    return NextResponse.rewrite(new URL("/public", request.url));
  }
  if (
    publicTunnelPaths.has(pathname)
    || pathname.startsWith("/actions/instagram/media/")
    || pathname.startsWith("/_next/")
  ) {
    return NextResponse.next();
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export const config = {
  matcher: "/:path*",
};
