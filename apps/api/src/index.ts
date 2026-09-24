import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  loadCoreEnv,
  loadOptionalInstagramEnv,
  loadOptionalTikTokEnv,
  loadOptionalTwitchEnv,
  loadOptionalYouTubeEnv,
} from "@clips-poster/config";
import { createDatabaseClient } from "@clips-poster/database";
import { ensureKickChannel, KickApiError, KickClient } from "@clips-poster/kick";
import { ensureTwitchChannel, TwitchApiError, TwitchClient } from "@clips-poster/twitch";
import {
  CLIP_DISCOVERY_QUEUE,
  buildTikTokCaption,
  KICK_COLLECT_JOB,
  type KickCollectJobData,
  TWITCH_COLLECT_JOB,
  TWITCH_POLL_SCHEDULER_ID,
  type TwitchCollectJobData,
  PROCESS_CLIP_JOB,
  type ProcessClipJobData,
  VIDEO_PROCESSING_QUEUE,
} from "@clips-poster/shared";
import { decryptToken, encryptToken } from "./token-cipher.js";
import {
  fetchTikTokPostStatus,
  initializeTikTokVideoUpload,
  listTikTokVideos,
  refreshTikTokToken,
  TikTokApiError,
  uploadTikTokVideo,
} from "./tiktok-client.js";
import {
  getYouTubeChannelProfile,
  getYouTubeVideoStatistics,
  refreshYouTubeToken,
  sanitizeYouTubeDescription,
  sanitizeYouTubeTitle,
  uploadYouTubeShort,
  YouTubeApiError,
} from "./youtube-client.js";
import {
  createInstagramReelContainer,
  getInstagramContainerStatus,
  getInstagramProfile,
  InstagramApiError,
  publishInstagramReel,
  refreshInstagramToken,
} from "./instagram-client.js";

const env = loadCoreEnv();
const app = Fastify({ logger: true });
const database = createDatabaseClient(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
const kickClient = new KickClient();
const twitchCredentials = loadOptionalTwitchEnv();
const tiktokCredentials = loadOptionalTikTokEnv();
const youtubeCredentials = loadOptionalYouTubeEnv();
const instagramCredentials = loadOptionalInstagramEnv();
const twitchClient = new TwitchClient(
  twitchCredentials
    ? {
      clientId: twitchCredentials.TWITCH_CLIENT_ID,
      clientSecret: twitchCredentials.TWITCH_CLIENT_SECRET,
    }
    : undefined,
);
const clipDiscoveryQueue = new Queue<KickCollectJobData | TwitchCollectJobData>(CLIP_DISCOVERY_QUEUE, {
  connection: redis,
});
const videoProcessingQueue = new Queue<ProcessClipJobData>(VIDEO_PROCESSING_QUEUE, { connection: redis });
const storageRoot = resolve(fileURLToPath(new URL("../../../storage/", import.meta.url)));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const manualClipStatuses = new Set(["TRACKING", "CANDIDATE", "PROCESSED", "APPROVED", "REJECTED"]);
const publishingPlatforms = new Set(["TIKTOK", "YOUTUBE", "INSTAGRAM"]);
const isValidWebcamCrop = (crop: {
  x?: number; y?: number; width?: number; height?: number;
} | undefined): crop is { x: number; y: number; width: number; height: number } => {
  if (!crop) return false;
  const { x, y, width, height } = crop;
  return [x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value))
    && x! >= 0 && y! >= 0 && width! >= 0.05 && height! >= 0.05
    && x! + width! <= 1.000_001 && y! + height! <= 1.000_001;
};
const publishingAccountSelect = {
  id: true,
  platform: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  connectedAt: true,
  authorizedScopes: true,
} as const;

interface TikTokAccountAuth {
  id: string;
  displayName: string | null;
  username: string;
  avatarUrl: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  authorizedScopes: string | null;
}

type PublishingAccountAuth = TikTokAccountAuth;

const getTikTokTarget = async (clipId: string) => {
  const clip = await database.clip.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      title: true,
      gameName: true,
      source: true,
      status: true,
      durationSeconds: true,
      processedFilePath: true,
      tiktokFilePath: true,
      twitchChannelId: true,
      kickChannelId: true,
      twitchChannel: { select: { login: true } },
      kickChannel: { select: { slug: true } },
    },
  });
  if (!clip) return null;
  const assignments = await database.channelAssignment.findMany({
    where: {
      platform: "TIKTOK",
      active: true,
      ...(clip.source === "TWITCH"
        ? { twitchChannelId: clip.twitchChannelId }
        : { kickChannelId: clip.kickChannelId }),
      contentAccount: { is: { active: true } },
    },
    select: {
      contentAccount: {
        select: {
          id: true,
          displayName: true,
          username: true,
          avatarUrl: true,
          accessTokenEncrypted: true,
          refreshTokenEncrypted: true,
          accessTokenExpiresAt: true,
          refreshTokenExpiresAt: true,
          authorizedScopes: true,
        },
      },
    },
  });
  return { clip, accounts: assignments.map((assignment) => assignment.contentAccount) };
};

const getTikTokAccessToken = async (account: TikTokAccountAuth | null, requiredScope = "video.upload") => {
  if (!account || !tiktokCredentials || !account.accessTokenEncrypted || !account.refreshTokenEncrypted) {
    throw new TikTokApiError("TikTok account must be reconnected", 401, "account_not_connected");
  }
  if (!account.authorizedScopes?.split(/[\s,]+/).includes(requiredScope)) {
    throw new TikTokApiError(`TikTok account did not authorize ${requiredScope}; reconnect the account`, 403, "scope_not_authorized");
  }
  if (account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() > Date.now() + 5 * 60_000) {
    return decryptToken(account.accessTokenEncrypted, tiktokCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY);
  }
  if (account.refreshTokenExpiresAt && account.refreshTokenExpiresAt.getTime() <= Date.now()) {
    throw new TikTokApiError("TikTok authorization expired; reconnect the account", 401, "refresh_expired");
  }
  const refreshToken = decryptToken(account.refreshTokenEncrypted, tiktokCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY);
  const refreshed = await refreshTikTokToken(
    tiktokCredentials.TIKTOK_CLIENT_KEY,
    tiktokCredentials.TIKTOK_CLIENT_SECRET,
    refreshToken,
  );
  const now = Date.now();
  await database.contentAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encryptToken(refreshed.access_token, tiktokCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
      refreshTokenEncrypted: encryptToken(refreshed.refresh_token, tiktokCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
      accessTokenExpiresAt: new Date(now + refreshed.expires_in * 1_000),
      refreshTokenExpiresAt: new Date(now + refreshed.refresh_expires_in * 1_000),
      authorizedScopes: refreshed.scope,
    },
  });
  return refreshed.access_token;
};

const sendTikTokError = (reply: { status: (code: number) => { send: (body: object) => unknown } }, error: unknown) => {
  if (error instanceof TikTokApiError) {
    return reply.status(error.status >= 400 && error.status < 600 ? error.status : 502).send({
      error: error.message,
      code: error.code,
    });
  }
  throw error;
};

const getYouTubeTarget = async (clipId: string) => {
  const clip = await database.clip.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      title: true,
      gameName: true,
      source: true,
      status: true,
      processedFilePath: true,
      tiktokFilePath: true,
      twitchChannelId: true,
      kickChannelId: true,
      twitchChannel: { select: { login: true } },
      kickChannel: { select: { slug: true } },
    },
  });
  if (!clip) return null;
  const assignments = await database.channelAssignment.findMany({
    where: {
      platform: "YOUTUBE",
      active: true,
      ...(clip.source === "TWITCH"
        ? { twitchChannelId: clip.twitchChannelId }
        : { kickChannelId: clip.kickChannelId }),
      contentAccount: { is: { active: true } },
    },
    select: {
      contentAccount: {
        select: {
          id: true,
          displayName: true,
          username: true,
          avatarUrl: true,
          accessTokenEncrypted: true,
          refreshTokenEncrypted: true,
          accessTokenExpiresAt: true,
          refreshTokenExpiresAt: true,
          authorizedScopes: true,
        },
      },
    },
  });
  return { clip, accounts: assignments.map((assignment) => assignment.contentAccount) };
};

const getYouTubeAccessToken = async (account: PublishingAccountAuth | null) => {
  if (!account || !youtubeCredentials || !account.accessTokenEncrypted || !account.refreshTokenEncrypted) {
    throw new YouTubeApiError("YouTube account must be reconnected", 401, "account_not_connected");
  }
  if (account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() > Date.now() + 5 * 60_000) {
    return decryptToken(account.accessTokenEncrypted, youtubeCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY);
  }
  const refreshToken = decryptToken(account.refreshTokenEncrypted, youtubeCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY);
  const refreshed = await refreshYouTubeToken(
    youtubeCredentials.YOUTUBE_CLIENT_ID,
    youtubeCredentials.YOUTUBE_CLIENT_SECRET,
    refreshToken,
  );
  await database.contentAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encryptToken(refreshed.access_token, youtubeCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1_000),
      ...(refreshed.scope ? { authorizedScopes: refreshed.scope } : {}),
    },
  });
  return refreshed.access_token;
};

const sendYouTubeError = (reply: { status: (code: number) => { send: (body: object) => unknown } }, error: unknown) => {
  if (error instanceof YouTubeApiError) {
    return reply.status(error.status >= 400 && error.status < 600 ? error.status : 502).send({
      error: error.message,
      code: error.code,
    });
  }
  throw error;
};

const refreshYouTubeAnalytics = async () => {
  if (!youtubeCredentials) return { updated: 0, errors: ["YouTube is not configured"] };
  const accounts = await database.contentAccount.findMany({
    where: { platform: "YOUTUBE", active: true },
    select: {
      id: true, displayName: true, username: true, avatarUrl: true,
      accessTokenEncrypted: true, refreshTokenEncrypted: true,
      accessTokenExpiresAt: true, refreshTokenExpiresAt: true, authorizedScopes: true,
      publications: {
        where: { status: "PUBLISHED", externalId: { not: null } },
        select: { id: true, externalId: true },
      },
    },
  });
  let updated = 0;
  const errors: string[] = [];
  for (const account of accounts) {
    if (account.publications.length === 0) continue;
    try {
      const accessToken = await getYouTubeAccessToken(account);
      const publicationByVideoId = new Map(account.publications.map((publication) => [publication.externalId!, publication.id]));
      const ids = [...publicationByVideoId.keys()];
      for (let index = 0; index < ids.length; index += 50) {
        const statistics = await getYouTubeVideoStatistics(accessToken, ids.slice(index, index + 50));
        if (statistics.length === 0) continue;
        await database.publicationMetric.createMany({
          data: statistics.map((metric) => ({
            publicationId: publicationByVideoId.get(metric.id)!,
            views: metric.views,
            likes: metric.likes,
            comments: metric.comments,
          })),
        });
        await Promise.all(statistics.map((metric) => database.publication.update({
          where: { id: publicationByVideoId.get(metric.id)! },
          data: {
            privacyLevel: metric.privacyStatus,
            ...(metric.title ? { title: metric.title } : {}),
            ...(metric.publishedAt ? { publishedAt: metric.publishedAt } : {}),
          },
        })));
        updated += statistics.length;
      }
    } catch (error) {
      errors.push(`${account.displayName ?? account.username}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return { updated, errors };
};

const refreshTikTokAnalytics = async () => {
  if (!tiktokCredentials) return { updated: 0, linked: 0, errors: ["TikTok is not configured"] };
  const accounts = await database.contentAccount.findMany({
    where: { platform: "TIKTOK", active: true },
    select: {
      id: true, displayName: true, username: true, avatarUrl: true,
      accessTokenEncrypted: true, refreshTokenEncrypted: true,
      accessTokenExpiresAt: true, refreshTokenExpiresAt: true, authorizedScopes: true,
      publications: {
        where: { externalId: { not: null }, status: { in: ["DELIVERED", "PROCESSING", "PUBLISHED"] } },
        select: { id: true, externalId: true, platformPostId: true },
      },
    },
  });
  let updated = 0;
  let linked = 0;
  const errors: string[] = [];
  for (const account of accounts) {
    try {
      const uploadToken = await getTikTokAccessToken(account, "video.upload");
      const posts: Array<{ publicationId: string; postId: string }> = [];
      for (const publication of account.publications) {
        let postId = publication.platformPostId;
        if (!postId) {
          const remote = await fetchTikTokPostStatus(uploadToken, publication.externalId!);
          postId = remote.publicPostIds[0] ?? null;
          if (postId) {
            await database.publication.update({
              where: { id: publication.id },
              data: { platformPostId: postId, status: "PUBLISHED", publishedAt: new Date() },
            });
            linked += 1;
          }
        }
        if (postId) posts.push({ publicationId: publication.id, postId });
      }
      if (posts.length === 0) continue;
      const listToken = await getTikTokAccessToken(account, "video.list");
      const publicVideos = await listTikTokVideos(listToken);
      const publicationByPostId = new Map(posts.map((post) => [post.postId, post]));
      const publicationByRoundedPostId = new Map(posts.map((post) => [String(Number(post.postId)), post]));
      const matches = publicVideos.flatMap((metric) => {
        const publication = publicationByPostId.get(metric.id) ?? publicationByRoundedPostId.get(String(Number(metric.id)));
        return publication ? [{ metric, publication }] : [];
      });
      if (matches.length === 0) continue;
      await database.publicationMetric.createMany({
        data: matches.map(({ metric, publication }) => ({
          publicationId: publication.publicationId,
          views: metric.views,
          likes: metric.likes,
          comments: metric.comments,
          shares: metric.shares,
        })),
      });
      await Promise.all(matches.map(({ metric, publication }) => database.publication.update({
        where: { id: publication.publicationId },
        data: {
          platformPostId: metric.id,
          status: "PUBLISHED",
          ...(metric.title ? { title: metric.title } : {}),
          ...(metric.createdAt ? { publishedAt: metric.createdAt } : {}),
        },
      })));
      updated += matches.length;
    } catch (error) {
      errors.push(`${account.displayName ?? account.username}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return { updated, linked, errors };
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
};

const analyticsHourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tbilisi",
  hour: "2-digit",
  hour12: false,
});

const postingTimeSlot = (date: Date): string => {
  const hour = Number(analyticsHourFormatter.format(date)) % 24;
  if (hour < 6) return "Ночь · 00–06";
  if (hour < 12) return "Утро · 06–12";
  if (hour < 18) return "День · 12–18";
  return "Вечер · 18–24";
};

const titleLengthBucket = (title: string): string => {
  const words = title.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 2) return "Короткий · 1–2 слова";
  if (words <= 5) return "Средний · 3–5 слов";
  return "Длинный · 6+ слов";
};

const hashtagBucket = (count: number): string => {
  if (count <= 2) return "0–2 хэштега";
  if (count <= 4) return "3–4 хэштега";
  return "5+ хэштегов";
};

const normalizedPublishTitle = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 100) : fallback;
};

const getInstagramTarget = async (clipId: string) => {
  const clip = await database.clip.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      title: true,
      gameName: true,
      source: true,
      status: true,
      tiktokFilePath: true,
      twitchChannelId: true,
      kickChannelId: true,
      twitchChannel: { select: { login: true } },
      kickChannel: { select: { slug: true } },
    },
  });
  if (!clip) return null;
  const assignments = await database.channelAssignment.findMany({
    where: {
      platform: "INSTAGRAM",
      active: true,
      ...(clip.source === "TWITCH"
        ? { twitchChannelId: clip.twitchChannelId }
        : { kickChannelId: clip.kickChannelId }),
      contentAccount: { is: { active: true } },
    },
    select: {
      contentAccount: {
        select: {
          id: true,
          externalId: true,
          displayName: true,
          username: true,
          avatarUrl: true,
          accessTokenEncrypted: true,
          refreshTokenEncrypted: true,
          accessTokenExpiresAt: true,
          refreshTokenExpiresAt: true,
          authorizedScopes: true,
        },
      },
    },
  });
  return { clip, accounts: assignments.map((assignment) => assignment.contentAccount) };
};

const getInstagramAccessToken = async (account: PublishingAccountAuth | null) => {
  if (!account || !instagramCredentials || !account.accessTokenEncrypted) {
    throw new InstagramApiError("Instagram account must be reconnected", 401, "account_not_connected");
  }
  const accessToken = decryptToken(account.accessTokenEncrypted, instagramCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY);
  if (!account.accessTokenExpiresAt || account.accessTokenExpiresAt.getTime() > Date.now() + 7 * 24 * 60 * 60_000) {
    return accessToken;
  }
  const refreshed = await refreshInstagramToken(accessToken);
  await database.contentAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encryptToken(refreshed.access_token, instagramCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1_000),
    },
  });
  return refreshed.access_token;
};

const sendInstagramError = (reply: { status: (code: number) => { send: (body: object) => unknown } }, error: unknown) => {
  if (error instanceof InstagramApiError) {
    return reply.status(error.status >= 400 && error.status < 600 ? error.status : 502).send({
      error: error.message,
      code: error.code,
    });
  }
  throw error;
};

app.get("/health", async (_request, reply) => {
  try {
    await database.$queryRaw`SELECT 1`;
    if (redis.status === "wait") await redis.connect();
    const redisStatus = await redis.ping();
    return { status: "ok", database: "ok", redis: redisStatus.toLowerCase() };
  } catch (error) {
    app.log.error(error);
    return reply.status(503).send({ status: "error" });
  }
});

app.get<{ Querystring: { platform?: string } }>("/publishing/accounts", async (request, reply) => {
  const platform = request.query.platform;
  if (typeof platform !== "string" || !publishingPlatforms.has(platform)) {
    return reply.status(400).send({ error: "invalid publishing platform" });
  }
  return database.contentAccount.findMany({
    where: { platform: platform as "TIKTOK" | "YOUTUBE" | "INSTAGRAM", active: true },
    orderBy: { username: "asc" },
    select: publishingAccountSelect,
  });
});

app.get("/publishing/tiktok/status", async () => ({
  configured: Boolean(tiktokCredentials),
  connectUrl: tiktokCredentials
    ? `${new URL(tiktokCredentials.TIKTOK_REDIRECT_URI).origin}/actions/tiktok/connect`
    : null,
}));

app.get("/publishing/youtube/status", async () => ({
  configured: Boolean(youtubeCredentials),
  connectUrl: youtubeCredentials
    ? `${new URL(youtubeCredentials.YOUTUBE_REDIRECT_URI).origin}/actions/youtube/connect`
    : null,
}));

app.get("/publishing/instagram/status", async () => ({
  configured: Boolean(instagramCredentials),
  connectUrl: instagramCredentials
    ? `${new URL(instagramCredentials.INSTAGRAM_REDIRECT_URI).origin}/actions/instagram/connect`
    : null,
}));

app.post("/analytics/youtube/refresh", async (_request, reply) => {
  const result = await refreshYouTubeAnalytics();
  return reply.status(result.errors.length > 0 && result.updated === 0 ? 502 : 200).send(result);
});

app.post("/analytics/refresh", async (_request, reply) => {
  const [youtube, tiktok] = await Promise.all([refreshYouTubeAnalytics(), refreshTikTokAnalytics()]);
  const failed = youtube.updated === 0 && tiktok.updated === 0 && (youtube.errors.length > 0 || tiktok.errors.length > 0);
  return reply.status(failed ? 502 : 200).send({ youtube, tiktok });
});

app.get("/analytics/summary", async () => {
  const publications = await database.publication.findMany({
    where: {
      status: "PUBLISHED",
      OR: [
        { platform: "YOUTUBE", privacyLevel: "public", externalId: { not: null } },
        { platform: "TIKTOK", platformPostId: { not: null } },
      ],
    },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true, platform: true, externalId: true, platformPostId: true, title: true, publishedAt: true,
      contentAccountId: true,
      contentAccount: { select: { displayName: true, username: true } },
      clip: {
        select: {
          source: true, gameName: true,
          twitchChannel: { select: { login: true } },
          kickChannel: { select: { slug: true } },
        },
      },
      metrics: { orderBy: { recordedAt: "desc" }, take: 200 },
    },
  });
  const analyticsNow = Date.now();
  const rows = publications.flatMap((publication) => {
    const metric = publication.metrics[0];
    if (!metric) return [];
    const views = Number(metric.views);
    const likes = Number(metric.likes);
    const comments = Number(metric.comments);
    const shares = Number(metric.shares ?? 0n);
    const actualPublishedAt = publication.publishedAt ?? metric.recordedAt;
    const ageHours = Math.max(1, (analyticsNow - actualPublishedAt.getTime()) / 3_600_000);
    const hookTitle = publication.title.split(/\r?\n/)[0]?.trim() || publication.title;
    const hashtagCount = publication.title.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
    const growthForHours = (hours: number): number | null => {
      const cutoff = analyticsNow - hours * 3_600_000;
      const baseline = publication.metrics.find((sample) => sample.recordedAt.getTime() <= cutoff);
      return baseline ? Math.max(0, views - Number(baseline.views)) : null;
    };
    return [{
      id: publication.id,
      videoId: publication.platform === "TIKTOK" ? publication.platformPostId! : publication.externalId!,
      platform: publication.platform,
      title: hookTitle,
      accountId: publication.contentAccountId,
      account: publication.contentAccount.displayName ?? publication.contentAccount.username,
      accountUsername: publication.contentAccount.username,
      source: publication.clip.source,
      sourceChannel: publication.clip.twitchChannel?.login ?? publication.clip.kickChannel?.slug ?? "unknown",
      gameName: publication.clip.gameName,
      publishedAt: actualPublishedAt,
      recordedAt: metric.recordedAt,
      views, likes, comments, shares,
      viewsPerHour: views / ageHours,
      engagementRate: views > 0 ? (likes + comments + shares) / views : 0,
      ageHours,
      postingTime: postingTimeSlot(actualPublishedAt),
      titleLength: titleLengthBucket(hookTitle),
      hashtagGroup: hashtagBucket(hashtagCount),
      growth: {
        h1: growthForHours(1),
        h6: growthForHours(6),
        h24: growthForHours(24),
        h72: growthForHours(72),
      },
    }];
  });
  const baselines = new Map<string, number>();
  for (const row of rows) {
    if (baselines.has(row.accountId)) continue;
    baselines.set(row.accountId, median(rows
      .filter((item) => item.accountId === row.accountId && item.viewsPerHour > 0)
      .map((item) => item.viewsPerHour)));
  }
  const ranked = rows.map((row) => {
    const baseline = baselines.get(row.accountId) ?? 0;
    const ratio = baseline > 0 ? row.viewsPerHour / baseline : 0;
    const accountSampleSize = rows.filter((item) => item.accountId === row.accountId && item.views > 0).length;
    const performance = accountSampleSize < 5
      ? "COLLECTING"
      : ratio >= 2 && row.views >= 100 ? "VIRAL"
        : ratio >= 1.25 && row.views >= 30 ? "ABOVE"
          : ratio < 0.6 && row.ageHours >= 6 ? "WEAK"
            : "NORMAL";
    return { ...row, baseline, ratio, performance };
  }).toSorted((left, right) => right.views - left.views);

  type BreakdownDimension = "GAME" | "CHANNEL" | "TIME" | "TITLE" | "HASHTAGS";
  const makeBreakdown = (dimension: BreakdownDimension, labelFor: (row: typeof ranked[number]) => string) => {
    const groups = new Map<string, { platform: "YOUTUBE" | "TIKTOK"; label: string; items: typeof ranked }>();
    for (const row of ranked) {
      if (row.platform !== "YOUTUBE" && row.platform !== "TIKTOK") continue;
      const label = labelFor(row);
      const key = `${row.platform}\u0000${label}`;
      const existing = groups.get(key);
      if (existing) existing.items.push(row);
      else groups.set(key, { platform: row.platform, label, items: [row] });
    }
    return [...groups.values()].map((group) => ({
      dimension,
      platform: group.platform,
      label: group.label,
      videos: group.items.length,
      views: group.items.reduce((sum, row) => sum + row.views, 0),
      medianRatio: median(group.items.map((row) => row.ratio)),
      medianViewsPerHour: median(group.items.map((row) => row.viewsPerHour)),
      engagementRate: group.items.reduce((sum, row) => sum + row.likes + row.comments + row.shares, 0)
        / Math.max(1, group.items.reduce((sum, row) => sum + row.views, 0)),
    })).toSorted((left, right) => right.medianRatio - left.medianRatio || right.videos - left.videos);
  };
  const breakdowns = {
    games: makeBreakdown("GAME", (row) => row.gameName || "Без игры"),
    channels: makeBreakdown("CHANNEL", (row) => `${row.source} @${row.sourceChannel}`),
    postingTimes: makeBreakdown("TIME", (row) => row.postingTime),
    titleLengths: makeBreakdown("TITLE", (row) => row.titleLength),
    hashtags: makeBreakdown("HASHTAGS", (row) => row.hashtagGroup),
  };

  const insights: string[] = [];
  for (const platform of ["YOUTUBE", "TIKTOK"] as const) {
    const leader = ranked.find((row) => row.platform === platform);
    if (leader) insights.push(`${platform === "YOUTUBE" ? "YouTube" : "TikTok"}: лидер «${leader.title}» — ${leader.views.toLocaleString("ru-RU")} просмотров.`);
    const platformName = platform === "YOUTUBE" ? "YouTube" : "TikTok";
    const bestTime = breakdowns.postingTimes.find((item) => item.platform === platform && item.videos >= 3);
    const bestTitle = breakdowns.titleLengths.find((item) => item.platform === platform && item.videos >= 3);
    const bestGame = breakdowns.games.find((item) => item.platform === platform && item.videos >= 3);
    if (bestTime && bestTime.medianRatio >= 1) insights.push(`${platformName}: лучший подтверждённый слот — ${bestTime.label.toLocaleLowerCase()} (×${bestTime.medianRatio.toFixed(1)} к норме аккаунта, ${bestTime.videos} видео).`);
    if (bestTitle && bestTitle.medianRatio >= 1) insights.push(`${platformName}: лучше работает формат «${bestTitle.label.toLocaleLowerCase()}» (×${bestTitle.medianRatio.toFixed(1)}, ${bestTitle.videos} видео).`);
    if (bestGame && bestGame.medianRatio >= 1) insights.push(`${platformName}: среди игр лидирует ${bestGame.label} (×${bestGame.medianRatio.toFixed(1)}, ${bestGame.videos} видео).`);
  }
  if (insights.length === 0) insights.push(ranked.length < 10
    ? "Нужно минимум 5–10 публичных роликов на канал, чтобы рекомендации по заголовкам стали надёжными."
    : "Данных уже достаточно для рейтинга, но устойчивой связи с длиной заголовка пока нет — продолжаем собирать историю.");
  const summarize = (items: typeof ranked) => ({
    videos: items.length,
    views: items.reduce((sum, row) => sum + row.views, 0),
    likes: items.reduce((sum, row) => sum + row.likes, 0),
    comments: items.reduce((sum, row) => sum + row.comments, 0),
    shares: items.reduce((sum, row) => sum + row.shares, 0),
  });
  return {
    totals: summarize(ranked),
    platforms: {
      YOUTUBE: summarize(ranked.filter((row) => row.platform === "YOUTUBE")),
      TIKTOK: summarize(ranked.filter((row) => row.platform === "TIKTOK")),
    },
    breakdowns,
    insights,
    momentum: ranked
      .filter((row) => row.growth.h1 !== null || row.growth.h6 !== null || row.growth.h24 !== null || row.growth.h72 !== null)
      .toSorted((left, right) => (
        (right.growth.h24 ?? right.growth.h6 ?? right.growth.h1 ?? right.growth.h72 ?? 0)
        - (left.growth.h24 ?? left.growth.h6 ?? left.growth.h1 ?? left.growth.h72 ?? 0)
      ))
      .slice(0, 10),
    videos: (["YOUTUBE", "TIKTOK"] as const).flatMap((platform) => ranked
      .filter((row) => row.platform === platform)
      .slice(0, 20)),
    updatedAt: ranked.reduce<Date | null>((latest, row) => (
      !latest || row.recordedAt > latest ? row.recordedAt : latest
    ), null),
  };
});

app.get<{ Params: { id: string } }>("/clips/:id/title-suggestions", async (request, reply) => {
  if (!uuidPattern.test(request.params.id)) return reply.status(400).send({ error: "invalid clip id" });
  const [clip, publications] = await Promise.all([
    database.clip.findUnique({
      where: { id: request.params.id },
      select: {
        title: true, gameName: true, source: true,
        twitchChannel: { select: { login: true } },
        kickChannel: { select: { slug: true } },
      },
    }),
    database.publication.findMany({
      where: { status: "PUBLISHED", platform: { in: ["YOUTUBE", "TIKTOK"] }, publishedAt: { not: null } },
      select: {
        platform: true, title: true, publishedAt: true,
        metrics: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    }),
  ]);
  if (!clip) return reply.status(404).send({ error: "clip not found" });

  const preferredTitleLength = (platform: "YOUTUBE" | "TIKTOK") => {
    const groups = new Map<string, number[]>();
    for (const publication of publications) {
      if (publication.platform !== platform || !publication.publishedAt || !publication.metrics[0]) continue;
      const hook = publication.title.split(/\r?\n/)[0]?.trim() || publication.title;
      const ageHours = Math.max(1, (Date.now() - publication.publishedAt.getTime()) / 3_600_000);
      const speed = Number(publication.metrics[0].views) / ageHours;
      const bucket = titleLengthBucket(hook);
      groups.set(bucket, [...(groups.get(bucket) ?? []), speed]);
    }
    const reliable = [...groups.entries()]
      .filter(([, speeds]) => speeds.length >= 3)
      .map(([label, speeds]) => ({ label, videos: speeds.length, score: median(speeds) }))
      .toSorted((left, right) => right.score - left.score);
    return reliable[0] ?? {
      label: platform === "TIKTOK" ? "Короткий · 1–2 слова" : "Средний · 3–5 слов",
      videos: 0,
      score: 0,
    };
  };

  const preferences = {
    YOUTUBE: preferredTitleLength("YOUTUBE"),
    TIKTOK: preferredTitleLength("TIKTOK"),
  };
  const original = normalizedPublishTitle(clip.title, "Стрим-хайлайт").replace(/#+/g, "").trim();
  const game = normalizedPublishTitle(clip.gameName, "игре");
  const channel = normalizedPublishTitle(clip.twitchChannel?.login ?? clip.kickChannel?.slug, "стример");
  const candidates = [
    original,
    `${original} — ТАКОГО НЕ ЖДАЛИ`,
    `ВОТ ЭТО ${original}`,
    `ТАКОГО В ${game} НЕ ЖДЁШЬ`,
    `${channel}: ${original}`,
    `ЧТО СЛУЧИЛОСЬ В ${game}?`,
  ].map((title) => normalizedPublishTitle(title, original));
  const uniqueCandidates = [...new Map(candidates.map((title) => [title.toLocaleLowerCase(), title])).values()];
  return {
    original,
    preferences,
    suggestions: uniqueCandidates.map((title) => ({
      title,
      words: title.split(/\s+/).filter(Boolean).length,
      fits: (["YOUTUBE", "TIKTOK"] as const).filter((platform) => titleLengthBucket(title) === preferences[platform].label),
    })),
  };
});

app.post<{
  Body: { accessToken?: string; expiresIn?: number; scope?: string };
}>("/publishing/instagram/connect", async (request, reply) => {
  if (!instagramCredentials) return reply.status(503).send({ error: "Instagram is not configured" });
  const { accessToken, expiresIn, scope } = request.body ?? {};
  if (
    typeof accessToken !== "string" || accessToken.length < 8
    || typeof expiresIn !== "number" || expiresIn <= 0
    || typeof scope !== "string"
  ) return reply.status(400).send({ error: "invalid Instagram authorization payload" });

  try {
    const profile = await getInstagramProfile(accessToken, instagramCredentials.INSTAGRAM_GRAPH_VERSION);
    const now = Date.now();
    const account = await database.contentAccount.upsert({
      where: { platform_externalId: { platform: "INSTAGRAM", externalId: profile.id } },
      create: {
        platform: "INSTAGRAM",
        externalId: profile.id,
        username: profile.username.toLocaleLowerCase(),
        displayName: profile.name ?? profile.username,
        avatarUrl: profile.profilePictureUrl ?? null,
        accessTokenEncrypted: encryptToken(accessToken, instagramCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
        accessTokenExpiresAt: new Date(now + expiresIn * 1_000),
        authorizedScopes: scope,
        connectedAt: new Date(now),
      },
      update: {
        active: true,
        username: profile.username.toLocaleLowerCase(),
        displayName: profile.name ?? profile.username,
        avatarUrl: profile.profilePictureUrl ?? null,
        accessTokenEncrypted: encryptToken(accessToken, instagramCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
        accessTokenExpiresAt: new Date(now + expiresIn * 1_000),
        authorizedScopes: scope,
        connectedAt: new Date(now),
      },
      select: publishingAccountSelect,
    });
    return reply.status(201).send(account);
  } catch (error) {
    return sendInstagramError(reply, error);
  }
});

app.post<{
  Body: { accessToken?: string; refreshToken?: string; expiresIn?: number; scope?: string };
}>("/publishing/youtube/connect", async (request, reply) => {
  if (!youtubeCredentials) return reply.status(503).send({ error: "YouTube is not configured" });
  const { accessToken, refreshToken, expiresIn, scope } = request.body ?? {};
  if (
    typeof accessToken !== "string" || accessToken.length < 8
    || typeof refreshToken !== "string" || refreshToken.length < 8
    || typeof expiresIn !== "number" || expiresIn <= 0
    || typeof scope !== "string"
  ) return reply.status(400).send({ error: "invalid YouTube authorization payload" });

  try {
    const channel = await getYouTubeChannelProfile(accessToken);
    const now = Date.now();
    const username = channel.customUrl?.replace(/^@/, "").toLocaleLowerCase() || `channel_${channel.id.toLocaleLowerCase()}`;
    const account = await database.contentAccount.upsert({
      where: { platform_externalId: { platform: "YOUTUBE", externalId: channel.id } },
      create: {
        platform: "YOUTUBE",
        externalId: channel.id,
        username,
        displayName: channel.title,
        avatarUrl: channel.thumbnailUrl ?? null,
        accessTokenEncrypted: encryptToken(accessToken, youtubeCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
        refreshTokenEncrypted: encryptToken(refreshToken, youtubeCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
        accessTokenExpiresAt: new Date(now + expiresIn * 1_000),
        authorizedScopes: scope,
        connectedAt: new Date(now),
      },
      update: {
        active: true,
        username,
        displayName: channel.title,
        avatarUrl: channel.thumbnailUrl ?? null,
        accessTokenEncrypted: encryptToken(accessToken, youtubeCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
        refreshTokenEncrypted: encryptToken(refreshToken, youtubeCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
        accessTokenExpiresAt: new Date(now + expiresIn * 1_000),
        authorizedScopes: scope,
        connectedAt: new Date(now),
      },
      select: publishingAccountSelect,
    });
    return reply.status(201).send(account);
  } catch (error) {
    return sendYouTubeError(reply, error);
  }
});

app.post<{
  Body: {
    openId?: string;
    displayName?: string;
    avatarUrl?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    refreshExpiresIn?: number;
    scope?: string;
  };
}>("/publishing/tiktok/connect", async (request, reply) => {
  if (!tiktokCredentials) return reply.status(503).send({ error: "TikTok is not configured" });
  const {
    openId,
    displayName,
    avatarUrl,
    accessToken,
    refreshToken,
    expiresIn,
    refreshExpiresIn,
    scope,
  } = request.body ?? {};
  if (
    typeof openId !== "string" || openId.length < 4
    || typeof accessToken !== "string" || accessToken.length < 8
    || typeof refreshToken !== "string" || refreshToken.length < 8
    || typeof expiresIn !== "number" || expiresIn <= 0
    || typeof refreshExpiresIn !== "number" || refreshExpiresIn <= 0
    || typeof scope !== "string"
  ) {
    return reply.status(400).send({ error: "invalid TikTok authorization payload" });
  }
  const now = Date.now();
  const internalUsername = `tiktok_${createHash("sha256").update(openId).digest("hex").slice(0, 16)}`;
  const account = await database.contentAccount.upsert({
    where: { platform_externalId: { platform: "TIKTOK", externalId: openId } },
    create: {
      platform: "TIKTOK",
      externalId: openId,
      username: internalUsername,
      displayName: typeof displayName === "string" ? displayName : "TikTok account",
      avatarUrl: typeof avatarUrl === "string" ? avatarUrl : null,
      accessTokenEncrypted: encryptToken(accessToken, tiktokCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
      refreshTokenEncrypted: encryptToken(refreshToken, tiktokCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
      accessTokenExpiresAt: new Date(now + expiresIn * 1_000),
      refreshTokenExpiresAt: new Date(now + refreshExpiresIn * 1_000),
      authorizedScopes: scope,
      connectedAt: new Date(now),
    },
    update: {
      active: true,
      displayName: typeof displayName === "string" ? displayName : "TikTok account",
      avatarUrl: typeof avatarUrl === "string" ? avatarUrl : null,
      accessTokenEncrypted: encryptToken(accessToken, tiktokCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
      refreshTokenEncrypted: encryptToken(refreshToken, tiktokCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY),
      accessTokenExpiresAt: new Date(now + expiresIn * 1_000),
      refreshTokenExpiresAt: new Date(now + refreshExpiresIn * 1_000),
      authorizedScopes: scope,
      connectedAt: new Date(now),
    },
    select: publishingAccountSelect,
  });
  return reply.status(201).send(account);
});

app.post<{ Body: { platform?: string; username?: string } }>("/publishing/accounts", async (request, reply) => {
  const platform = request.body?.platform;
  const rawUsername = request.body?.username;
  if (typeof platform !== "string" || !publishingPlatforms.has(platform)) {
    return reply.status(400).send({ error: "invalid publishing platform" });
  }
  const username = typeof rawUsername === "string"
    ? rawUsername.trim().replace(/^@/, "").toLocaleLowerCase()
    : "";
  if (!/^[a-z0-9._]{2,24}$/.test(username)) {
    return reply.status(400).send({ error: "invalid account username" });
  }
  const account = await database.contentAccount.upsert({
    where: { platform_username: { platform: platform as "TIKTOK" | "YOUTUBE" | "INSTAGRAM", username } },
    create: { platform: platform as "TIKTOK" | "YOUTUBE" | "INSTAGRAM", username },
    update: { active: true },
    select: publishingAccountSelect,
  });
  return reply.status(201).send(account);
});

app.delete<{ Params: { id: string } }>("/publishing/accounts/:id", async (request, reply) => {
  const accountId = request.params.id;
  if (!uuidPattern.test(accountId)) return reply.status(400).send({ error: "invalid account id" });
  const account = await database.contentAccount.findFirst({
    where: { id: accountId, active: true },
    select: { platform: true, accessTokenEncrypted: true },
  });
  if (!account) return reply.status(404).send({ error: "account not found" });
  if (account.platform === "TIKTOK" && account.accessTokenEncrypted && tiktokCredentials) {
    try {
      const token = decryptToken(account.accessTokenEncrypted, tiktokCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY);
      await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: tiktokCredentials.TIKTOK_CLIENT_KEY,
          client_secret: tiktokCredentials.TIKTOK_CLIENT_SECRET,
          token,
        }),
      });
    } catch (error) {
      app.log.warn({ error, accountId }, "Failed to revoke TikTok token; removing local access");
    }
  }
  if (account.platform === "YOUTUBE" && account.accessTokenEncrypted && youtubeCredentials) {
    try {
      const token = decryptToken(account.accessTokenEncrypted, youtubeCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
    } catch (error) {
      app.log.warn({ error, accountId }, "Failed to revoke YouTube token; removing local access");
    }
  }
  const result = await database.$transaction(async (transaction) => {
    await transaction.channelAssignment.deleteMany({ where: { contentAccountId: accountId } });
    return transaction.contentAccount.updateMany({
      where: { id: accountId, active: true },
      data: { active: false },
    });
  });
  if (result.count === 0) return reply.status(404).send({ error: "account not found" });
  return reply.status(204).send();
});

app.get<{ Querystring: { platform?: string } }>("/publishing/assignments", async (request, reply) => {
  const platform = request.query.platform;
  if (typeof platform !== "string" || !publishingPlatforms.has(platform)) {
    return reply.status(400).send({ error: "invalid publishing platform" });
  }
  return database.channelAssignment.findMany({
    where: { platform: platform as "TIKTOK" | "YOUTUBE" | "INSTAGRAM", active: true },
    select: { id: true, contentAccountId: true, twitchChannelId: true, kickChannelId: true },
  });
});

app.put<{
  Body: {
    platform?: string;
    contentAccountId?: string | null;
    twitchChannelId?: string;
    kickChannelId?: string;
    enabled?: boolean;
  };
}>("/publishing/assignments", async (request, reply) => {
  const { platform, contentAccountId, twitchChannelId, kickChannelId, enabled } = request.body ?? {};
  if (typeof platform !== "string" || !publishingPlatforms.has(platform)) {
    return reply.status(400).send({ error: "invalid publishing platform" });
  }
  const isTwitch = typeof twitchChannelId === "string";
  const sourceChannelId = isTwitch ? twitchChannelId : kickChannelId;
  if (
    (typeof twitchChannelId === "string") === (typeof kickChannelId === "string")
    || typeof sourceChannelId !== "string"
    || !uuidPattern.test(sourceChannelId)
  ) {
    return reply.status(400).send({ error: "exactly one valid source channel is required" });
  }
  if (contentAccountId !== null && (typeof contentAccountId !== "string" || !uuidPattern.test(contentAccountId))) {
    return reply.status(400).send({ error: "invalid content account id" });
  }

  const typedPlatform = platform as "TIKTOK" | "YOUTUBE" | "INSTAGRAM";
  const sourceWhere = isTwitch
    ? { twitchChannelId: sourceChannelId }
    : { kickChannelId: sourceChannelId };
  if (contentAccountId) {
    const [account, channelExists] = await Promise.all([
      database.contentAccount.findFirst({
        where: { id: contentAccountId, platform: typedPlatform, active: true },
        select: { id: true },
      }),
      isTwitch
        ? database.twitchChannel.findFirst({ where: { id: sourceChannelId, active: true }, select: { id: true } })
        : database.kickChannel.findFirst({ where: { id: sourceChannelId, active: true }, select: { id: true } }),
    ]);
    if (!account) return reply.status(404).send({ error: "publishing account not found" });
    if (!channelExists) return reply.status(404).send({ error: "source channel not found" });
  }

  const assignment = await database.$transaction(async (transaction) => {
    if ((typedPlatform === "TIKTOK" || typedPlatform === "YOUTUBE" || typedPlatform === "INSTAGRAM") && contentAccountId) {
      if (enabled === false) {
        await transaction.channelAssignment.deleteMany({
          where: { platform: typedPlatform, contentAccountId, ...sourceWhere },
        });
        return null;
      }
      const existing = await transaction.channelAssignment.findFirst({
        where: { platform: typedPlatform, contentAccountId, ...sourceWhere },
        select: { id: true },
      });
      if (existing) {
        return transaction.channelAssignment.update({
          where: { id: existing.id },
          data: { active: true },
          select: { id: true, contentAccountId: true, twitchChannelId: true, kickChannelId: true },
        });
      }
      return transaction.channelAssignment.create({
        data: {
          platform: typedPlatform,
          contentAccountId,
          ...(isTwitch ? { twitchChannelId: sourceChannelId } : { kickChannelId: sourceChannelId }),
        },
        select: { id: true, contentAccountId: true, twitchChannelId: true, kickChannelId: true },
      });
    }
    await transaction.channelAssignment.deleteMany({
      where: { platform: typedPlatform, ...sourceWhere },
    });
    if (!contentAccountId) return null;
    return transaction.channelAssignment.create({
      data: {
        platform: typedPlatform,
        contentAccountId,
        ...(isTwitch ? { twitchChannelId: sourceChannelId } : { kickChannelId: sourceChannelId }),
      },
      select: { id: true, contentAccountId: true, twitchChannelId: true, kickChannelId: true },
    });
  });
  return { assignment };
});

app.get("/kick/channels", async () => {
  return database.kickChannel.findMany({
    where: { active: true },
    orderBy: { displayName: "asc" },
    include: {
      _count: { select: { clips: true } },
      clips: {
        where: { thumbnailUrl: { not: null } },
        orderBy: { sourceCreatedAt: "desc" },
        take: 10,
        select: { id: true, thumbnailUrl: true },
      },
    },
  });
});

app.patch<{
  Params: { id: string };
  Body: { crop?: { x?: number; y?: number; width?: number; height?: number } | null; webcamOnly?: boolean };
}>("/kick/channels/:id/webcam", async (request, reply) => {
  const channelId = request.params.id;
  if (!uuidPattern.test(channelId)) return reply.status(400).send({ error: "invalid channel id" });
  const crop = request.body?.crop;
  if (crop !== null && !isValidWebcamCrop(crop)) {
    return reply.status(400).send({ error: "invalid webcam crop" });
  }
  if (request.body?.webcamOnly !== undefined && typeof request.body.webcamOnly !== "boolean") {
    return reply.status(400).send({ error: "invalid webcam mode" });
  }
  try {
    return await database.kickChannel.update({
      where: { id: channelId, active: true },
      data: crop === null
        ? { webcamX: null, webcamY: null, webcamWidth: null, webcamHeight: null, webcamOnly: false }
        : { webcamX: crop.x, webcamY: crop.y, webcamWidth: crop.width, webcamHeight: crop.height, webcamOnly: request.body.webcamOnly === true },
    });
  } catch {
    return reply.status(404).send({ error: "channel not found" });
  }
});

app.post<{ Body: { slug?: string } }>("/kick/channels", async (request, reply) => {
  if (typeof request.body?.slug !== "string") {
    return reply.status(400).send({ error: "slug is required" });
  }

  try {
    const channel = await ensureKickChannel(database, kickClient, request.body.slug);
    await clipDiscoveryQueue.add(
      KICK_COLLECT_JOB,
      { channelId: channel.id, slug: channel.slug },
      { removeOnComplete: 100, removeOnFail: 100 },
    );
    return reply.status(201).send(channel);
  } catch (error) {
    if (error instanceof KickApiError) {
      return reply.status(error.status === 404 ? 404 : 502).send({ error: error.message });
    }
    throw error;
  }
});

app.delete<{ Params: { id: string } }>("/kick/channels/:id", async (request, reply) => {
  const channelId = request.params.id;
  if (!uuidPattern.test(channelId)) {
    return reply.status(400).send({ error: "invalid channel id" });
  }

  const result = await database.kickChannel.updateMany({
    where: { id: channelId, active: true },
    data: { active: false },
  });
  if (result.count === 0) {
    return reply.status(404).send({ error: "channel not found" });
  }
  return reply.status(204).send();
});

app.post("/kick/collect", async () => {
  const channels = await database.kickChannel.findMany({
    where: { active: true },
    select: { id: true, slug: true },
  });
  await clipDiscoveryQueue.addBulk(
    channels.map((channel) => ({
      name: KICK_COLLECT_JOB,
      data: { channelId: channel.id, slug: channel.slug },
      opts: { removeOnComplete: 100, removeOnFail: 100 },
    })),
  );
  return { queued: channels.length };
});

app.get("/kick/status", async () => {
  const [counts, schedulers, channels, clips, metrics] = await Promise.all([
    clipDiscoveryQueue.getJobCounts("active", "waiting", "delayed", "failed", "completed"),
    clipDiscoveryQueue.getJobSchedulers(0, 10),
    database.kickChannel.count({ where: { active: true } }),
    database.clip.count({
      where: { source: "KICK", kickChannel: { is: { active: true } } },
    }),
    database.clipMetric.count({
      where: { clip: { source: "KICK", kickChannel: { is: { active: true } } } },
    }),
  ]);
  return { counts, schedulers, channels, clips, metrics, intervalMinutes: 5 };
});

app.get<{ Querystring: { limit?: string } }>("/kick/clips", async (request) => {
  const requestedLimit = Number(request.query.limit ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(200, Math.max(1, Math.trunc(requestedLimit)))
    : 50;
  return database.clip.findMany({
    where: { source: "KICK", kickChannel: { is: { active: true } } },
    orderBy: { sourceCreatedAt: "desc" },
    take: limit,
    include: {
      kickChannel: { select: { slug: true, displayName: true } },
      metrics: {
        orderBy: { recordedAt: "desc" },
        take: 1,
      },
    },
  });
});

app.get("/twitch/channels", async () => {
  return database.twitchChannel.findMany({
    where: { active: true },
    orderBy: { displayName: "asc" },
    include: {
      _count: { select: { clips: true } },
      clips: {
        where: { thumbnailUrl: { not: null } },
        orderBy: { sourceCreatedAt: "desc" },
        take: 10,
        select: { id: true, thumbnailUrl: true },
      },
    },
  });
});

app.patch<{
  Params: { id: string };
  Body: { crop?: { x?: number; y?: number; width?: number; height?: number } | null; webcamOnly?: boolean };
}>("/twitch/channels/:id/webcam", async (request, reply) => {
  const channelId = request.params.id;
  if (!uuidPattern.test(channelId)) return reply.status(400).send({ error: "invalid channel id" });
  const crop = request.body?.crop;
  if (crop !== null && !isValidWebcamCrop(crop)) {
    return reply.status(400).send({ error: "invalid webcam crop" });
  }
  if (request.body?.webcamOnly !== undefined && typeof request.body.webcamOnly !== "boolean") {
    return reply.status(400).send({ error: "invalid webcam mode" });
  }
  try {
    return await database.twitchChannel.update({
      where: { id: channelId, active: true },
      data: crop === null
        ? { webcamX: null, webcamY: null, webcamWidth: null, webcamHeight: null, webcamOnly: false }
        : { webcamX: crop.x, webcamY: crop.y, webcamWidth: crop.width, webcamHeight: crop.height, webcamOnly: request.body.webcamOnly === true },
    });
  } catch {
    return reply.status(404).send({ error: "channel not found" });
  }
});

app.post<{ Body: { login?: string } }>("/twitch/channels", async (request, reply) => {
  if (typeof request.body?.login !== "string") {
    return reply.status(400).send({ error: "login is required" });
  }

  try {
    const channel = await ensureTwitchChannel(database, twitchClient, request.body.login);
    await clipDiscoveryQueue.add(
      TWITCH_COLLECT_JOB,
      { channelId: channel.id, login: channel.login } satisfies TwitchCollectJobData,
      { removeOnComplete: 100, removeOnFail: 100 },
    );
    return reply.status(201).send(channel);
  } catch (error) {
    if (error instanceof TwitchApiError) {
      return reply.status(error.status === 404 ? 404 : 502).send({ error: error.message });
    }
    throw error;
  }
});

app.delete<{ Params: { id: string } }>("/twitch/channels/:id", async (request, reply) => {
  const channelId = request.params.id;
  if (!uuidPattern.test(channelId)) {
    return reply.status(400).send({ error: "invalid channel id" });
  }
  const result = await database.twitchChannel.updateMany({
    where: { id: channelId, active: true },
    data: { active: false },
  });
  if (result.count === 0) {
    return reply.status(404).send({ error: "channel not found" });
  }
  return reply.status(204).send();
});

app.post("/twitch/collect", async () => {
  const channels = await database.twitchChannel.findMany({
    where: { active: true },
    select: { id: true, login: true },
  });
  await clipDiscoveryQueue.addBulk(
    channels.map((channel) => ({
      name: TWITCH_COLLECT_JOB,
      data: { channelId: channel.id, login: channel.login } satisfies TwitchCollectJobData,
      opts: { removeOnComplete: 100, removeOnFail: 100 },
    })),
  );
  return { queued: channels.length, configured: true };
});

app.get("/twitch/status", async () => {
  const [counts, schedulers, channels, clips, metrics] = await Promise.all([
    clipDiscoveryQueue.getJobCounts("active", "waiting", "delayed", "failed", "completed"),
    clipDiscoveryQueue.getJobSchedulers(0, 20),
    database.twitchChannel.count({ where: { active: true } }),
    database.clip.count({
      where: { source: "TWITCH", twitchChannel: { is: { active: true } } },
    }),
    database.clipMetric.count({
      where: { clip: { source: "TWITCH", twitchChannel: { is: { active: true } } } },
    }),
  ]);
  return {
    configured: true,
    mode: twitchCredentials ? "helix" : "anonymous-web",
    counts,
    schedulers: schedulers.filter((scheduler) => scheduler.key === TWITCH_POLL_SCHEDULER_ID),
    channels,
    clips,
    metrics,
    intervalMinutes: 5,
  };
});

app.get<{ Querystring: { limit?: string } }>("/twitch/clips", async (request) => {
  const requestedLimit = Number(request.query.limit ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(200, Math.max(1, Math.trunc(requestedLimit)))
    : 50;
  return database.clip.findMany({
    where: { source: "TWITCH", twitchChannel: { is: { active: true } } },
    orderBy: { sourceCreatedAt: "desc" },
    take: limit,
    include: {
      twitchChannel: { select: { login: true, displayName: true } },
      metrics: { orderBy: { recordedAt: "desc" }, take: 1 },
    },
  });
});

app.get<{ Params: { id: string } }>("/clips/:id/publish/tiktok/options", async (request, reply) => {
  if (!uuidPattern.test(request.params.id)) return reply.status(400).send({ error: "invalid clip id" });
  const target = await getTikTokTarget(request.params.id);
  if (!target) return reply.status(404).send({ error: "clip not found" });
  if (target.accounts.length === 0) return reply.status(409).send({ error: "Assign a TikTok account to this source channel first" });
  try {
    await Promise.all(target.accounts.map((account) => getTikTokAccessToken(account)));
    const latestPublication = await database.publication.findFirst({
      where: { clipId: target.clip.id, platform: "TIKTOK" },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, error: true },
    });
    return {
      account: {
        id: target.accounts[0]!.id,
        displayName: target.accounts[0]!.displayName ?? target.accounts[0]!.username,
        avatarUrl: target.accounts[0]!.avatarUrl,
      },
      accounts: target.accounts.map((account) => ({
        id: account.id,
        displayName: account.displayName ?? account.username,
        avatarUrl: account.avatarUrl,
      })),
      clip: {
        title: buildTikTokCaption(
          target.clip.title,
          target.clip.source,
          target.clip.twitchChannel?.login ?? target.clip.kickChannel?.slug,
          target.clip.gameName,
        ),
        durationSeconds: target.clip.durationSeconds,
        approved: target.clip.status === "APPROVED",
        tiktokReady: Boolean(target.clip.tiktokFilePath),
      },
      latestPublication,
    };
  } catch (error) {
    return sendTikTokError(reply, error);
  }
});

app.post<{
  Params: { id: string };
  Body: { consent?: boolean; title?: string; repeat?: boolean };
}>("/clips/:id/draft/tiktok", async (request, reply) => {
  const clipId = request.params.id;
  if (!uuidPattern.test(clipId)) return reply.status(400).send({ error: "invalid clip id" });
  const target = await getTikTokTarget(clipId);
  if (!target) return reply.status(404).send({ error: "clip not found" });
  if (target.accounts.length === 0) return reply.status(409).send({ error: "TikTok account is not assigned" });
  const allowedStatuses = request.body?.repeat === true ? ["APPROVED", "DRAFTED", "PUBLISHED"] : ["APPROVED"];
  if (!target.clip.status || !allowedStatuses.includes(target.clip.status)) {
    return reply.status(409).send({ error: "Approve the clip before sending it to drafts" });
  }
  if (!target.clip.tiktokFilePath) return reply.status(409).send({ error: "Prepare the TikTok video first", code: "video_not_ready" });

  const body = request.body;
  if (!body || body.consent !== true) return reply.status(400).send({ error: "TikTok upload consent is required" });
  const publishTitle = normalizedPublishTitle(body.title, target.clip.title);

  const mediaPath = resolve(target.clip.tiktokFilePath);
  if (!mediaPath.startsWith(`${storageRoot}${sep}`)) return reply.status(403).send({ error: "invalid media path" });
  let mediaSize: number;
  try {
    mediaSize = (await stat(mediaPath)).size;
  } catch {
    return reply.status(409).send({ error: "TikTok video file is missing", code: "video_not_ready" });
  }
  const publications: Array<{ id: string; status: string }> = [];
  const failures: unknown[] = [];
  for (const account of target.accounts) {
    const existing = request.body.repeat === true ? null : await database.publication.findFirst({
      where: {
        clipId,
        platform: "TIKTOK",
        contentAccountId: account.id,
        privacyLevel: "TIKTOK_INBOX",
        status: { in: ["UPLOADING", "PROCESSING", "DELIVERED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (existing) {
      publications.push(existing);
      continue;
    }

    let publicationId: string | null = null;
    try {
      const accessToken = await getTikTokAccessToken(account);
      const publication = await database.publication.create({
        data: {
          platform: "TIKTOK",
          clipId,
          contentAccountId: account.id,
          title: buildTikTokCaption(
            publishTitle,
            target.clip.source,
            target.clip.twitchChannel?.login ?? target.clip.kickChannel?.slug,
            target.clip.gameName,
          ),
          privacyLevel: "TIKTOK_INBOX",
        },
        select: { id: true },
      });
      publicationId = publication.id;
      const initialized = await initializeTikTokVideoUpload(accessToken, mediaSize);
      await database.publication.update({
        where: { id: publication.id },
        data: { externalId: initialized.publishId },
      });
      await uploadTikTokVideo(
        initialized.uploadUrl,
        mediaPath,
        mediaSize,
        initialized.chunkSize,
        initialized.totalChunkCount,
      );
      publications.push(await database.publication.update({
        where: { id: publication.id },
        data: { status: "PROCESSING" },
        select: { id: true, status: true },
      }));
    } catch (error) {
      failures.push(error);
      if (publicationId) {
        await database.publication.update({
          where: { id: publicationId },
          data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown publishing error" },
        });
      }
    }
  }
  if (publications.length === 0) return sendTikTokError(reply, failures[0]);
  return reply.status(202).send({
    publications,
    warning: failures.length > 0
      ? failures.map((error) => error instanceof Error ? error.message : "Unknown publishing error").join("; ")
      : undefined,
  });
});

app.post<{ Params: { id: string }; Body: { consent?: boolean; title?: string; repeat?: boolean } }>("/clips/:id/publish/youtube", async (request, reply) => {
  const clipId = request.params.id;
  if (!uuidPattern.test(clipId)) return reply.status(400).send({ error: "invalid clip id" });
  if (!request.body || request.body.consent !== true) return reply.status(400).send({ error: "YouTube upload consent is required" });
  const target = await getYouTubeTarget(clipId);
  if (!target) return reply.status(404).send({ error: "clip not found" });
  if (target.accounts.length === 0) return reply.status(409).send({ error: "YouTube account is not assigned" });
  if (!youtubeCredentials) return reply.status(503).send({ error: "YouTube is not configured" });
  if (!target.clip.tiktokFilePath) return reply.status(409).send({ error: "Prepare the vertical video first", code: "video_not_ready" });
  const allowedStatuses = request.body.repeat === true ? ["APPROVED", "DRAFTED", "PUBLISHED"] : ["APPROVED", "DRAFTED"];
  if (!target.clip.status || !allowedStatuses.includes(target.clip.status)) {
    return reply.status(409).send({ error: "Approve the clip before publishing" });
  }

  const mediaPath = resolve(target.clip.tiktokFilePath);
  if (!mediaPath.startsWith(`${storageRoot}${sep}`)) return reply.status(403).send({ error: "invalid media path" });
  let mediaSize: number;
  try {
    mediaSize = (await stat(mediaPath)).size;
  } catch {
    return reply.status(409).send({ error: "Vertical video file is missing", code: "video_not_ready" });
  }

  const username = target.clip.twitchChannel?.login ?? target.clip.kickChannel?.slug;
  const publishTitle = normalizedPublishTitle(request.body.title, target.clip.title);
  const description = sanitizeYouTubeDescription(
    buildTikTokCaption(publishTitle, target.clip.source, username, target.clip.gameName),
  );
  const youtubeTitle = sanitizeYouTubeTitle(publishTitle);
  const publications: Array<{ id: string; status: string; externalId: string | null; privacyLevel: string | null }> = [];
  const failures: unknown[] = [];
  let existingCount = 0;
  for (const account of target.accounts) {
    const existing = request.body.repeat === true ? null : await database.publication.findFirst({
      where: {
        clipId,
        platform: "YOUTUBE",
        contentAccountId: account.id,
        status: { in: ["UPLOADING", "PROCESSING", "PUBLISHED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (existing) {
      existingCount += 1;
      continue;
    }
    const publication = await database.publication.create({
      data: {
        platform: "YOUTUBE",
        clipId,
        contentAccountId: account.id,
        title: youtubeTitle,
        privacyLevel: "private",
      },
      select: { id: true },
    });
    try {
      const accessToken = await getYouTubeAccessToken(account);
      const uploaded = await uploadYouTubeShort(accessToken, mediaPath, mediaSize, {
        title: youtubeTitle,
        description,
        tags: [target.clip.gameName ?? "gaming", target.clip.source, username ?? "stream"],
        privacyStatus: "private",
      });
      publications.push(await database.publication.update({
        where: { id: publication.id },
        data: {
          externalId: uploaded.id,
          privacyLevel: uploaded.privacyStatus,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
        select: { id: true, status: true, externalId: true, privacyLevel: true },
      }));
    } catch (error) {
      failures.push(error);
      await database.publication.update({
        where: { id: publication.id },
        data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown YouTube error" },
      });
    }
  }
  if (publications.length === 0) {
    if (failures.length > 0) return sendYouTubeError(reply, failures[0]);
    return reply.status(409).send({
      error: existingCount > 0
        ? "Video is already uploaded to all assigned YouTube channels"
        : "YouTube account is not assigned",
    });
  }
  return reply.status(202).send({
    publications,
    warning: failures.length > 0
      ? failures.map((error) => error instanceof Error ? error.message : "Unknown YouTube error").join("; ")
      : undefined,
  });
});

app.post<{ Params: { id: string }; Body: { consent?: boolean; title?: string; repeat?: boolean } }>("/clips/:id/publish/instagram", async (request, reply) => {
  const clipId = request.params.id;
  if (!uuidPattern.test(clipId)) return reply.status(400).send({ error: "invalid clip id" });
  if (!request.body || request.body.consent !== true) return reply.status(400).send({ error: "Instagram upload consent is required" });
  const target = await getInstagramTarget(clipId);
  if (!target) return reply.status(404).send({ error: "clip not found" });
  if (target.accounts.length === 0) return reply.status(409).send({ error: "Instagram account is not assigned" });
  if (!instagramCredentials) return reply.status(503).send({ error: "Instagram is not configured" });
  if (!target.clip.tiktokFilePath) return reply.status(409).send({ error: "Prepare the vertical video first", code: "video_not_ready" });
  const allowedStatuses = request.body.repeat === true ? ["APPROVED", "DRAFTED", "PUBLISHED"] : ["APPROVED", "DRAFTED"];
  if (!target.clip.status || !allowedStatuses.includes(target.clip.status)) {
    return reply.status(409).send({ error: "Approve the clip before publishing" });
  }
  const mediaPath = resolve(target.clip.tiktokFilePath);
  if (!mediaPath.startsWith(`${storageRoot}${sep}`)) return reply.status(403).send({ error: "invalid media path" });
  try {
    await stat(mediaPath);
  } catch {
    return reply.status(409).send({ error: "Vertical video file is missing", code: "video_not_ready" });
  }

  const username = target.clip.twitchChannel?.login ?? target.clip.kickChannel?.slug;
  const publishTitle = normalizedPublishTitle(request.body.title, target.clip.title);
  const caption = buildTikTokCaption(publishTitle, target.clip.source, username, target.clip.gameName);
  const videoUrl = new URL(`/actions/instagram/media/${clipId}`, instagramCredentials.INSTAGRAM_PUBLIC_BASE_URL);
  const mediaExpiresAt = Math.floor(Date.now() / 1_000) + 60 * 60;
  const mediaSignature = createHmac("sha256", instagramCredentials.TIKTOK_TOKEN_ENCRYPTION_KEY)
    .update(`${clipId}:${mediaExpiresAt}`)
    .digest("base64url");
  videoUrl.searchParams.set("expires", String(mediaExpiresAt));
  videoUrl.searchParams.set("signature", mediaSignature);
  const publications: Array<{ id: string; status: string; externalId: string | null }> = [];
  const failures: unknown[] = [];
  let existingCount = 0;
  for (const account of target.accounts) {
    const existing = request.body.repeat === true ? null : await database.publication.findFirst({
      where: {
        clipId,
        platform: "INSTAGRAM",
        contentAccountId: account.id,
        status: { in: ["UPLOADING", "PROCESSING", "PUBLISHED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, externalId: true },
    });
    if (existing?.status === "PUBLISHED") {
      existingCount += 1;
      continue;
    }
    if (existing) {
      publications.push(existing);
      continue;
    }
    let publicationId: string | null = null;
    try {
      if (!account.externalId) throw new InstagramApiError("Instagram account must be reconnected", 401, "missing_user_id");
      const publication = await database.publication.create({
        data: {
          platform: "INSTAGRAM",
          clipId,
          contentAccountId: account.id,
          title: caption,
          privacyLevel: "public",
        },
        select: { id: true },
      });
      publicationId = publication.id;
      const accessToken = await getInstagramAccessToken(account);
      const containerId = await createInstagramReelContainer(
        accessToken,
        instagramCredentials.INSTAGRAM_GRAPH_VERSION,
        account.externalId,
        videoUrl.toString(),
        caption,
      );
      publications.push(await database.publication.update({
        where: { id: publication.id },
        data: { externalId: containerId, status: "PROCESSING" },
        select: { id: true, status: true, externalId: true },
      }));
    } catch (error) {
      failures.push(error);
      if (publicationId) {
        await database.publication.update({
          where: { id: publicationId },
          data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown Instagram error" },
        });
      }
    }
  }
  if (publications.length === 0) {
    if (failures.length > 0) return sendInstagramError(reply, failures[0]);
    return reply.status(409).send({
      error: existingCount > 0
        ? "Video is already published to all assigned Instagram accounts"
        : "Instagram account is not assigned",
    });
  }
  return reply.status(202).send({
    publications,
    warning: failures.length > 0
      ? failures.map((error) => error instanceof Error ? error.message : "Unknown Instagram error").join("; ")
      : undefined,
  });
});

app.get<{ Params: { id: string } }>("/publications/:id/status", async (request, reply) => {
  if (!uuidPattern.test(request.params.id)) return reply.status(400).send({ error: "invalid publication id" });
  const publication = await database.publication.findUnique({
    where: { id: request.params.id },
    include: {
      contentAccount: {
        select: {
          id: true,
          externalId: true,
          displayName: true,
          username: true,
          avatarUrl: true,
          accessTokenEncrypted: true,
          refreshTokenEncrypted: true,
          accessTokenExpiresAt: true,
          refreshTokenExpiresAt: true,
          authorizedScopes: true,
        },
      },
    },
  });
  if (!publication) return reply.status(404).send({ error: "publication not found" });
  if (publication.platform === "YOUTUBE") {
    return { id: publication.id, status: publication.status, error: publication.error, externalId: publication.externalId };
  }
  if (publication.platform === "INSTAGRAM") {
    if (publication.status === "PUBLISHED" || publication.status === "FAILED" || !publication.externalId) {
      return { id: publication.id, status: publication.status, error: publication.error, externalId: publication.externalId };
    }
    try {
      if (!instagramCredentials || !publication.contentAccount.externalId) {
        throw new InstagramApiError("Instagram account must be reconnected", 401, "account_not_connected");
      }
      const accessToken = await getInstagramAccessToken(publication.contentAccount);
      const remote = await getInstagramContainerStatus(
        accessToken,
        instagramCredentials.INSTAGRAM_GRAPH_VERSION,
        publication.externalId,
      );
      if (remote.statusCode === "ERROR" || remote.statusCode === "EXPIRED") {
        return database.publication.update({
          where: { id: publication.id },
          data: { status: "FAILED", error: remote.status ?? `Instagram container ${remote.statusCode.toLocaleLowerCase()}` },
          select: { id: true, status: true, error: true, externalId: true },
        });
      }
      if (remote.statusCode !== "FINISHED") {
        return { id: publication.id, status: "PROCESSING", error: null, externalId: publication.externalId, remoteStatus: remote.statusCode };
      }
      const mediaId = await publishInstagramReel(
        accessToken,
        instagramCredentials.INSTAGRAM_GRAPH_VERSION,
        publication.contentAccount.externalId,
        publication.externalId,
      );
      return database.$transaction(async (transaction) => {
        const updated = await transaction.publication.update({
          where: { id: publication.id },
          data: { externalId: mediaId, status: "PUBLISHED", error: null, publishedAt: new Date() },
          select: { id: true, status: true, error: true, externalId: true },
        });
        await transaction.clip.update({ where: { id: publication.clipId }, data: { status: "PUBLISHED" } });
        return updated;
      });
    } catch (error) {
      return sendInstagramError(reply, error);
    }
  }
  if (publication.status === "PUBLISHED" || publication.status === "FAILED" || !publication.externalId) {
    return { id: publication.id, status: publication.status, error: publication.error };
  }
  try {
    const accessToken = await getTikTokAccessToken(publication.contentAccount);
    const remote = await fetchTikTokPostStatus(accessToken, publication.externalId);
    const status = remote.status === "PUBLISH_COMPLETE"
      ? "PUBLISHED"
      : remote.status === "SEND_TO_USER_INBOX" ? "DELIVERED"
      : remote.status === "FAILED" ? "FAILED" : "PROCESSING";
    const updated = await database.$transaction(async (transaction) => {
      const saved = await transaction.publication.update({
        where: { id: publication.id },
        data: {
          status,
          error: status === "FAILED" ? remote.failReason ?? "TikTok publication failed" : null,
          publishedAt: status === "PUBLISHED" ? new Date() : null,
        },
        select: { id: true, status: true, error: true },
      });
      if (status === "PUBLISHED") {
        await transaction.clip.update({ where: { id: publication.clipId }, data: { status: "PUBLISHED" } });
      } else if (status === "DELIVERED") {
        await transaction.clip.update({ where: { id: publication.clipId }, data: { status: "DRAFTED" } });
      }
      return saved;
    });
    return { ...updated, remoteStatus: remote.status };
  } catch (error) {
    return sendTikTokError(reply, error);
  }
});

app.post<{ Params: { id: string } }>("/clips/:id/process", async (request, reply) => {
  const clipId = request.params.id;
  if (!uuidPattern.test(clipId)) {
    return reply.status(400).send({ error: "invalid clip id" });
  }
  const clip = await database.clip.findUnique({ where: { id: clipId }, select: { id: true } });
  if (!clip) return reply.status(404).send({ error: "clip not found" });
  const job = await videoProcessingQueue.add(
    PROCESS_CLIP_JOB,
    { clipId },
    {
      jobId: `${clipId}-${Date.now()}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  return reply.status(202).send({ queued: true, jobId: job.id });
});

app.get<{ Params: { id: string } }>("/clips/:id/status", async (request, reply) => {
  const clip = await database.clip.findUnique({
    where: { id: request.params.id },
    select: { status: true, processedFilePath: true, tiktokFilePath: true, processedAt: true, processingError: true },
  });
  if (!clip) return reply.status(404).send({ error: "clip not found" });
  return {
    status: clip.status,
    processed: Boolean(clip.processedFilePath),
    tiktokReady: Boolean(clip.tiktokFilePath),
    processedAt: clip.processedAt,
    error: clip.processingError,
  };
});

app.patch<{ Params: { id: string }; Body: { status?: string } }>("/clips/:id/status", async (request, reply) => {
  const clipId = request.params.id;
  const nextStatus = request.body?.status;
  if (!uuidPattern.test(clipId)) return reply.status(400).send({ error: "invalid clip id" });
  if (typeof nextStatus !== "string" || !manualClipStatuses.has(nextStatus)) {
    return reply.status(400).send({ error: "invalid clip status" });
  }

  const clip = await database.clip.findUnique({
    where: { id: clipId },
    select: { status: true, processedFilePath: true },
  });
  if (!clip) return reply.status(404).send({ error: "clip not found" });
  if ((nextStatus === "APPROVED" || nextStatus === "PROCESSED") && !clip.processedFilePath) {
    return reply.status(409).send({ error: "clip must be processed first" });
  }
  if (["SELECTED", "DOWNLOADED", "PUBLISHED"].includes(clip.status)) {
    return reply.status(409).send({ error: "clip status cannot be changed now" });
  }

  const updated = await database.clip.update({
    where: { id: clipId },
    data: { status: nextStatus as "TRACKING" | "CANDIDATE" | "PROCESSED" | "APPROVED" | "REJECTED" },
    select: { id: true, status: true, processedFilePath: true },
  });
  return updated;
});

app.get<{ Params: { id: string } }>("/clips/:id/processed", async (request, reply) => {
  const clip = await database.clip.findUnique({
    where: { id: request.params.id },
    select: { processedFilePath: true },
  });
  if (!clip?.processedFilePath) return reply.status(404).send({ error: "processed video not found" });
  const mediaPath = resolve(clip.processedFilePath);
  if (!mediaPath.startsWith(`${storageRoot}${sep}`)) {
    return reply.status(403).send({ error: "invalid media path" });
  }
  try {
    await stat(mediaPath);
  } catch {
    return reply.status(404).send({ error: "processed video file not found" });
  }
  reply.header("content-disposition", `inline; filename="${basename(mediaPath)}"`);
  reply.header("cache-control", "no-store");
  return reply.type("video/mp4").send(createReadStream(mediaPath));
});

app.get<{ Params: { id: string } }>("/clips/:id/tiktok", async (request, reply) => {
  const clip = await database.clip.findUnique({
    where: { id: request.params.id },
    select: { tiktokFilePath: true },
  });
  if (!clip?.tiktokFilePath) return reply.status(404).send({ error: "TikTok video not found" });
  const mediaPath = resolve(clip.tiktokFilePath);
  if (!mediaPath.startsWith(`${storageRoot}${sep}`)) return reply.status(403).send({ error: "invalid media path" });
  try {
    await stat(mediaPath);
  } catch {
    return reply.status(404).send({ error: "TikTok video file not found" });
  }
  reply.header("content-disposition", `inline; filename="${basename(mediaPath)}"`);
  reply.header("cache-control", "no-store");
  return reply.type("video/mp4").send(createReadStream(mediaPath));
});

const youtubeAnalyticsTimer = setInterval(() => {
  void Promise.all([refreshYouTubeAnalytics(), refreshTikTokAnalytics()]).then(([youtube, tiktok]) => {
    app.log.info({ youtube, tiktok }, "Publishing analytics refreshed");
  }).catch((error) => app.log.warn({ error }, "Publishing analytics refresh failed"));
}, 30 * 60_000);
youtubeAnalyticsTimer.unref();

const shutdown = async () => {
  clearInterval(youtubeAnalyticsTimer);
  await app.close();
  await clipDiscoveryQueue.close();
  await videoProcessingQueue.close();
  await database.$disconnect();
  if (redis.status !== "end") redis.disconnect();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host: env.API_HOST, port: env.API_PORT });
