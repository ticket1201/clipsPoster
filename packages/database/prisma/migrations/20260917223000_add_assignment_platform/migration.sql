ALTER TABLE "ChannelAssignment" ADD COLUMN "platform" "PublishingPlatform";

UPDATE "ChannelAssignment" AS assignment
SET "platform" = account."platform"
FROM "ContentAccount" AS account
WHERE assignment."contentAccountId" = account."id";

ALTER TABLE "ChannelAssignment" ALTER COLUMN "platform" SET NOT NULL;

CREATE UNIQUE INDEX "ChannelAssignment_platform_twitchChannelId_key"
ON "ChannelAssignment"("platform", "twitchChannelId");

CREATE UNIQUE INDEX "ChannelAssignment_platform_kickChannelId_key"
ON "ChannelAssignment"("platform", "kickChannelId");
