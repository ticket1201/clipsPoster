const PROFILE_BASE = "https://graph.instagram.com";

export class InstagramApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "InstagramApiError";
  }
}

export interface InstagramProfile {
  id: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
}

export const getInstagramProfile = async (
  accessToken: string,
  graphVersion: string,
): Promise<InstagramProfile> => {
  const url = new URL(`${PROFILE_BASE}/${graphVersion}/me`);
  url.searchParams.set("fields", "id,user_id,username,name,profile_picture_url");
  url.searchParams.set("access_token", accessToken);
  const result = await requestJson<{
    id?: string;
    user_id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  }>(url);
  const id = result.user_id ?? result.id;
  if (!id || !result.username) throw new InstagramApiError("Instagram profile was not found", 502);
  return {
    id,
    username: result.username,
    ...(result.name ? { name: result.name } : {}),
    ...(result.profile_picture_url ? { profilePictureUrl: result.profile_picture_url } : {}),
  };
};

export const refreshInstagramToken = async (
  accessToken: string,
): Promise<{ access_token: string; expires_in: number }> => {
  const url = new URL(`${PROFILE_BASE}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);
  return requestJson<{ access_token: string; expires_in: number }>(url);
};

export const createInstagramReelContainer = async (
  accessToken: string,
  graphVersion: string,
  instagramUserId: string,
  videoUrl: string,
  caption: string,
): Promise<string> => {
  const result = await requestJson<{ id?: string }>(
    new URL(`${PROFILE_BASE}/${graphVersion}/${encodeURIComponent(instagramUserId)}/media`),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        media_type: "REELS",
        video_url: videoUrl,
        caption: caption.slice(0, 2_200),
        share_to_feed: "true",
        access_token: accessToken,
      }),
    },
  );
  if (!result.id) throw new InstagramApiError("Instagram did not create a Reel container", 502);
  return result.id;
};

export const getInstagramContainerStatus = async (
  accessToken: string,
  graphVersion: string,
  containerId: string,
): Promise<{ statusCode: string; status?: string }> => {
  const url = new URL(`${PROFILE_BASE}/${graphVersion}/${encodeURIComponent(containerId)}`);
  url.searchParams.set("fields", "status_code,status");
  url.searchParams.set("access_token", accessToken);
  const result = await requestJson<{ status_code?: string; status?: string }>(url);
  if (!result.status_code) throw new InstagramApiError("Instagram did not return container status", 502);
  return { statusCode: result.status_code, ...(result.status ? { status: result.status } : {}) };
};

export const publishInstagramReel = async (
  accessToken: string,
  graphVersion: string,
  instagramUserId: string,
  containerId: string,
): Promise<string> => {
  const result = await requestJson<{ id?: string }>(
    new URL(`${PROFILE_BASE}/${graphVersion}/${encodeURIComponent(instagramUserId)}/media_publish`),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creation_id: containerId, access_token: accessToken }),
    },
  );
  if (!result.id) throw new InstagramApiError("Instagram did not publish the Reel", 502);
  return result.id;
};

const requestJson = async <T>(url: URL, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  let result: T & { error?: { message?: string; code?: number; error_subcode?: number } };
  try {
    result = await response.json() as typeof result;
  } catch {
    throw new InstagramApiError("Instagram returned an invalid response", response.status || 502);
  }
  if (!response.ok || result.error) {
    throw new InstagramApiError(
      result.error?.message || "Instagram API request failed",
      response.status || 502,
      String(result.error?.error_subcode ?? result.error?.code ?? "api_error"),
    );
  }
  return result;
};
