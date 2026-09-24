import { randomBytes } from "node:crypto";
import { loadOptionalYouTubeEnv } from "@clips-poster/config";
import { NextResponse } from "next/server";

const STATE_COOKIE = "clips_poster_youtube_oauth_state";

export function GET() {
  const credentials = loadOptionalYouTubeEnv();
  if (!credentials) return NextResponse.redirect("http://localhost:3000/?youtube=missing_config");

  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", credentials.YOUTUBE_CLIENT_ID);
  authorizationUrl.searchParams.set("redirect_uri", credentials.YOUTUBE_REDIRECT_URI);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
  ].join(" "));
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent select_account");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  authorizationUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
