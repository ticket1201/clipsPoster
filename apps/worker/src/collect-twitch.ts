import { loadCoreEnv, loadOptionalTwitchEnv } from "@clips-poster/config";
import { createDatabaseClient } from "@clips-poster/database";
import { collectTwitchChannel, TwitchClient } from "@clips-poster/twitch";

const login = process.argv[2];
if (!login) throw new Error("Usage: npm run collect:twitch -- <channel-login>");

const credentials = loadOptionalTwitchEnv();

const env = loadCoreEnv();
const database = createDatabaseClient(env.DATABASE_URL);

try {
  const result = await collectTwitchChannel(
    database,
    new TwitchClient(credentials ? {
      clientId: credentials.TWITCH_CLIENT_ID,
      clientSecret: credentials.TWITCH_CLIENT_SECRET,
    } : undefined),
    login,
  );
  console.info(result);
} finally {
  await database.$disconnect();
}
