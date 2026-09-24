import { loadOptionalTikTokEnv } from "@clips-poster/config";
import { type NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
const LOCAL_APP_URL = process.env.LOCAL_APP_URL ?? "http://localhost:3000";
const STATE_COOKIE = "clips_poster_tiktok_oauth_state";

const finish = (status: string) => {
  const destination = new URL("/", LOCAL_APP_URL);
  destination.searchParams.set("tiktok", status);
  const response = NextResponse.redirect(destination);
  response.cookies.delete(STATE_COOKIE);
  return response;
};

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
}

interface UserResponse {
  data?: {
    user?: {
      open_id?: string;
      display_name?: string;
      avatar_url?: string;
    };
  };
}

export async function GET(request: NextRequest) {
  const credentials = loadOptionalTikTokEnv();
  if (!credentials) return finish("missing_config");

  const error = request.nextUrl.searchParams.get("error");
  if (error) return finish("cancelled");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) return finish("invalid_state");

  try {
    const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: credentials.TIKTOK_CLIENT_KEY,
        client_secret: credentials.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: credentials.TIKTOK_REDIRECT_URI,
      }),
      cache: "no-store",
    });
    const token = (await tokenResponse.json()) as TokenResponse;
    if (
      !tokenResponse.ok
      || !token.access_token
      || !token.refresh_token
      || !token.open_id
      || !token.expires_in
      || !token.refresh_expires_in
      || !token.scope
    ) return finish("token_error");

    const userResponse = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
      {
        headers: { authorization: `Bearer ${token.access_token}` },
        cache: "no-store",
      },
    );
    const profile = (await userResponse.json()) as UserResponse;
    if (!userResponse.ok) return finish("profile_error");

    const saveResponse = await fetch(`${API_URL}/publishing/tiktok/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        openId: token.open_id,
        displayName: profile.data?.user?.display_name,
        avatarUrl: profile.data?.user?.avatar_url,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresIn: token.expires_in,
        refreshExpiresIn: token.refresh_expires_in,
        scope: token.scope,
      }),
      cache: "no-store",
    });
    return finish(saveResponse.ok ? "connected" : "save_error");
  } catch {
    return finish("network_error");
  }
}
