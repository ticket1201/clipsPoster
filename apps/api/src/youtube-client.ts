import { createReadStream } from "node:fs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com";

export class YouTubeApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

export interface YouTubeTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface YouTubeChannelProfile {
  id: string;
  title: string;
  customUrl?: string;
  thumbnailUrl?: string;
}

export interface YouTubeVideoStatistics {
  id: string;
  title: string;
  description: string;
  publishedAt: Date | null;
  views: bigint;
  likes: bigint;
  comments: bigint;
  privacyStatus: string;
}

export const sanitizeYouTubeTitle = (title: string): string => {
  const sanitized = title
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return sanitized || "Stream highlight";
};

export const sanitizeYouTubeDescription = (description: string): string => description
  .replace(/[<>]/g, "")
  .slice(0, 5_000);

export const refreshYouTubeToken = async (
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<YouTubeTokenResponse> => requestJson<YouTubeTokenResponse>(TOKEN_URL, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});

export const getYouTubeChannelProfile = async (accessToken: string): Promise<YouTubeChannelProfile> => {
  const response = await fetch(`${API_BASE}/youtube/v3/channels?part=id,snippet&mine=true`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const result = await readJson<{
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        customUrl?: string;
        thumbnails?: { default?: { url?: string } };
      };
    }>;
    error?: { message?: string; status?: string };
  }>(response);
  const channel = result.items?.[0];
  if (!response.ok || !channel?.id || !channel.snippet?.title) {
    throw new YouTubeApiError(result.error?.message || "YouTube channel was not found", response.status || 502, result.error?.status);
  }
  return {
    id: channel.id,
    title: channel.snippet.title,
    ...(channel.snippet.customUrl ? { customUrl: channel.snippet.customUrl } : {}),
    ...(channel.snippet.thumbnails?.default?.url ? { thumbnailUrl: channel.snippet.thumbnails.default.url } : {}),
  };
};

export const getYouTubeVideoStatistics = async (
  accessToken: string,
  videoIds: string[],
): Promise<YouTubeVideoStatistics[]> => {
  if (videoIds.length === 0) return [];
  const response = await fetch(`${API_BASE}/youtube/v3/videos?part=snippet,statistics,status&id=${encodeURIComponent(videoIds.join(","))}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const result = await readJson<{
    items?: Array<{
      id?: string;
      snippet?: { title?: string; description?: string; publishedAt?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      status?: { privacyStatus?: string };
    }>;
    error?: { message?: string; status?: string };
  }>(response);
  if (!response.ok) {
    throw new YouTubeApiError(result.error?.message || "Unable to read YouTube statistics", response.status, result.error?.status);
  }
  return (result.items ?? []).flatMap((item) => item.id ? [{
    id: item.id,
    title: item.snippet?.title?.trim() ?? "",
    description: item.snippet?.description ?? "",
    publishedAt: item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null,
    views: BigInt(item.statistics?.viewCount ?? "0"),
    likes: BigInt(item.statistics?.likeCount ?? "0"),
    comments: BigInt(item.statistics?.commentCount ?? "0"),
    privacyStatus: item.status?.privacyStatus ?? "unknown",
  }] : []);
};

export const uploadYouTubeShort = async (
  accessToken: string,
  filePath: string,
  videoSize: number,
  metadata: { title: string; description: string; tags: string[]; privacyStatus: "private" | "public" | "unlisted" },
): Promise<{ id: string; privacyStatus: string }> => {
  const title = sanitizeYouTubeTitle(metadata.title);
  const description = sanitizeYouTubeDescription(metadata.description);
  const initResponse = await fetch(`${API_BASE}/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(videoSize),
      "x-upload-content-type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: {
        title,
        description,
        tags: metadata.tags,
        categoryId: "22",
      },
      status: {
        privacyStatus: metadata.privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    }),
  });
  if (!initResponse.ok) {
    const error = await readJson<{ error?: { message?: string; status?: string } }>(initResponse);
    throw new YouTubeApiError(error.error?.message || "YouTube rejected upload initialization", initResponse.status, error.error?.status);
  }
  const uploadUrl = initResponse.headers.get("location");
  if (!uploadUrl) throw new YouTubeApiError("YouTube did not return a resumable upload URL", 502);

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-length": String(videoSize),
      "content-type": "video/mp4",
    },
    body: createReadStream(filePath) as never,
    // Required by Node.js fetch when streaming a request body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const uploaded = await readJson<{ id?: string; status?: { privacyStatus?: string }; error?: { message?: string; status?: string } }>(uploadResponse);
  if (!uploadResponse.ok || !uploaded.id) {
    throw new YouTubeApiError(uploaded.error?.message || "YouTube video upload failed", uploadResponse.status || 502, uploaded.error?.status);
  }
  return { id: uploaded.id, privacyStatus: uploaded.status?.privacyStatus ?? metadata.privacyStatus };
};

const requestJson = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const result = await readJson<T & { error?: string; error_description?: string }>(response);
  if (!response.ok || result.error) {
    throw new YouTubeApiError(result.error_description || result.error || "Google OAuth request failed", response.status || 502, result.error);
  }
  return result;
};

const readJson = async <T>(response: Response): Promise<T> => {
  try {
    return await response.json() as T;
  } catch {
    throw new YouTubeApiError("Google returned an invalid response", response.status || 502);
  }
};
