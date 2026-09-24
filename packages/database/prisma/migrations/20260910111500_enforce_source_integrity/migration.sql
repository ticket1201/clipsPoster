ALTER TABLE "ChannelAssignment"
ADD CONSTRAINT "ChannelAssignment_exactly_one_source_check"
CHECK (num_nonnulls("twitchChannelId", "kickChannelId") = 1);

ALTER TABLE "Clip"
ADD CONSTRAINT "Clip_source_channel_match_check"
CHECK (
  (
    "source" = 'TWITCH'
    AND "twitchChannelId" IS NOT NULL
    AND "kickChannelId" IS NULL
  )
  OR
  (
    "source" = 'KICK'
    AND "kickChannelId" IS NOT NULL
    AND "twitchChannelId" IS NULL
  )
);
