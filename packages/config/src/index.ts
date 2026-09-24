import { config } from "dotenv";
import { z } from "zod";

const defaultEnvFile = new URL("../../../.env.local", import.meta.url);
config({ path: process.env.ENV_FILE ?? defaultEnvFile, quiet: true });

const coreSchema = z.object({
  DATABASE_URL: z.url().startsWith("postgresql://"),
  REDIS_URL: z.url().startsWith("redis://"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
});

const integrationsSchema = coreSchema.extend({
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  KICK_CLIENT_ID: z.string().min(1),
  KICK_CLIENT_SECRET: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
});

const kickSchema = z.object({
  KICK_CLIENT_ID: z.string().min(1).refine((value) => value !== "not_configured"),
  KICK_CLIENT_SECRET: z.string().min(1).refine((value) => value !== "not_configured"),
});

const twitchSchema = z.object({
  TWITCH_CLIENT_ID: z.string().min(1).refine((value) => !["replace_me", "not_configured"].includes(value)),
  TWITCH_CLIENT_SECRET: z.string().min(1).refine((value) => !["replace_me", "not_configured"].includes(value)),
});

const tiktokSchema = z.object({
  TIKTOK_CLIENT_KEY: z.string().min(1).refine((value) => value !== "replace_me"),
  TIKTOK_CLIENT_SECRET: z.string().min(1).refine((value) => value !== "replace_me"),
  TIKTOK_REDIRECT_URI: z.url().startsWith("https://"),
  TIKTOK_OAUTH_SCOPES: z.string().min(1).default("user.info.basic,video.upload,video.list"),
  TIKTOK_TOKEN_ENCRYPTION_KEY: z.string().min(32).refine((value) => value !== "replace_me"),
});

const youtubeSchema = z.object({
  YOUTUBE_CLIENT_ID: z.string().min(1).refine((value) => value !== "replace_me"),
  YOUTUBE_CLIENT_SECRET: z.string().min(1).refine((value) => value !== "replace_me"),
  YOUTUBE_REDIRECT_URI: z.url().startsWith("https://"),
  TIKTOK_TOKEN_ENCRYPTION_KEY: z.string().min(32).refine((value) => value !== "replace_me"),
});

const instagramSchema = z.object({
  INSTAGRAM_APP_ID: z.string().min(1).refine((value) => value !== "replace_me"),
  INSTAGRAM_APP_SECRET: z.string().min(1).refine((value) => value !== "replace_me"),
  INSTAGRAM_REDIRECT_URI: z.url().startsWith("https://"),
  INSTAGRAM_PUBLIC_BASE_URL: z.url().startsWith("https://"),
  INSTAGRAM_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v25.0"),
  TIKTOK_TOKEN_ENCRYPTION_KEY: z.string().min(32).refine((value) => value !== "replace_me"),
});

export type CoreEnv = z.infer<typeof coreSchema>;
export type IntegrationsEnv = z.infer<typeof integrationsSchema>;
export type KickEnv = z.infer<typeof kickSchema>;
export type TwitchEnv = z.infer<typeof twitchSchema>;
export type TikTokEnv = z.infer<typeof tiktokSchema>;
export type YouTubeEnv = z.infer<typeof youtubeSchema>;
export type InstagramEnv = z.infer<typeof instagramSchema>;

export const loadCoreEnv = (): CoreEnv => coreSchema.parse(process.env);
export const loadIntegrationsEnv = (): IntegrationsEnv => integrationsSchema.parse(process.env);
export const loadKickEnv = (): KickEnv => kickSchema.parse(process.env);
export const loadOptionalTwitchEnv = (): TwitchEnv | null => {
  const result = twitchSchema.safeParse(process.env);
  return result.success ? result.data : null;
};
export const loadOptionalTikTokEnv = (): TikTokEnv | null => {
  const result = tiktokSchema.safeParse(process.env);
  return result.success ? result.data : null;
};
export const loadOptionalYouTubeEnv = (): YouTubeEnv | null => {
  const result = youtubeSchema.safeParse(process.env);
  return result.success ? result.data : null;
};
export const loadOptionalInstagramEnv = (): InstagramEnv | null => {
  const result = instagramSchema.safeParse(process.env);
  return result.success ? result.data : null;
};
