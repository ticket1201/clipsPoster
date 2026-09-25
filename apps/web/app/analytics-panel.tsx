interface AnalyticsTotals { videos: number; views: number; likes: number; comments: number; shares: number }
interface AnalyticsBreakdown {
  dimension: "GAME" | "CHANNEL" | "TIME" | "TITLE" | "HASHTAGS";
  platform: "YOUTUBE" | "TIKTOK";
  label: string;
  videos: number;
  views: number;
  medianRatio: number;
  medianViewsPerHour: number;
  engagementRate: number;
}
interface AnalyticsVideo {
  id: string;
  videoId: string;
  platform: "YOUTUBE" | "TIKTOK";
  title: string;
  account: string;
  accountUsername: string;
  source: "TWITCH" | "KICK";
  sourceChannel: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number;
  viewsPerHour: number;
  ageHours: number;
  ratio: number;
  growth: { h1: number | null; h6: number | null; h24: number | null; h72: number | null };
  performance: "VIRAL" | "ABOVE" | "NORMAL" | "WEAK" | "COLLECTING";
}

export interface AnalyticsSummary {
  totals: AnalyticsTotals;
  platforms: { YOUTUBE: AnalyticsTotals; TIKTOK: AnalyticsTotals };
  breakdowns: {
    games: AnalyticsBreakdown[];
    channels: AnalyticsBreakdown[];
    postingTimes: AnalyticsBreakdown[];
    titleLengths: AnalyticsBreakdown[];
    hashtags: AnalyticsBreakdown[];
  };
  insights: string[];
  updatedAt: string | null;
  videos: AnalyticsVideo[];
  momentum: AnalyticsVideo[];
}

const compactNumber = new Intl.NumberFormat("ru", { notation: "compact", maximumFractionDigits: 1 });
const performanceLabels = {
  VIRAL: "Залетело",
  ABOVE: "Выше нормы",
  NORMAL: "Обычно",
  WEAK: "Слабо",
  COLLECTING: "Копим данные",
} as const;
const platformLabels = { YOUTUBE: "YouTube Shorts", TIKTOK: "TikTok" } as const;

const videoHref = (video: AnalyticsSummary["videos"][number]) => video.platform === "YOUTUBE"
  ? `https://www.youtube.com/shorts/${video.videoId}`
  : `https://www.tiktok.com/player/v1/${video.videoId}`;

function AnalyticsRows({ videos }: { videos: AnalyticsSummary["videos"] }) {
  if (videos.length === 0) return <div className="analytics-empty">Публичных роликов с доступной статистикой пока нет.</div>;
  return (
    <div className="analytics-list">
      {videos.map((video) => (
        <a key={video.id} href={videoHref(video)} target="_blank" rel="noreferrer">
          <span className={`performance-badge ${video.performance.toLowerCase()}`}>{performanceLabels[video.performance]}</span>
          <span className="analytics-title"><strong>{video.title}</strong><small>{video.account} · {video.source} @{video.sourceChannel}</small></span>
          <span><strong>{compactNumber.format(video.views)}</strong><small>просмотров</small></span>
          <span><strong>{compactNumber.format(video.viewsPerHour)}</strong><small>просм./час</small></span>
          <span><strong>{(video.engagementRate * 100).toFixed(1)}%</strong><small>реакции</small></span>
          <span><strong>{video.comments} / {video.shares}</strong><small>комм. / репосты</small></span>
        </a>
      ))}
    </div>
  );
}

function BreakdownCard({ title, hint, items }: { title: string; hint: string; items: AnalyticsBreakdown[] }) {
  return (
    <article className="analytics-factor">
      <header><strong>{title}</strong><small>{hint}</small></header>
      <div className="analytics-factor-platforms">
        {(["YOUTUBE", "TIKTOK"] as const).map((platform) => {
          const platformItems = items.filter((item) => item.platform === platform).slice(0, 4);
          return (
            <section key={platform}>
              <h4>{platformLabels[platform]}</h4>
              {platformItems.map((item) => (
                <div className={item.videos >= 3 ? "" : "low-confidence"} key={item.label}>
                  <span><b>{item.label}</b><small>{item.videos} видео · {compactNumber.format(item.views)} просмотров</small></span>
                  <span><b>×{item.medianRatio.toFixed(1)}</b><small>{compactNumber.format(item.medianViewsPerHour)}/час · {(item.engagementRate * 100).toFixed(1)}%</small></span>
                </div>
              ))}
              {platformItems.length === 0 ? <p>Пока нет данных</p> : null}
            </section>
          );
        })}
      </div>
    </article>
  );
}

const growthValue = (video: AnalyticsVideo): { value: number; label: string } | null => {
  if (video.growth.h24 !== null) return { value: video.growth.h24, label: "за 24 часа" };
  if (video.growth.h6 !== null) return { value: video.growth.h6, label: "за 6 часов" };
  if (video.growth.h1 !== null) return { value: video.growth.h1, label: "за 1 час" };
  if (video.growth.h72 !== null) return { value: video.growth.h72, label: "за 72 часа" };
  return null;
};

export function AnalyticsPanel({ summary, tiktokReconnectAccounts = [] }: { summary: AnalyticsSummary; tiktokReconnectAccounts?: string[] }) {
  return (
    <details className="panel analytics-panel" open>
      <summary className="panel-heading collapsible-summary">
        <div><p className="section-kicker">PERFORMANCE</p><h2>Что залетает</h2></div>
        <span className="summary-meta"><span className="auto-label">YOUTUBE + TIKTOK · 30 MIN</span><span className="collapse-chevron" aria-hidden="true" /></span>
      </summary>
      <div className="analytics-body">
        {tiktokReconnectAccounts.length ? (
          <p className="analytics-warning">TikTok Analytics: переподключи {tiktokReconnectAccounts.join(", ")} на странице «Клипы», чтобы выдать scope <b>video.list</b>.</p>
        ) : null}
        <div className="analytics-stats">
          <div><strong>{summary.totals.videos}</strong><small>роликов</small></div>
          <div><strong>{compactNumber.format(summary.totals.views)}</strong><small>просмотров</small></div>
          <div><strong>{compactNumber.format(summary.totals.likes)}</strong><small>лайков</small></div>
          <div><strong>{compactNumber.format(summary.totals.comments)}</strong><small>комментариев</small></div>
          <div><strong>{compactNumber.format(summary.totals.shares)}</strong><small>репостов</small></div>
          <form action="/actions/analytics-refresh" method="post"><button type="submit">Обновить сейчас</button></form>
        </div>
        <div className="analytics-platforms">
          {(["YOUTUBE", "TIKTOK"] as const).map((platform) => {
            const totals = summary.platforms[platform];
            return (
              <div key={platform}>
                <strong>{platformLabels[platform]}</strong>
                <span>{totals.videos} видео · {compactNumber.format(totals.views)} просмотров</span>
                <small>{compactNumber.format(totals.likes)} лайков · {compactNumber.format(totals.comments)} комментариев · {compactNumber.format(totals.shares)} репостов</small>
              </div>
            );
          })}
        </div>
        <div className="analytics-insights">
          {summary.insights.map((insight) => <p key={insight}>{insight}</p>)}
        </div>
        <section className="analytics-momentum-section">
          <div><p className="section-kicker">MOMENTUM</p><h3>Кто растёт прямо сейчас</h3></div>
          {summary.momentum.length ? (
            <div className="analytics-momentum-list">
              {summary.momentum.map((video) => {
                const growth = growthValue(video);
                return growth ? (
                  <a href={videoHref(video)} target="_blank" rel="noreferrer" key={video.id}>
                    <span><b>{video.title}</b><small>{platformLabels[video.platform]} · @{video.sourceChannel}</small></span>
                    <span><b>+{compactNumber.format(growth.value)}</b><small>{growth.label}</small></span>
                  </a>
                ) : null;
              })}
            </div>
          ) : <div className="analytics-empty">Копим историю. Первый честный прирост появится после двух снимков с интервалом минимум 1 час.</div>}
        </section>
        <section className="analytics-factors-section">
          <div><p className="section-kicker">FACTORS</p><h3>Что влияет на результат</h3><small>×1.0 — обычная скорость для этого аккаунта. Серым отмечены выводы менее чем по трём видео.</small></div>
          <div className="analytics-factors-grid">
            <BreakdownCard title="Время публикации" hint="Часовой пояс Тбилиси" items={summary.breakdowns.postingTimes} />
            <BreakdownCard title="Длина заголовка" hint="Только хук до первой строки" items={summary.breakdowns.titleLengths} />
            <BreakdownCard title="Игры" hint="Сравнение внутри аккаунта" items={summary.breakdowns.games} />
            <BreakdownCard title="Исходные каналы" hint="Twitch и Kick" items={summary.breakdowns.channels} />
            <BreakdownCard title="Количество хэштегов" hint="В полной подписи" items={summary.breakdowns.hashtags} />
          </div>
        </section>
        {(["YOUTUBE", "TIKTOK"] as const).map((platform) => (
          <section className="analytics-platform-section" key={platform}>
            <h3>{platformLabels[platform]}</h3>
            <AnalyticsRows videos={summary.videos.filter((video) => video.platform === platform)} />
          </section>
        ))}
      </div>
    </details>
  );
}
