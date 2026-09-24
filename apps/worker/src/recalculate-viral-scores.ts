import { loadCoreEnv } from "@clips-poster/config";
import { createDatabaseClient } from "@clips-poster/database";
import { calculateViralScore, VIRAL_CANDIDATE_SCORE } from "@clips-poster/shared";

const env = loadCoreEnv();
const database = createDatabaseClient(env.DATABASE_URL);
const clips = await database.clip.findMany({
  select: {
    id: true,
    status: true,
    currentViews: true,
    sourceCreatedAt: true,
    lastObservedAt: true,
    metrics: {
      orderBy: { recordedAt: "desc" },
      take: 1,
      select: { viewsPerMinute: true, acceleration: true },
    },
  },
});

for (let offset = 0; offset < clips.length; offset += 100) {
  const batch = clips.slice(offset, offset + 100);
  await database.$transaction(batch.map((clip) => {
    const metric = clip.metrics[0];
    const viralScore = calculateViralScore({
      views: clip.currentViews,
      viewsPerMinute: metric?.viewsPerMinute ?? null,
      acceleration: metric?.acceleration ?? null,
      sourceCreatedAt: clip.sourceCreatedAt,
      observedAt: clip.lastObservedAt,
    });
    return database.clip.update({
      where: { id: clip.id },
      data: {
        viralScore,
        ...(viralScore >= VIRAL_CANDIDATE_SCORE
          && (clip.status === "DISCOVERED" || clip.status === "TRACKING")
          ? { status: "CANDIDATE" as const }
          : {}),
      },
    });
  }));
}

console.info(`Recalculated viral scores for ${clips.length} clips`);
await database.$disconnect();
