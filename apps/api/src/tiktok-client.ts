import { open } from "node:fs/promises";

const API_BASE = "https://open.tiktokapis.com";
const MULTIPART_CHUNK_SIZE = 32 * 1024 * 1024;

export class TikTokApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "TikTokApiError";
  }
}

interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

export interface TikTokCreatorInfo {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

export interface TikTokPostOptions {
  title: string;
  privacyLevel: string;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
  isAigc: boolean;
}

export interface TikTokTokenResponse {
  access_token: string;
  refresh_token: string;
  open_id: string;
  expires_in: number;
  refresh_expires_in: number;
  scope: string;
}

export interface TikTokVideoStatistics {
  id: string;
  createdAt: Date | null;
  title: string;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
}

export const refreshTikTokToken = async (
  clientKey: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TikTokTokenResponse> => requestJson<TikTokTokenResponse>(`${API_BASE}/v2/oauth/token/`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }),
});

export const queryTikTokCreatorInfo = async (accessToken: string): Promise<TikTokCreatorInfo> => {
  const result = await requestEnvelope<TikTokCreatorInfo>(`${API_BASE}/v2/post/publish/creator_info/query/`, accessToken, {});
  if (!result.data) throw new TikTokApiError("TikTok did not return creator information", 502);
  return result.data;
};

export const initializeTikTokVideoUpload = async (
  accessToken: string,
  videoSize: number,
): Promise<{ publishId: string; uploadUrl: string; chunkSize: number; totalChunkCount: number }> => {
  const plan = getTikTokChunkPlan(videoSize);
  const result = await requestEnvelope<{ publish_id?: string; upload_url?: string }>(
    `${API_BASE}/v2/post/publish/inbox/video/init/`,
    accessToken,
    {
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount,
      },
    },
  );
  if (!result.data?.publish_id || !result.data.upload_url) {
    throw new TikTokApiError("TikTok did not initialize the upload", 502);
  }
  return {
    publishId: result.data.publish_id,
    uploadUrl: result.data.upload_url,
    chunkSize: plan.chunkSize,
    totalChunkCount: plan.totalChunkCount,
  };
};

export const uploadTikTokVideo = async (
  uploadUrl: string,
  filePath: string,
  videoSize: number,
  chunkSize: number,
  totalChunkCount: number,
): Promise<void> => {
  const target = new URL(uploadUrl);
  if (target.protocol !== "https:" || !target.hostname.endsWith(".tiktokapis.com")) {
    throw new TikTokApiError("TikTok returned an invalid upload URL", 502);
  }
  const file = await open(filePath, "r");
  try {
    let offset = 0;
    for (let index = 0; index < totalChunkCount; index += 1) {
      const isFinal = index === totalChunkCount - 1;
      const length = isFinal ? videoSize - offset : chunkSize;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new TikTokApiError("Unable to read the complete video chunk", 500);
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "content-type": "video/mp4",
          "content-length": String(length),
          "content-range": `bytes ${offset}-${offset + length - 1}/${videoSize}`,
        },
        body: buffer,
      });
      if (!response.ok) {
        throw new TikTokApiError(`TikTok rejected video chunk ${index + 1}`, response.status);
      }
      offset += length;
    }
  } finally {
    await file.close();
  }
};

export const fetchTikTokPostStatus = async (
  accessToken: string,
  publishId: string,
): Promise<{ status: string; failReason?: string; publicPostIds: string[] }> => {
  const result = await requestEnvelope<{ status?: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> }>(
    `${API_BASE}/v2/post/publish/status/fetch/`,
    accessToken,
    { publish_id: publishId },
  );
  if (!result.data?.status) throw new TikTokApiError("TikTok did not return publication status", 502);
  return {
    status: result.data.status,
    publicPostIds: (result.data.publicaly_available_post_id ?? []).map(String),
    ...(result.data.fail_reason ? { failReason: result.data.fail_reason } : {}),
  };
};

export const queryTikTokVideos = async (
  accessToken: string,
  videoIds: string[],
): Promise<TikTokVideoStatistics[]> => {
  if (videoIds.length === 0) return [];
  const fields = "id,view_count,like_count,comment_count,share_count";
  const result = await requestEnvelope<{ videos?: Array<{
    id?: string;
    view_count?: number;
    like_count?: number;
    comment_count?: number;
    share_count?: number;
  }> }>(`${API_BASE}/v2/video/query/?fields=${fields}`, accessToken, { filters: { video_ids: videoIds } });
  return (result.data?.videos ?? []).flatMap((video) => video.id ? [{
    id: video.id,
    createdAt: null,
    title: "",
    views: BigInt(video.view_count ?? 0),
    likes: BigInt(video.like_count ?? 0),
    comments: BigInt(video.comment_count ?? 0),
    shares: BigInt(video.share_count ?? 0),
  }] : []);
};

export const listTikTokVideos = async (
  accessToken: string,
  limit = 200,
): Promise<TikTokVideoStatistics[]> => {
  const fields = "id,title,video_description,create_time,view_count,like_count,comment_count,share_count";
  const videos: TikTokVideoStatistics[] = [];
  let cursor: number | undefined;
  let hasMore = true;

  while (hasMore && videos.length < limit) {
    const result = await requestEnvelope<{ videos?: Array<{
      id?: string;
      title?: string;
      video_description?: string;
      create_time?: number;
      view_count?: number;
      like_count?: number;
      comment_count?: number;
      share_count?: number;
    }>; cursor?: number; has_more?: boolean }>(
      `${API_BASE}/v2/video/list/?fields=${fields}`,
      accessToken,
      { max_count: Math.min(20, limit - videos.length), ...(cursor === undefined ? {} : { cursor }) },
    );
    for (const video of result.data?.videos ?? []) {
      if (!video.id) continue;
      videos.push({
        id: video.id,
        createdAt: video.create_time ? new Date(video.create_time * 1_000) : null,
        title: video.title?.trim() || video.video_description?.trim() || "",
        views: BigInt(video.view_count ?? 0),
        likes: BigInt(video.like_count ?? 0),
        comments: BigInt(video.comment_count ?? 0),
        shares: BigInt(video.share_count ?? 0),
      });
    }
    const nextCursor = result.data?.cursor;
    hasMore = Boolean(result.data?.has_more) && nextCursor !== undefined && nextCursor !== cursor;
    cursor = nextCursor;
  }
  return videos;
};

export const getTikTokChunkPlan = (videoSize: number): { chunkSize: number; totalChunkCount: number } => {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0) throw new Error("Video size must be a positive integer");
  if (videoSize <= 64 * 1024 * 1024) return { chunkSize: videoSize, totalChunkCount: 1 };
  return {
    chunkSize: MULTIPART_CHUNK_SIZE,
    totalChunkCount: Math.floor(videoSize / MULTIPART_CHUNK_SIZE),
  };
};

const requestEnvelope = async <T>(url: string, accessToken: string, body: object): Promise<ApiEnvelope<T>> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const result = await readJson<ApiEnvelope<T>>(response);
  if (!response.ok || (result.error?.code && result.error.code !== "ok")) {
    throw new TikTokApiError(
      result.error?.message || result.error?.code || "TikTok API request failed",
      response.status,
      result.error?.code,
    );
  }
  return result;
};

const requestJson = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const result = await readJson<T & { error?: string; error_description?: string }>(response);
  if (!response.ok || result.error) {
    throw new TikTokApiError(result.error_description || result.error || "TikTok API request failed", response.status, result.error);
  }
  return result;
};

const readJson = async <T>(response: Response): Promise<T> => {
  try {
    const source = await response.text();
    const losslessSource = source.replace(
      /("publicaly_available_post_id"\s*:\s*\[)([\s\S]*?)(\])/g,
      (_match, prefix: string, values: string, suffix: string) => `${prefix}${values
        .split(",")
        .map((value) => /^\s*\d{16,}\s*$/.test(value) ? `"${value.trim()}"` : value)
        .join(",")}${suffix}`,
    );
    return JSON.parse(losslessSource) as T;
  } catch {
    throw new TikTokApiError("TikTok returned an invalid response", response.status || 502);
  }
};
