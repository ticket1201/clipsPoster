import type { PrismaClient } from "@clips-poster/database";
import { calculateClipGrowth, calculateViralScore, VIRAL_CANDIDATE_SCORE } from "@clips-poster/shared";
import { normalizeTwitchLogin, type TwitchClient } from "./client.js";

export interface TwitchCollectionResult {
  channelLogin: string;
  discovered: number;
  updated: number;
  total: number;
}

export const ensureTwitchChannel = async (
  database: PrismaClient,
  client: TwitchClient,
  login: string,
  reactivate = true,
) => {
  const user = await client.getUser(login);
  return database.twitchChannel.upsert({
    where: { login: normalizeTwitchLogin(user.login) },
    create: {
      twitchId: user.id,
      login: normalizeTwitchLogin(user.login),
      displayName: user.display_name,
      thumbnailUrl: user.profile_image_url || null,
    },
    update: {
      twitchId: user.id,
      displayName: user.display_name,
      thumbnailUrl: user.profile_image_url || null,
      ...(reactivate ? { active: true } : {}),
    },
  });
};

export const collectTwitchChannel = async (
  database: PrismaClient,
  client: TwitchClient,
  login: string,
): Promise<TwitchCollectionResult> => {
  const channel = await ensureTwitchChannel(database, client, login, false);
  const clips = await client.getFreshClips(channel.twitchId, { login: channel.login });
  let discovered = 0;
  let updated = 0;

  for (const clip of clips) {
    const observedAt = new Date();
    const canonicalUrl = `https://www.twitch.tv/${encodeURIComponent(channel.login)}/clip/${encodeURIComponent(clip.id)}`;
    const existing = await database.clip.findUnique({
      where: { source_externalId: { source: "TWITCH", externalId: clip.id } },
      select: {
        id: true,
        status: true,
        metrics: {
          orderBy: { recordedAt: "desc" },
          take: 24,
          select: { recordedAt: true, views: true, viewsPerMinute: true },
        },
      },
    });
    const sourceCreatedAt = new Date(clip.created_at);
    const growth = calculateClipGrowth(clip.view_count, observedAt, existing?.metrics ?? []);
    const viralScore = calculateViralScore({
      views: clip.view_count,
      viewsPerMinute: growth.viewsPerMinute,
      acceleration: growth.acceleration,
      sourceCreatedAt,
      observedAt,
    });
    await database.clip.upsert({
      where: { source_externalId: { source: "TWITCH", externalId: clip.id } },
      create: {
        source: "TWITCH",
        externalId: clip.id,
        twitchChannelId: channel.id,
        title: clip.title.trim() || "Untitled Twitch clip",
        gameName: clip.game_name ?? null,
        url: canonicalUrl,
        embedUrl: clip.embed_url,
        thumbnailUrl: clip.thumbnail_url,
        creatorExternalId: clip.creator_id || null,
        creatorName: clip.creator_name || null,
        language: clip.language || null,
        durationSeconds: clip.duration,
        currentViews: clip.view_count,
        sourceCreatedAt,
        lastObservedAt: observedAt,
        status: viralScore >= VIRAL_CANDIDATE_SCORE ? "CANDIDATE" : "TRACKING",
        viralScore,
        metrics: { create: { views: clip.view_count, recordedAt: observedAt, ...growth } },
      },
      update: {
        title: clip.title.trim() || "Untitled Twitch clip",
        gameName: clip.game_name ?? null,
        url: canonicalUrl,
        embedUrl: clip.embed_url,
        thumbnailUrl: clip.thumbnail_url,
        currentViews: clip.view_count,
        lastObservedAt: observedAt,
        viralScore,
        ...(viralScore >= VIRAL_CANDIDATE_SCORE
          && (existing?.status === "DISCOVERED" || existing?.status === "TRACKING")
          ? { status: "CANDIDATE" as const }
          : {}),
        metrics: { create: { views: clip.view_count, recordedAt: observedAt, ...growth } },
      },
    });
    if (existing) updated += 1;
    else discovered += 1;
  }

  return { channelLogin: channel.login, discovered, updated, total: clips.length };
};
