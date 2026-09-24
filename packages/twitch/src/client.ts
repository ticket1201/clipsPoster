import { spawn } from "node:child_process";
import {
  twitchClipsResponseSchema,
  twitchUsersResponseSchema,
  twitchWebGraphqlSchema,
  type TwitchClip,
  type TwitchUser,
  type TwitchWebClipNode,
} from "./types.js";

const TWITCH_OAUTH_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_API_URL = "https://api.twitch.tv/helix";
const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

export type FetchLike = typeof fetch;

export interface TwitchCredentials {
  clientId: string;
  clientSecret: string;
}

export class TwitchApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TwitchApiError";
  }
}

export class TwitchClient {
  private accessToken: { value: string; expiresAt: number } | undefined;
  private lastWebRequestAt = 0;

  constructor(
    private readonly credentials?: TwitchCredentials,
    private readonly request: FetchLike = fetch,
  ) {}

  async getAppAccessToken(): Promise<string> {
    if (!this.credentials) throw new TwitchApiError("Twitch credentials are not configured");
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000) {
      return this.accessToken.value;
    }

    const response = await this.request(TWITCH_OAUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        grant_type: "client_credentials",
      }),
    });
    if (!response.ok) {
      throw new TwitchApiError(`Twitch OAuth failed with HTTP ${response.status}`, response.status);
    }

    const token = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof token.access_token !== "string" || token.access_token.length === 0) {
      throw new TwitchApiError("Twitch OAuth response did not contain an access token");
    }
    const expiresIn = typeof token.expires_in === "number" ? token.expires_in : 3_600;
    this.accessToken = { value: token.access_token, expiresAt: now + expiresIn * 1_000 };
    return token.access_token;
  }

  async getUser(login: string): Promise<TwitchUser> {
    const normalizedLogin = normalizeTwitchLogin(login);
    if (!this.credentials) return this.getWebUser(normalizedLogin);
    const url = new URL(`${TWITCH_API_URL}/users`);
    url.searchParams.set("login", normalizedLogin);
    const response = await this.helix(url);
    const result = twitchUsersResponseSchema.parse(await response.json());
    const user = result.data[0];
    if (!user) throw new TwitchApiError(`Twitch channel '${normalizedLogin}' was not found`, 404);
    return user;
  }

  async getFreshClips(
    broadcasterId: string,
    options: { now?: Date; maximumPages?: number; login?: string } = {},
  ): Promise<TwitchClip[]> {
    if (!this.credentials) {
      if (!options.login) throw new TwitchApiError("Twitch channel login is required for anonymous collection");
      return this.getWebFreshClips(options.login, options);
    }
    const now = options.now ?? new Date();
    const startedAt = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    const clips: TwitchClip[] = [];
    let cursor: string | undefined;
    const maximumPages = options.maximumPages ?? 10;

    for (let page = 0; page < maximumPages; page += 1) {
      const url = new URL(`${TWITCH_API_URL}/clips`);
      url.searchParams.set("broadcaster_id", broadcasterId);
      url.searchParams.set("started_at", startedAt.toISOString());
      url.searchParams.set("ended_at", now.toISOString());
      url.searchParams.set("first", "100");
      if (cursor) url.searchParams.set("after", cursor);

      const response = await this.helix(url);
      const result = twitchClipsResponseSchema.parse(await response.json());
      clips.push(...result.data);
      cursor = result.pagination.cursor;
      if (!cursor) break;
    }
    return clips;
  }

  async getClipVideoUrl(slug: string): Promise<string> {
    const normalizedSlug = slug.trim();
    if (!/^[a-zA-Z0-9_-]{6,200}$/.test(normalizedSlug)) {
      throw new TwitchApiError("Invalid Twitch clip slug");
    }
    const query = `{ clip(slug: ${JSON.stringify(normalizedSlug)}) { id slug title videoQualities { sourceURL quality frameRate } playbackAccessToken(params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) { value signature } } }`;
    const result = twitchWebGraphqlSchema.parse(await this.webGraphql(query));
    const clip = result.data?.clip;
    const qualities = clip?.videoQualities;
    if (!qualities?.length) throw new TwitchApiError(`Twitch clip '${normalizedSlug}' has no downloadable video`, 404);
    const accessToken = clip?.playbackAccessToken;
    if (!accessToken) throw new TwitchApiError(`Twitch clip '${normalizedSlug}' has no playback token`, 502);
    const tokenData = JSON.parse(accessToken.value) as { clip_uri?: unknown };
    const preferredUrl = typeof tokenData.clip_uri === "string"
      ? tokenData.clip_uri
      : qualities.toSorted((left, right) => Number(right.quality) - Number(left.quality))[0]!.sourceURL;
    const url = new URL(preferredUrl);
    url.searchParams.set("sig", accessToken.signature);
    url.searchParams.set("token", accessToken.value);
    return url.toString();
  }

  private async helix(url: URL): Promise<Response> {
    const credentials = this.credentials;
    if (!credentials) throw new TwitchApiError("Twitch credentials are not configured");
    const token = await this.getAppAccessToken();
    const response = await this.request(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "client-id": credentials.clientId,
      },
    });
    if (!response.ok) {
      throw new TwitchApiError(`Twitch API request failed with HTTP ${response.status}`, response.status);
    }
    return response;
  }

  private async getWebUser(login: string): Promise<TwitchUser> {
    const query = `{ user(login: ${JSON.stringify(login)}) { id login displayName profileImageURL(width: 150) } }`;
    const result = twitchWebGraphqlSchema.parse(await this.webGraphql(query));
    const user = result.data?.user;
    if (!user) throw new TwitchApiError(`Twitch channel '${login}' was not found`, 404);
    return {
      id: user.id,
      login: user.login,
      display_name: user.displayName,
      profile_image_url: user.profileImageURL,
    };
  }

  private async getWebFreshClips(
    login: string,
    options: { now?: Date; maximumPages?: number },
  ): Promise<TwitchClip[]> {
    const normalizedLogin = normalizeTwitchLogin(login);
    const now = options.now ?? new Date();
    const threshold = now.getTime() - 24 * 60 * 60 * 1_000;
    // Anonymous Twitch web access becomes unreliable on deep pagination.
    // The top 100 clips from the last day are enough for growth monitoring.
    const maximumPages = options.maximumPages ?? 1;
    const clips: TwitchClip[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < maximumPages; page += 1) {
      const after = cursor ? `, after: ${JSON.stringify(cursor)}` : "";
      const query = `{ user(login: ${JSON.stringify(normalizedLogin)}) { id login displayName profileImageURL(width: 150) clips(first: 100${after}, criteria: { period: LAST_DAY, sort: VIEWS_DESC }) { edges { cursor node { slug title viewCount durationSeconds createdAt thumbnailURL(width: 480, height: 272) game { name } broadcaster { id login displayName } curator { id login displayName } } } pageInfo { hasNextPage } } } }`;
      const result = twitchWebGraphqlSchema.parse(await this.webGraphql(query));
      const user = result.data?.user;
      if (!user) throw new TwitchApiError(`Twitch channel '${normalizedLogin}' was not found`, 404);
      const connection = user.clips;
      if (!connection) break;
      clips.push(
        ...connection.edges
          .map((edge) => this.mapWebClip(edge.node, user.id, user.displayName))
          .filter((clip) => new Date(clip.created_at).getTime() >= threshold),
      );
      cursor = connection.edges.at(-1)?.cursor ?? undefined;
      if (!connection.pageInfo.hasNextPage || !cursor) break;
    }
    return clips;
  }

  private mapWebClip(node: TwitchWebClipNode, broadcasterId: string, broadcasterName: string): TwitchClip {
    const broadcaster = node.broadcaster;
    return {
      id: node.slug,
      url: `https://clips.twitch.tv/${node.slug}`,
      embed_url: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(node.slug)}`,
      broadcaster_id: broadcaster?.id ?? broadcasterId,
      broadcaster_name: broadcaster?.displayName ?? broadcasterName,
      creator_id: node.curator?.id ?? "",
      creator_name: node.curator?.displayName ?? node.curator?.login ?? "",
      video_id: "",
      game_id: "",
      game_name: node.game?.name,
      language: "",
      title: node.title,
      view_count: node.viewCount,
      created_at: node.createdAt,
      thumbnail_url: node.thumbnailURL,
      duration: node.durationSeconds,
      vod_offset: null,
      is_featured: false,
    };
  }

  private async webGraphql(query: string): Promise<unknown> {
    if (this.request === fetch) {
      return this.webGraphqlWithCurl(query);
    }
    let lastStatus = 502;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.paceWebRequests();
      const response = await this.request(TWITCH_GQL_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "client-id": TWITCH_WEB_CLIENT_ID,
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({ query }),
      });
      lastStatus = response.status;
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 2) continue;
        throw new TwitchApiError(`Twitch web request failed with HTTP ${response.status}`, response.status);
      }
      const body = twitchWebGraphqlSchema.parse(await response.json());
      const error = body.errors?.[0]?.message;
      if (!error) return body;
      if (/integrity/i.test(error) && attempt < 2) continue;
      throw new TwitchApiError(`Twitch web request failed: ${error}`);
    }
    throw new TwitchApiError(`Twitch web request failed with HTTP ${lastStatus}`, lastStatus);
  }

  private async webGraphqlWithCurl(query: string): Promise<unknown> {
    let lastError = "unknown error";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.paceWebRequests();
      try {
        const raw = await runCurl(JSON.stringify({ query }));
        const body = twitchWebGraphqlSchema.parse(JSON.parse(raw));
        const error = body.errors?.[0]?.message;
        if (!error) return body;
        lastError = error;
        if (!/integrity/i.test(error)) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new TwitchApiError(`Twitch web request failed: ${lastError}`);
  }

  private async paceWebRequests(): Promise<void> {
    const remaining = 550 - (Date.now() - this.lastWebRequestAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    this.lastWebRequestAt = Date.now();
  }
}

const runCurl = (body: string): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn("curl", [
    "-fsS",
    TWITCH_GQL_URL,
    "-H", `Client-Id: ${TWITCH_WEB_CLIENT_ID}`,
    "-H", "Content-Type: application/json",
    "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "--data-binary", body,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
    else reject(new TwitchApiError(`curl failed: ${Buffer.concat(stderr).toString("utf8").trim()}`));
  });
});

export const normalizeTwitchLogin = (value: string): string => {
  const login = value.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_]{2,25}$/.test(login)) {
    throw new TwitchApiError("Invalid Twitch channel login");
  }
  return login;
};
