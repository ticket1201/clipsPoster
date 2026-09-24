export interface MetricSnapshot {
  recordedAt: Date;
  views: number;
  viewsPerMinute: number | null;
}

export interface ClipGrowth {
  viewsPerMinute: number | null;
  viewsLast5Minutes: number | null;
  viewsLast15Minutes: number | null;
  viewsLast60Minutes: number | null;
  acceleration: number | null;
}

export interface ViralScoreInput {
  views: number;
  viewsPerMinute: number | null;
  acceleration: number | null;
  sourceCreatedAt: Date;
  observedAt: Date;
}

export const VIRAL_CANDIDATE_SCORE = 35;

export const calculateClipGrowth = (
  currentViews: number,
  observedAt: Date,
  previousMetrics: MetricSnapshot[],
): ClipGrowth => {
  const metrics = previousMetrics.toSorted(
    (left, right) => right.recordedAt.getTime() - left.recordedAt.getTime(),
  );
  const latest = metrics[0];
  const elapsedMinutes = latest
    ? (observedAt.getTime() - latest.recordedAt.getTime()) / 60_000
    : 0;
  const viewsPerMinute =
    latest && elapsedMinutes > 0
      ? round((currentViews - latest.views) / elapsedMinutes)
      : null;

  const windowGrowth = (minutes: number): number | null => {
    const threshold = observedAt.getTime() - minutes * 60_000;
    const baseline = metrics.find((metric) => metric.recordedAt.getTime() <= threshold);
    return baseline ? Math.max(0, currentViews - baseline.views) : null;
  };

  const acceleration =
    viewsPerMinute !== null && latest?.viewsPerMinute !== null && latest?.viewsPerMinute !== undefined
      ? round((viewsPerMinute - latest.viewsPerMinute) / elapsedMinutes)
      : null;

  return {
    viewsPerMinute,
    viewsLast5Minutes: windowGrowth(5),
    viewsLast15Minutes: windowGrowth(15),
    viewsLast60Minutes: windowGrowth(60),
    acceleration,
  };
};

export const calculateViralScore = ({
  views,
  viewsPerMinute,
  acceleration,
  sourceCreatedAt,
  observedAt,
}: ViralScoreInput): number => {
  const ageHours = Math.max(0, (observedAt.getTime() - sourceCreatedAt.getTime()) / 3_600_000);
  const freshness = Math.exp(-ageHours / 24);
  const viewSignal = normalizedLog(Math.max(0, views), 5_000);
  const velocitySignal = normalizedLog(Math.max(0, viewsPerMinute ?? 0), 50);
  const accelerationSignal = normalizedLog(Math.max(0, acceleration ?? 0), 5);

  return Math.round(Math.min(100, (
    freshness * 20
    + viewSignal * 20
    + velocitySignal * 45
    + accelerationSignal * 15
  )) * 10) / 10;
};

const normalizedLog = (value: number, ceiling: number): number => Math.min(
  1,
  Math.log1p(value) / Math.log1p(ceiling),
);

const round = (value: number): number => Math.round(value * 10_000) / 10_000;
