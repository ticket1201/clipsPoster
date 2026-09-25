import { AnalyticsPanel, type AnalyticsSummary } from "../analytics-panel";

export const dynamic = "force-dynamic";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

const emptySummary: AnalyticsSummary = {
  totals: { videos: 0, views: 0, likes: 0, comments: 0, shares: 0 },
  platforms: {
    YOUTUBE: { videos: 0, views: 0, likes: 0, comments: 0, shares: 0 },
    TIKTOK: { videos: 0, views: 0, likes: 0, comments: 0, shares: 0 },
  },
  breakdowns: { games: [], channels: [], postingTimes: [], titleLengths: [], hashtags: [] },
  insights: ["Нужно собрать первые данные публикаций."],
  videos: [],
  momentum: [],
  updatedAt: null,
};

export default async function AnalyticsPage() {
  let summary = emptySummary;
  let tiktokReconnectAccounts: string[] = [];
  try {
    const [summaryResponse, accountsResponse] = await Promise.all([
      fetch(`${API_URL}/analytics/summary`, { cache: "no-store" }),
      fetch(`${API_URL}/publishing/accounts?platform=TIKTOK`, { cache: "no-store" }),
    ]);
    if (summaryResponse.ok) summary = await summaryResponse.json() as AnalyticsSummary;
    if (accountsResponse.ok) {
      const accounts = await accountsResponse.json() as Array<{ username: string; authorizedScopes: string | null }>;
      tiktokReconnectAccounts = accounts
        .filter((account) => !account.authorizedScopes?.split(/[\s,]+/).includes("video.list"))
        .map((account) => account.username);
    }
  } catch {
    // The page remains usable while the local API restarts.
  }
  return (
    <main className="dashboard analytics-page">
      <header className="topbar">
        <a className="brand" href="/">CLIPS / POSTER</a>
        <nav className="topbar-nav"><a href="/">Клипы</a><a className="active" href="/analytics">Analytics</a></nav>
      </header>
      <div className="analytics-hero"><p className="section-kicker">PERFORMANCE LAB</p><h1>Что действительно залетает</h1><p>Сравнение скорости просмотров и реакций внутри каждого аккаунта.</p></div>
      <AnalyticsPanel summary={summary} tiktokReconnectAccounts={tiktokReconnectAccounts} />
    </main>
  );
}
