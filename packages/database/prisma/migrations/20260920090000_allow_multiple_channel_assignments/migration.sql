DROP INDEX IF EXISTS "ChannelAssignment_platform_twitchChannelId_key";
DROP INDEX IF EXISTS "ChannelAssignment_platform_kickChannelId_key";

CREATE INDEX "ChannelAssignment_platform_twitchChannelId_idx"
ON "ChannelAssignment"("platform", "twitchChannelId");

CREATE INDEX "ChannelAssignment_platform_kickChannelId_idx"
ON "ChannelAssignment"("platform", "kickChannelId");
