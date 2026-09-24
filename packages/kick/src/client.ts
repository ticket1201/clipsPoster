import {
  kickChannelSchema,
  kickClipsResponseSchema,
  type KickChannelResponse,
  type KickClipsResponse,
} from "./types.js";

const KICK_WEB_BASE_URL = "https://kick.com/api/v2";
const KICK_OAUTH_URL = "https://id.kick.com/oauth/token";

export type FetchLike = typeof fetch;

export interface KickCredentials {
  clientId: string;
  clientSecret: string;
}

export class KickApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KickApiError";
  }
}

export class KickClient {
  private accessToken: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly credentials?: KickCredentials,
    private readonly request: FetchLike = fetch,
  ) {}

  async getAppAccessToken(): Promise<string> {
    if (!this.credentials) {
      throw new KickApiError("Kick credentials are not configured");
    }

    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000) {
      return this.accessToken.value;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
    });
    const response = await this.request(KICK_OAUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      throw new KickApiError(`Kick OAuth failed with HTTP ${response.status}`, response.status);
    }

    const token = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof token.access_token !== "string" || token.access_token.length === 0) {
      throw new KickApiError("Kick OAuth response did not contain an access token");
    }

    const expiresIn = typeof token.expires_in === "number" ? token.expires_in : 3_600;
    this.accessToken = {
      value: token.access_token,
      expiresAt: now + expiresIn * 1_000,
    };
    return token.access_token;
  }

  async getChannel(slug: string): Promise<KickChannelResponse> {
    const normalizedSlug = normalizeKickSlug(slug);
    const response = await this.request(
      `${KICK_WEB_BASE_URL}/channels/${encodeURIComponent(normalizedSlug)}`,
      { headers: webHeaders() },
    );

    if (response.status === 404) {
      throw new KickApiError(`Kick channel '${normalizedSlug}' was not found`, 404);
    }
    if (!response.ok) {
      throw new KickApiError(`Kick channel request failed with HTTP ${response.status}`, response.status);
    }

    return kickChannelSchema.parse(await response.json());
  }

  async getFreshClips(slug: string, cursor?: string): Promise<KickClipsResponse> {
    const normalizedSlug = normalizeKickSlug(slug);
    const url = new URL(
      `${KICK_WEB_BASE_URL}/channels/${encodeURIComponent(normalizedSlug)}/clips`,
    );
    url.searchParams.set("sort", "date");
    url.searchParams.set("time", "day");
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await this.request(url, { headers: webHeaders() });
    if (!response.ok) {
      throw new KickApiError(`Kick clips request failed with HTTP ${response.status}`, response.status);
    }

    return kickClipsResponseSchema.parse(await response.json());
  }
}

export const normalizeKickSlug = (value: string): string => {
  const slug = value.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(slug)) {
    throw new KickApiError("Invalid Kick channel slug");
  }
  return slug;
};

const webHeaders = (): Record<string, string> => ({
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; ClipsPoster/0.1; local collector)",
});
