import { randomBytes } from "node:crypto";
import { loadOptionalTikTokEnv } from "@clips-poster/config";
import { NextResponse } from "next/server";

const STATE_COOKIE = "clips_poster_tiktok_oauth_state";

export function GET() {
  const credentials = loadOptionalTikTokEnv();
  if (!credentials) {
    return NextResponse.redirect("http://localhost:3000/?tiktok=missing_config");
  }

  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authorizationUrl.searchParams.set("client_key", credentials.TIKTOK_CLIENT_KEY);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", credentials.TIKTOK_OAUTH_SCOPES);
  authorizationUrl.searchParams.set("redirect_uri", credentials.TIKTOK_REDIRECT_URI);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("disable_auto_auth", "1");

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
