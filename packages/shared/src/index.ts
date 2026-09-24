export const CLIP_DISCOVERY_QUEUE = "clip-discovery";
export const KICK_COLLECT_JOB = "collect-kick-channel";
export const KICK_POLL_ALL_JOB = "poll-all-kick-channels";
export const KICK_POLL_SCHEDULER_ID = "kick-poll-every-5-minutes";
export const KICK_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const TWITCH_COLLECT_JOB = "collect-twitch-channel";
export const TWITCH_POLL_ALL_JOB = "poll-all-twitch-channels";
export const TWITCH_POLL_SCHEDULER_ID = "twitch-poll-every-5-minutes";
export const VIDEO_PROCESSING_QUEUE = "video-processing";
export const PROCESS_CLIP_JOB = "process-clip-vertical";

export interface KickCollectJobData {
  channelId: string;
  slug: string;
}

export interface TwitchCollectJobData {
  channelId: string;
  login: string;
}

export interface ProcessClipJobData {
  clipId: string;
  autoApprove?: boolean;
}

const TIKTOK_TITLE_LIMIT = 2_200;

export const buildTikTokCaption = (
  title: string,
  source: "TWITCH" | "KICK",
  username: string | null | undefined,
  gameName?: string | null,
): string => {
  const cleanUsername = username?.trim().replace(/^@+/, "");
  const hashtag = (value: string): string => value
    .normalize("NFKC")
    .replace(/^@+/, "")
    .replace(/[^\p{L}\p{N}_]+/gu, "");
  const tags = [
    hashtag(gameName?.trim() || "gaming"),
    source === "TWITCH" ? "Twitch" : "Kick",
    cleanUsername ? hashtag(cleanUsername) : "",
  ].filter(Boolean).map((tag) => `#${tag}`).join(" ");
  const cleanTitle = title.trim() || "Стрим-хайлайт";
  const suffix = `\n\n${tags}`;
  return `${cleanTitle.slice(0, TIKTOK_TITLE_LIMIT - suffix.length)}${suffix}`;
};

export const isFreshClip = (createdAt: Date, now = new Date()): boolean => {
  const maximumAgeMs = 24 * 60 * 60 * 1000;
  return now.getTime() - createdAt.getTime() <= maximumAgeMs;
};

export * from "./metrics.js";
