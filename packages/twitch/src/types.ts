import { z } from "zod";

export const twitchUserSchema = z.object({
  id: z.string().min(1),
  login: z.string().min(1),
  display_name: z.string().min(1),
  profile_image_url: z.url().or(z.literal("")),
});

export const twitchClipSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
  embed_url: z.url(),
  broadcaster_id: z.string().min(1),
  broadcaster_name: z.string(),
  creator_id: z.string(),
  creator_name: z.string(),
  video_id: z.string(),
  game_id: z.string(),
  game_name: z.string().optional(),
  language: z.string(),
  title: z.string(),
  view_count: z.number().int().nonnegative(),
  created_at: z.iso.datetime({ offset: true }),
  thumbnail_url: z.url(),
  duration: z.number().nonnegative(),
  vod_offset: z.number().int().nullable().optional(),
  is_featured: z.boolean().optional(),
});

export const twitchUsersResponseSchema = z.object({
  data: z.array(twitchUserSchema),
});

export const twitchClipsResponseSchema = z.object({
  data: z.array(twitchClipSchema),
  pagination: z.object({ cursor: z.string().optional() }),
});

export const twitchWebUserSchema = z.object({
  id: z.string().min(1),
  login: z.string().min(1),
  displayName: z.string().min(1),
  profileImageURL: z.url().or(z.literal("")),
});

export const twitchWebClipNodeSchema = z.object({
  slug: z.string().min(1),
  title: z.string(),
  viewCount: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  thumbnailURL: z.url(),
  game: z.object({ name: z.string().min(1) }).nullable().optional(),
  broadcaster: z.object({
    id: z.string().min(1),
    login: z.string().min(1),
    displayName: z.string(),
  }).nullable(),
  curator: z.object({
    id: z.string(),
    login: z.string(),
    displayName: z.string(),
  }).nullable(),
});

export const twitchWebGraphqlSchema = z.object({
  data: z.object({
    user: twitchWebUserSchema.extend({
      clips: z.object({
        edges: z.array(z.object({
          cursor: z.string().nullable(),
          node: twitchWebClipNodeSchema,
        })),
        pageInfo: z.object({ hasNextPage: z.boolean() }),
      }).nullable().optional(),
    }).nullable().optional(),
    clip: z.object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      videoQualities: z.array(z.object({
        sourceURL: z.url(),
        quality: z.string(),
        frameRate: z.number(),
      })),
      playbackAccessToken: z.object({
        value: z.string().min(1),
        signature: z.string().min(1),
      }).optional(),
    }).nullable().optional(),
  }).nullable().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

export type TwitchUser = z.infer<typeof twitchUserSchema>;
export type TwitchClip = z.infer<typeof twitchClipSchema>;
export type TwitchWebClipNode = z.infer<typeof twitchWebClipNodeSchema>;
