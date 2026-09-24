import { loadCoreEnv } from "@clips-poster/config";
import { createDatabaseClient } from "@clips-poster/database";
import { collectKickChannel, KickClient } from "@clips-poster/kick";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: npm run collect:kick -- <channel-slug>");
  process.exitCode = 1;
} else {
  const env = loadCoreEnv();
  const database = createDatabaseClient(env.DATABASE_URL);
  try {
    const result = await collectKickChannel(database, new KickClient(), slug);
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await database.$disconnect();
  }
}
