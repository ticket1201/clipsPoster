import { randomBytes } from "node:crypto";
import { loadOptionalInstagramEnv } from "@clips-poster/config";
import { NextResponse } from "next/server";

const STATE_COOKIE = "clips_poster_instagram_oauth_state";

export function GET() {
  const credentials = loadOptionalInstagramEnv();
  if (!credentials) return NextResponse.redirect("http://localhost:3000/?instagram=missing_config");

  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = new URL("https://www.instagram.com/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", credentials.INSTAGRAM_APP_ID);
  authorizationUrl.searchParams.set("redirect_uri", credentials.INSTAGRAM_REDIRECT_URI);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("enable_fb_login", "0");
  authorizationUrl.searchParams.set("force_authentication", "1");

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
