CREATE TYPE "PublicationStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'PUBLISHED', 'FAILED');

ALTER TABLE "Clip" ADD COLUMN "tiktokFilePath" TEXT;

CREATE TABLE "Publication" (
    "id" UUID NOT NULL,
    "platform" "PublishingPlatform" NOT NULL,
    "clipId" UUID NOT NULL,
    "contentAccountId" UUID NOT NULL,
    "externalId" TEXT,
    "status" "PublicationStatus" NOT NULL DEFAULT 'UPLOADING',
    "title" TEXT NOT NULL,
    "privacyLevel" TEXT NOT NULL,
    "allowComment" BOOLEAN NOT NULL DEFAULT false,
    "allowDuet" BOOLEAN NOT NULL DEFAULT false,
    "allowStitch" BOOLEAN NOT NULL DEFAULT false,
    "brandOrganic" BOOLEAN NOT NULL DEFAULT false,
    "brandContent" BOOLEAN NOT NULL DEFAULT false,
    "isAigc" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Publication_platform_externalId_key" ON "Publication"("platform", "externalId");
CREATE INDEX "Publication_clipId_createdAt_idx" ON "Publication"("clipId", "createdAt");
CREATE INDEX "Publication_contentAccountId_createdAt_idx" ON "Publication"("contentAccountId", "createdAt");
CREATE INDEX "Publication_status_updatedAt_idx" ON "Publication"("status", "updatedAt");

ALTER TABLE "Publication" ADD CONSTRAINT "Publication_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_contentAccountId_fkey" FOREIGN KEY ("contentAccountId") REFERENCES "ContentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
