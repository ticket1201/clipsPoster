import { loadOptionalYouTubeEnv } from "@clips-poster/config";
import { type NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";
const LOCAL_APP_URL = process.env.LOCAL_APP_URL ?? "http://localhost:3000";
const STATE_COOKIE = "clips_poster_youtube_oauth_state";

const finish = (status: string) => {
  const destination = new URL("/", LOCAL_APP_URL);
  destination.searchParams.set("youtube", status);
  const response = NextResponse.redirect(destination);
  response.cookies.delete(STATE_COOKIE);
  return response;
};

export async function GET(request: NextRequest) {
  const credentials = loadOptionalYouTubeEnv();
  if (!credentials) return finish("missing_config");
  if (request.nextUrl.searchParams.get("error")) return finish("cancelled");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) return finish("invalid_state");

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.YOUTUBE_CLIENT_ID,
        client_secret: credentials.YOUTUBE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: credentials.YOUTUBE_REDIRECT_URI,
      }),
      cache: "no-store",
    });
    const token = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!tokenResponse.ok || !token.access_token || !token.refresh_token || !token.expires_in) return finish("token_error");
    const saveResponse = await fetch(`${API_URL}/publishing/youtube/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresIn: token.expires_in,
        scope: token.scope ?? "",
      }),
      cache: "no-store",
    });
    if (!saveResponse.ok) {
      const failure = await saveResponse.json().catch(() => ({})) as { code?: string; error?: string };
      console.error("YouTube account save failed", {
        status: saveResponse.status,
        code: failure.code,
        error: failure.error,
      });
      return finish(failure.code ? `save_${failure.code}` : `save_${saveResponse.status}`);
    }
    return finish("connected");
  } catch {
    return finish("network_error");
  }
}
