import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadCoreEnv, loadOptionalTwitchEnv } from "@clips-poster/config";
import { createDatabaseClient } from "@clips-poster/database";
import { collectKickChannel, KickClient } from "@clips-poster/kick";
import { downloadAndBrandClip } from "@clips-poster/media";
import { collectTwitchChannel, TwitchClient } from "@clips-poster/twitch";
import {
  CLIP_DISCOVERY_QUEUE,
  KICK_COLLECT_JOB,
  KICK_POLL_ALL_JOB,
  KICK_POLL_INTERVAL_MS,
  KICK_POLL_SCHEDULER_ID,
  type KickCollectJobData,
  TWITCH_COLLECT_JOB,
  TWITCH_POLL_ALL_JOB,
  TWITCH_POLL_SCHEDULER_ID,
  type TwitchCollectJobData,
  PROCESS_CLIP_JOB,
  type ProcessClipJobData,
  VIDEO_PROCESSING_QUEUE,
} from "@clips-poster/shared";

const AUTO_PUBLISH_SCORE = 30;

const env = loadCoreEnv();
const database = createDatabaseClient(env.DATABASE_URL);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const kickClient = new KickClient();
const twitchCredentials = loadOptionalTwitchEnv();
const twitchClient = new TwitchClient(
  twitchCredentials
    ? {
      clientId: twitchCredentials.TWITCH_CLIENT_ID,
      clientSecret: twitchCredentials.TWITCH_CLIENT_SECRET,
    }
    : undefined,
);
const schedulerQueue = new Queue(CLIP_DISCOVERY_QUEUE, { connection });
const videoProcessingQueue = new Queue<ProcessClipJobData>(VIDEO_PROCESSING_QUEUE, { connection });

const queueEligibleProcessingCandidates = async () => {
  const assignments = await database.channelAssignment.findMany({
    where: {
      platform: { in: ["TIKTOK", "YOUTUBE", "INSTAGRAM"] },
      active: true,
      contentAccount: { is: { active: true } },
    },
    select: { twitchChannelId: true, kickChannelId: true },
  });
  const twitchChannelIds = assignments.flatMap((assignment) => (
    assignment.twitchChannelId ? [assignment.twitchChannelId] : []
  ));
  const kickChannelIds = assignments.flatMap((assignment) => (
    assignment.kickChannelId ? [assignment.kickChannelId] : []
  ));
  if (twitchChannelIds.length === 0 && kickChannelIds.length === 0) return 0;

  const candidates = await database.clip.findMany({
    where: {
      status: { in: ["TRACKING", "CANDIDATE"] },
      viralScore: { gt: AUTO_PUBLISH_SCORE },
      tiktokFilePath: null,
      OR: [
        { twitchChannelId: { in: twitchChannelIds } },
        { kickChannelId: { in: kickChannelIds } },
      ],
    },
    orderBy: { viralScore: "desc" },
    take: 10,
    select: { id: true },
  });

  for (const candidate of candidates) {
    await videoProcessingQueue.add(
      PROCESS_CLIP_JOB,
      { clipId: candidate.id, autoApprove: true },
      {
        jobId: `auto-${candidate.id}`,
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    await database.clip.updateMany({
      where: { id: candidate.id, status: { in: ["TRACKING", "CANDIDATE"] } },
      data: { status: "SELECTED", processingError: null },
    });
  }
  if (candidates.length > 0) {
    console.info({ clips: candidates.length }, "Queued viral candidates for automatic 9:16 processing");
  }

  return candidates.length;
};

await database.$queryRaw`SELECT 1`;
await connection.ping();
await schedulerQueue.upsertJobScheduler(
  KICK_POLL_SCHEDULER_ID,
  { every: KICK_POLL_INTERVAL_MS },
  {
    name: KICK_POLL_ALL_JOB,
    data: {},
    opts: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  },
);
await schedulerQueue.upsertJobScheduler(
  TWITCH_POLL_SCHEDULER_ID,
  { every: KICK_POLL_INTERVAL_MS },
  {
    name: TWITCH_POLL_ALL_JOB,
    data: {},
    opts: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  },
);
await queueEligibleProcessingCandidates();

const worker = new Worker<Record<string, unknown>>(
  CLIP_DISCOVERY_QUEUE,
  async (job) => {
    if (job.name === KICK_POLL_ALL_JOB) {
      const channels = await database.kickChannel.findMany({
        where: { active: true },
        select: { slug: true },
      });
      const results = [];
      for (const channel of channels) {
        results.push(await collectKickChannel(database, kickClient, channel.slug));
      }
      await queueEligibleProcessingCandidates();
      console.info({ channels: results.length, results }, "Scheduled Kick polling completed");
      return results;
    }
    if (job.name === TWITCH_POLL_ALL_JOB) {
      const channels = await database.twitchChannel.findMany({
        where: { active: true },
        select: { login: true },
      });
      const results = [];
      for (const channel of channels) {
        results.push(await collectTwitchChannel(database, twitchClient, channel.login));
      }
      await queueEligibleProcessingCandidates();
      console.info({ channels: results.length, results }, "Scheduled Twitch polling completed");
      return results;
    }
    if (job.name === TWITCH_COLLECT_JOB) {
      const data = job.data as unknown as TwitchCollectJobData;
      const activeChannel = await database.twitchChannel.findFirst({
        where: { id: data.channelId, active: true },
        select: { login: true },
      });
      if (!activeChannel) {
        console.info({ jobId: job.id, channelId: data.channelId }, "Skipped inactive Twitch channel");
        return { skipped: true };
      }
      const result = await collectTwitchChannel(database, twitchClient, activeChannel.login);
      await queueEligibleProcessingCandidates();
      console.info({ jobId: job.id, ...result }, "Twitch collection completed");
      return result;
    }
    if (job.name !== KICK_COLLECT_JOB) {
      throw new Error(`Unsupported job: ${job.name}`);
    }
    const data = job.data as unknown as KickCollectJobData;
    const activeChannel = await database.kickChannel.findFirst({
      where: { id: data.channelId, active: true },
      select: { slug: true },
    });
    if (!activeChannel) {
      console.info({ jobId: job.id, channelId: data.channelId }, "Skipped inactive Kick channel");
      return { skipped: true };
    }
    const result = await collectKickChannel(database, kickClient, activeChannel.slug);
    await queueEligibleProcessingCandidates();
    console.info({ jobId: job.id, ...result }, "Kick collection completed");
    return result;
  },
  { connection },
);

const videoWorker = new Worker<ProcessClipJobData>(
  VIDEO_PROCESSING_QUEUE,
  async (job) => {
    if (job.name !== PROCESS_CLIP_JOB) throw new Error(`Unsupported video job: ${job.name}`);
    const clip = await database.clip.findUnique({
      where: { id: job.data.clipId },
      include: {
        twitchChannel: {
          select: {
            displayName: true, login: true,
            webcamX: true, webcamY: true, webcamWidth: true, webcamHeight: true, webcamOnly: true,
          },
        },
        kickChannel: {
          select: {
            displayName: true, slug: true,
            webcamX: true, webcamY: true, webcamWidth: true, webcamHeight: true, webcamOnly: true,
          },
        },
      },
    });
    if (!clip) throw new Error(`Clip '${job.data.clipId}' was not found`);
    const nickname = clip.twitchChannel?.displayName
      ?? clip.kickChannel?.displayName
      ?? clip.twitchChannel?.login
      ?? clip.kickChannel?.slug
      ?? "unknown";
    const statusAfterProcessing = job.data.autoApprove === true
      ? "APPROVED"
      : clip.status === "APPROVED" || clip.status === "DRAFTED" || clip.status === "PUBLISHED"
        ? clip.status
        : "PROCESSED";
    const channel = clip.twitchChannel ?? clip.kickChannel;
    const webcamCrop = channel?.webcamX != null
      && channel.webcamY != null
      && channel.webcamWidth != null
      && channel.webcamHeight != null
      ? {
        x: channel.webcamX,
        y: channel.webcamY,
        width: channel.webcamWidth,
        height: channel.webcamHeight,
      }
      : null;

    try {
      await database.clip.update({
        where: { id: clip.id },
        data: { status: "SELECTED", processingError: null },
      });
      const sourceUrl = clip.source === "TWITCH"
        ? await twitchClient.getClipVideoUrl(clip.externalId)
        : clip.embedUrl;
      if (!sourceUrl) throw new Error("Clip does not have a downloadable source URL");

      const media = await downloadAndBrandClip(
        sourceUrl,
        clip.externalId,
        clip.source,
        nickname,
        webcamCrop,
        channel?.webcamOnly === true,
      );
      await database.clip.update({
        where: { id: clip.id },
        data: {
          rawFilePath: media.rawFilePath,
          processedFilePath: media.processedFilePath,
          tiktokFilePath: media.tiktokFilePath,
          processedAt: new Date(),
          processingError: null,
          status: statusAfterProcessing,
        },
      });
      console.info({ jobId: job.id, clipId: clip.id, ...media }, "Vertical clip processed");
      return media;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await database.clip.update({
        where: { id: clip.id },
        data: { status: "FAILED", processingError: message.slice(0, 2_000) },
      });
      throw error;
    }
  },
  { connection, concurrency: 1 },
);

worker.on("ready", () => console.info("Worker is ready"));
worker.on("completed", (job) => console.info({ jobId: job.id }, "Job completed"));
worker.on("failed", (job, error) => console.error({ jobId: job?.id, error }, "Job failed"));
videoWorker.on("ready", () => console.info("Video worker is ready"));
videoWorker.on("completed", (job) => console.info({ jobId: job.id }, "Video job completed"));
videoWorker.on("failed", (job, error) => console.error({ jobId: job?.id, error }, "Video job failed"));

const shutdown = async () => {
  await schedulerQueue.close();
  await videoProcessingQueue.close();
  await worker.close();
  await videoWorker.close();
  await database.$disconnect();
  connection.disconnect();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
