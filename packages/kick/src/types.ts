import { z } from "zod";

const nullableString = z.string().nullable().optional();

export const kickChannelSchema = z.object({
  id: z.coerce.string(),
  slug: z.string().min(1),
  user: z.object({
    id: z.coerce.string(),
    username: z.string().min(1),
    profile_pic: nullableString,
  }),
  livestream: z
    .object({
      language: nullableString,
    })
    .nullable()
    .optional(),
});

export const kickClipSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable().optional(),
  clip_url: z.url(),
  thumbnail_url: z.url().nullable().optional(),
  views: z.coerce.number().int().nonnegative().optional(),
  view_count: z.coerce.number().int().nonnegative().optional(),
  likes: z.coerce.number().int().nonnegative().optional(),
  likes_count: z.coerce.number().int().nonnegative().optional(),
  duration: z.coerce.number().nonnegative().nullable().optional(),
  created_at: z.iso.datetime({ offset: true }),
  video_url: z.url().nullable().optional(),
  category: z
    .object({
      id: z.coerce.string(),
      name: z.string().min(1),
      slug: z.string().min(1),
    })
    .nullable()
    .optional(),
  creator: z
    .object({
      id: z.coerce.string(),
      username: z.string().nullable().optional(),
      slug: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  channel: z.object({
    id: z.coerce.string(),
    username: z.string().min(1),
    slug: z.string().min(1),
    profile_picture: z.url().nullable().optional(),
  }),
});

export const kickClipsResponseSchema = z.object({
  clips: z.array(kickClipSchema),
  nextCursor: z.string().nullable().optional(),
});

export type KickChannelResponse = z.infer<typeof kickChannelSchema>;
export type KickClipResponse = z.infer<typeof kickClipSchema>;
export type KickClipsResponse = z.infer<typeof kickClipsResponseSchema>;
