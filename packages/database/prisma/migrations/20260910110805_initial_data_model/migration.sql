-- CreateEnum
CREATE TYPE "SourcePlatform" AS ENUM ('TWITCH', 'KICK');

-- CreateEnum
CREATE TYPE "PublishingPlatform" AS ENUM ('YOUTUBE', 'TIKTOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('DISCOVERED', 'TRACKING', 'CANDIDATE', 'SELECTED', 'DOWNLOADED', 'PROCESSED', 'PUBLISHED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "ContentAccount" (
    "id" UUID NOT NULL,
    "platform" "PublishingPlatform" NOT NULL,
    "externalId" TEXT,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchChannel" (
    "id" UUID NOT NULL,
    "twitchId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "language" TEXT,
    "thumbnailUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KickChannel" (
    "id" UUID NOT NULL,
    "kickId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "language" TEXT,
    "thumbnailUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KickChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelAssignment" (
    "id" UUID NOT NULL,
    "contentAccountId" UUID NOT NULL,
    "twitchChannelId" UUID,
    "kickChannelId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" UUID NOT NULL,
    "source" "SourcePlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "twitchChannelId" UUID,
    "kickChannelId" UUID,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "embedUrl" TEXT,
    "thumbnailUrl" TEXT,
    "creatorExternalId" TEXT,
    "creatorName" TEXT,
    "language" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "currentViews" INTEGER NOT NULL DEFAULT 0,
    "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ClipStatus" NOT NULL DEFAULT 'DISCOVERED',
    "viralScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipMetric" (
    "id" UUID NOT NULL,
    "clipId" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER NOT NULL,
    "viewsPerMinute" DOUBLE PRECISION,
    "viewsLast5Minutes" INTEGER,
    "viewsLast15Minutes" INTEGER,
    "viewsLast60Minutes" INTEGER,
    "acceleration" DOUBLE PRECISION,

    CONSTRAINT "ClipMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentAccount_active_platform_idx" ON "ContentAccount"("active", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "ContentAccount_platform_username_key" ON "ContentAccount"("platform", "username");

-- CreateIndex
CREATE UNIQUE INDEX "ContentAccount_platform_externalId_key" ON "ContentAccount"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchChannel_twitchId_key" ON "TwitchChannel"("twitchId");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchChannel_login_key" ON "TwitchChannel"("login");

-- CreateIndex
CREATE INDEX "TwitchChannel_active_idx" ON "TwitchChannel"("active");

-- CreateIndex
CREATE UNIQUE INDEX "KickChannel_kickId_key" ON "KickChannel"("kickId");

-- CreateIndex
CREATE UNIQUE INDEX "KickChannel_slug_key" ON "KickChannel"("slug");

-- CreateIndex
CREATE INDEX "KickChannel_active_idx" ON "KickChannel"("active");

-- CreateIndex
CREATE INDEX "ChannelAssignment_active_contentAccountId_idx" ON "ChannelAssignment"("active", "contentAccountId");

-- CreateIndex
CREATE INDEX "ChannelAssignment_twitchChannelId_idx" ON "ChannelAssignment"("twitchChannelId");

-- CreateIndex
CREATE INDEX "ChannelAssignment_kickChannelId_idx" ON "ChannelAssignment"("kickChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAssignment_contentAccountId_twitchChannelId_key" ON "ChannelAssignment"("contentAccountId", "twitchChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAssignment_contentAccountId_kickChannelId_key" ON "ChannelAssignment"("contentAccountId", "kickChannelId");

-- CreateIndex
CREATE INDEX "Clip_source_sourceCreatedAt_idx" ON "Clip"("source", "sourceCreatedAt");

-- CreateIndex
CREATE INDEX "Clip_status_viralScore_idx" ON "Clip"("status", "viralScore");

-- CreateIndex
CREATE INDEX "Clip_twitchChannelId_sourceCreatedAt_idx" ON "Clip"("twitchChannelId", "sourceCreatedAt");

-- CreateIndex
CREATE INDEX "Clip_kickChannelId_sourceCreatedAt_idx" ON "Clip"("kickChannelId", "sourceCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Clip_source_externalId_key" ON "Clip"("source", "externalId");

-- CreateIndex
CREATE INDEX "ClipMetric_recordedAt_idx" ON "ClipMetric"("recordedAt");

-- CreateIndex
CREATE INDEX "ClipMetric_viewsPerMinute_idx" ON "ClipMetric"("viewsPerMinute");

-- CreateIndex
CREATE UNIQUE INDEX "ClipMetric_clipId_recordedAt_key" ON "ClipMetric"("clipId", "recordedAt");

-- AddForeignKey
ALTER TABLE "ChannelAssignment" ADD CONSTRAINT "ChannelAssignment_contentAccountId_fkey" FOREIGN KEY ("contentAccountId") REFERENCES "ContentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelAssignment" ADD CONSTRAINT "ChannelAssignment_twitchChannelId_fkey" FOREIGN KEY ("twitchChannelId") REFERENCES "TwitchChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelAssignment" ADD CONSTRAINT "ChannelAssignment_kickChannelId_fkey" FOREIGN KEY ("kickChannelId") REFERENCES "KickChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_twitchChannelId_fkey" FOREIGN KEY ("twitchChannelId") REFERENCES "TwitchChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_kickChannelId_fkey" FOREIGN KEY ("kickChannelId") REFERENCES "KickChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipMetric" ADD CONSTRAINT "ClipMetric_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
