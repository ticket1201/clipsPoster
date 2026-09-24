import { loadOptionalInstagramEnv } from "@clips-poster/config";
import { type NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
const LOCAL_APP_URL = process.env.LOCAL_APP_URL ?? "http://localhost:3000";
const STATE_COOKIE = "clips_poster_instagram_oauth_state";
const REQUESTED_SCOPES = "instagram_business_basic,instagram_business_content_publish";

const finish = (status: string) => {
  const destination = new URL("/", LOCAL_APP_URL);
  destination.searchParams.set("instagram", status);
  const response = NextResponse.redirect(destination);
  response.cookies.delete(STATE_COOKIE);
  return response;
};

export async function GET(request: NextRequest) {
  const credentials = loadOptionalInstagramEnv();
  if (!credentials) return finish("missing_config");
  if (request.nextUrl.searchParams.get("error")) return finish("cancelled");
  const code = request.nextUrl.searchParams.get("code")?.replace(/#_$/, "");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) return finish("invalid_state");

  try {
    const shortTokenResponse = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.INSTAGRAM_APP_ID,
        client_secret: credentials.INSTAGRAM_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: credentials.INSTAGRAM_REDIRECT_URI,
        code,
      }),
      cache: "no-store",
    });
    const shortToken = await shortTokenResponse.json() as { access_token?: string; user_id?: string; error_message?: string };
    if (!shortTokenResponse.ok || !shortToken.access_token) return finish("token_error");

    const exchangeUrl = new URL("https://graph.instagram.com/access_token");
    exchangeUrl.searchParams.set("grant_type", "ig_exchange_token");
    exchangeUrl.searchParams.set("client_secret", credentials.INSTAGRAM_APP_SECRET);
    exchangeUrl.searchParams.set("access_token", shortToken.access_token);
    const longTokenResponse = await fetch(exchangeUrl, { cache: "no-store" });
    const longToken = await longTokenResponse.json() as { access_token?: string; expires_in?: number };
    if (!longTokenResponse.ok || !longToken.access_token || !longToken.expires_in) return finish("exchange_error");

    const saveResponse = await fetch(`${API_URL}/publishing/instagram/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessToken: longToken.access_token,
        expiresIn: longToken.expires_in,
        scope: REQUESTED_SCOPES,
      }),
      cache: "no-store",
    });
    return finish(saveResponse.ok ? "connected" : `save_${saveResponse.status}`);
  } catch {
    return finish("network_error");
  }
}
