import type { PrismaClient } from "@clips-poster/database";
import { normalizeKickSlug } from "./client.js";
import type { KickClient } from "./client.js";
import { calculateClipGrowth, calculateViralScore, VIRAL_CANDIDATE_SCORE } from "@clips-poster/shared";

export interface KickCollectionResult {
  channelSlug: string;
  discovered: number;
  updated: number;
  total: number;
}

export const ensureKickChannel = async (
  database: PrismaClient,
  client: KickClient,
  slug: string,
  reactivate = true,
) => {
  const channel = await client.getChannel(slug);
  return database.kickChannel.upsert({
    where: { slug: normalizeKickSlug(channel.slug) },
    create: {
      kickId: channel.id,
      broadcasterUserId: channel.user.id,
      slug: normalizeKickSlug(channel.slug),
      displayName: channel.user.username,
      language: channel.livestream?.language ?? null,
      thumbnailUrl: channel.user.profile_pic ?? null,
    },
    update: {
      kickId: channel.id,
      broadcasterUserId: channel.user.id,
      displayName: channel.user.username,
      language: channel.livestream?.language ?? null,
      thumbnailUrl: channel.user.profile_pic ?? null,
      ...(reactivate ? { active: true } : {}),
    },
  });
};

export const collectKickChannel = async (
  database: PrismaClient,
  client: KickClient,
  slug: string,
): Promise<KickCollectionResult> => {
  const channel = await ensureKickChannel(database, client, slug, false);
  const response = await client.getFreshClips(channel.slug);
  let discovered = 0;
  let updated = 0;

  for (const clip of response.clips) {
    const observedAt = new Date();
    const existing = await database.clip.findUnique({
      where: { source_externalId: { source: "KICK", externalId: clip.id } },
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
    const views = clip.view_count ?? clip.views ?? 0;
    const sourceCreatedAt = new Date(clip.created_at);
    const growth = calculateClipGrowth(views, observedAt, existing?.metrics ?? []);
    const viralScore = calculateViralScore({
      views,
      viewsPerMinute: growth.viewsPerMinute,
      acceleration: growth.acceleration,
      sourceCreatedAt,
      observedAt,
    });
    const saved = await database.clip.upsert({
      where: { source_externalId: { source: "KICK", externalId: clip.id } },
      create: {
        source: "KICK",
        externalId: clip.id,
        kickChannelId: channel.id,
        title: clip.title?.trim() || "Untitled Kick clip",
        gameName: clip.category?.name ?? null,
        url: `https://kick.com/${channel.slug}?clip=${encodeURIComponent(clip.id)}`,
        embedUrl: clip.video_url ?? clip.clip_url,
        thumbnailUrl: clip.thumbnail_url ?? null,
        creatorExternalId: clip.creator?.id ?? null,
        creatorName: clip.creator?.username ?? clip.creator?.slug ?? null,
        language: channel.language,
        durationSeconds: clip.duration ?? null,
        currentViews: views,
        sourceCreatedAt,
        lastObservedAt: observedAt,
        status: viralScore >= VIRAL_CANDIDATE_SCORE ? "CANDIDATE" : "TRACKING",
        viralScore,
        metrics: { create: { views, recordedAt: observedAt, ...growth } },
      },
      update: {
        title: clip.title?.trim() || "Untitled Kick clip",
        gameName: clip.category?.name ?? null,
        embedUrl: clip.video_url ?? clip.clip_url,
        thumbnailUrl: clip.thumbnail_url ?? null,
        currentViews: views,
        lastObservedAt: observedAt,
        viralScore,
        ...(viralScore >= VIRAL_CANDIDATE_SCORE
          && (existing?.status === "DISCOVERED" || existing?.status === "TRACKING")
          ? { status: "CANDIDATE" as const }
          : {}),
        metrics: { create: { views, recordedAt: observedAt, ...growth } },
      },
    });

    if (existing) updated += 1;
    else discovered += 1;
    void saved;
  }

  return { channelSlug: channel.slug, discovered, updated, total: response.clips.length };
};
