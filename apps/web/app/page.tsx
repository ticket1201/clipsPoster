export const dynamic = "force-dynamic";

import { ClipFeed, type FeedClip } from "./clip-feed";
import {
  PublishingRouting,
  type PublishingAccount,
  type PublishingAssignment,
  type PublishingSource,
} from "./publishing-routing";
import { WebcamCropEditor, type WebcamCropValue } from "./webcam-crop-editor";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

interface Channel {
  id: string;
  slug: string;
  displayName: string;
  thumbnailUrl: string | null;
  webcamX: number | null;
  webcamY: number | null;
  webcamWidth: number | null;
  webcamHeight: number | null;
  webcamOnly: boolean;
  clips: Array<{ id: string; thumbnailUrl: string | null }>;
  _count: { clips: number };
}

interface TwitchChannel {
  id: string;
  login: string;
  displayName: string;
  thumbnailUrl: string | null;
  webcamX: number | null;
  webcamY: number | null;
  webcamWidth: number | null;
  webcamHeight: number | null;
  webcamOnly: boolean;
  clips: Array<{ id: string; thumbnailUrl: string | null }>;
  _count: { clips: number };
}

const getWebcamCrop = (channel: {
  webcamX: number | null;
  webcamY: number | null;
  webcamWidth: number | null;
  webcamHeight: number | null;
}): WebcamCropValue | null => (
  channel.webcamX != null
    && channel.webcamY != null
    && channel.webcamWidth != null
    && channel.webcamHeight != null
    ? { x: channel.webcamX, y: channel.webcamY, width: channel.webcamWidth, height: channel.webcamHeight }
    : null
);

interface CollectorStatus {
  configured?: boolean;
  channels: number;
  clips: number;
  metrics: number;
  intervalMinutes: number;
  counts: Record<string, number>;
}

interface TikTokStatus {
  configured: boolean;
  connectUrl: string | null;
}

const trashIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
  </svg>
);

const fetchData = async <T,>(path: string, fallback: T): Promise<T> => {
  try {
    const response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as T) : fallback;
  } catch {
    return fallback;
  }
};

export default async function Home({ searchParams }: { searchParams: Promise<{ tiktok?: string; youtube?: string; instagram?: string }> }) {
  const query = await searchParams;
  const [
    channels,
    kickClips,
    twitchChannels,
    twitchClips,
    twitchStatus,
    publishingAccounts,
    publishingAssignments,
    tiktokStatus,
    youtubeAccounts,
    youtubeAssignments,
    youtubeStatus,
    instagramAccounts,
    instagramAssignments,
    instagramStatus,
  ] = await Promise.all([
    fetchData<Channel[]>("/kick/channels", []),
    fetchData<FeedClip[]>("/kick/clips?limit=200", []),
    fetchData<TwitchChannel[]>("/twitch/channels", []),
    fetchData<FeedClip[]>("/twitch/clips?limit=200", []),
    fetchData<CollectorStatus>("/twitch/status", {
      configured: false,
      channels: 0,
      clips: 0,
      metrics: 0,
      intervalMinutes: 5,
      counts: {},
    }),
    fetchData<PublishingAccount[]>("/publishing/accounts?platform=TIKTOK", []),
    fetchData<PublishingAssignment[]>("/publishing/assignments?platform=TIKTOK", []),
    fetchData<TikTokStatus>("/publishing/tiktok/status", { configured: false, connectUrl: null }),
    fetchData<PublishingAccount[]>("/publishing/accounts?platform=YOUTUBE", []),
    fetchData<PublishingAssignment[]>("/publishing/assignments?platform=YOUTUBE", []),
    fetchData<TikTokStatus>("/publishing/youtube/status", { configured: false, connectUrl: null }),
    fetchData<PublishingAccount[]>("/publishing/accounts?platform=INSTAGRAM", []),
    fetchData<PublishingAssignment[]>("/publishing/assignments?platform=INSTAGRAM", []),
    fetchData<TikTokStatus>("/publishing/instagram/status", { configured: false, connectUrl: null }),
  ]);
  const clips = [...kickClips, ...twitchClips]
    .toSorted((left, right) => new Date(right.sourceCreatedAt).getTime() - new Date(left.sourceCreatedAt).getTime())
    .slice(0, 200);
  const publishingSources: PublishingSource[] = [
    ...channels.map((channel) => ({
      id: channel.id,
      source: "KICK" as const,
      displayName: channel.displayName,
      handle: channel.slug,
    })),
    ...twitchChannels.map((channel) => ({
      id: channel.id,
      source: "TWITCH" as const,
      displayName: channel.displayName,
      handle: channel.login,
    })),
  ];

  return (
    <main className="dashboard">
      <header className="topbar">
        <a className="brand" href="/">CLIPS / POSTER</a>
        <nav className="topbar-nav"><a className="active" href="/">Клипы</a><a href="/analytics">Analytics</a></nav>
      </header>

      <PublishingRouting
        platform="TIKTOK"
        initialAccounts={publishingAccounts}
        sources={publishingSources}
        initialAssignments={publishingAssignments}
        connectUrl={tiktokStatus.connectUrl}
        notice={query.tiktok ?? null}
      />

      <PublishingRouting
        platform="YOUTUBE"
        initialAccounts={youtubeAccounts}
        sources={publishingSources}
        initialAssignments={youtubeAssignments}
        connectUrl={youtubeStatus.connectUrl}
        notice={query.youtube ?? null}
      />

      <PublishingRouting
        platform="INSTAGRAM"
        initialAccounts={instagramAccounts}
        sources={publishingSources}
        initialAssignments={instagramAssignments}
        connectUrl={instagramStatus.connectUrl}
        notice={query.instagram ?? null}
      />

      <section className="workspace-grid">
        <details className="panel channels-panel collapsible-panel">
          <summary className="panel-heading collapsible-summary">
            <div><p className="section-kicker">SOURCES</p><h2>Monitored channels</h2></div>
            <span className="summary-meta">
              <span className="auto-label">{channels.length + twitchChannels.length} CHANNELS</span>
              <span className="collapse-chevron" aria-hidden="true" />
            </span>
          </summary>
          <form className="add-channel" action="/actions/kick-channel" method="post">
            <label htmlFor="slug"><b>KICK</b> · Add channel by slug</label>
            <div>
              <span>kick.com/</span>
              <input id="slug" name="slug" placeholder="channel" required pattern="[A-Za-z0-9_-]{2,40}" />
              <button type="submit">Add</button>
            </div>
          </form>

          <ul className="channel-list">
            {channels.map((channel) => (
              <li key={channel.id}>
                <div className="channel-identity">
                  {channel.thumbnailUrl ? <img src={channel.thumbnailUrl} alt="" /> : <span className="avatar-fallback" />}
                  <div><strong>{channel.displayName}</strong><small>@{channel.slug}</small></div>
                </div>
                <div className="channel-actions">
                  <WebcamCropEditor
                    channelId={channel.id}
                    source="KICK"
                    displayName={channel.displayName}
                    handle={channel.slug}
                    thumbnailUrls={channel.clips.flatMap((clip) => clip.thumbnailUrl ? [clip.thumbnailUrl] : [])}
                    initialCrop={getWebcamCrop(channel)}
                    initialWebcamOnly={channel.webcamOnly}
                  />
                  <div className="channel-count"><strong>{channel._count.clips}</strong><small>clips</small></div>
                  <form action="/actions/kick-channel/remove" method="post">
                    <input type="hidden" name="channelId" value={channel.id} />
                    <button className="remove-button" type="submit" aria-label={`Remove ${channel.displayName}`}>
                      {trashIcon}
                    </button>
                  </form>
                </div>
              </li>
            ))}
            {channels.length === 0 ? <li className="empty">Add the first Kick channel to begin.</li> : null}
          </ul>

          <form className="add-channel source-divider" action="/actions/twitch-channel" method="post">
            <label htmlFor="login">
              <b>TWITCH</b> · {twitchStatus.configured ? "Add channel by login" : "Credentials required"}
            </label>
            <div>
              <span>twitch.tv/</span>
              <input
                id="login"
                name="login"
                placeholder="channel"
                required
                disabled={!twitchStatus.configured}
                pattern="[A-Za-z0-9_]{2,25}"
              />
              <button type="submit" disabled={!twitchStatus.configured}>Add</button>
            </div>
          </form>

          <ul className="channel-list twitch-list">
            {twitchChannels.map((channel) => (
              <li key={channel.id}>
                <div className="channel-identity">
                  {channel.thumbnailUrl ? <img src={channel.thumbnailUrl} alt="" /> : <span className="avatar-fallback" />}
                  <div><strong>{channel.displayName}</strong><small>@{channel.login}</small></div>
                </div>
                <div className="channel-actions">
                  <WebcamCropEditor
                    channelId={channel.id}
                    source="TWITCH"
                    displayName={channel.displayName}
                    handle={channel.login}
                    thumbnailUrls={channel.clips.flatMap((clip) => clip.thumbnailUrl ? [clip.thumbnailUrl] : [])}
                    initialCrop={getWebcamCrop(channel)}
                    initialWebcamOnly={channel.webcamOnly}
                  />
                  <div className="channel-count"><strong>{channel._count.clips}</strong><small>clips</small></div>
                  <form action="/actions/twitch-channel/remove" method="post">
                    <input type="hidden" name="channelId" value={channel.id} />
                    <button className="remove-button" type="submit" aria-label={`Remove ${channel.displayName}`}>
                      {trashIcon}
                    </button>
                  </form>
                </div>
              </li>
            ))}
            {twitchStatus.configured && twitchChannels.length === 0
              ? <li className="empty">Add the first Twitch channel to begin.</li>
              : null}
          </ul>
        </details>

        <div className="panel signal-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">LIVE DATA</p><h2>Latest signals</h2></div>
            <span className="auto-label">{clips.length} CLIPS</span>
          </div>
          <ClipFeed clips={clips} apiUrl={API_URL} />
        </div>
      </section>

      <footer className="site-footer">
        <span>PRIVATE LOCAL PIPELINE · MEDIA IS PROCESSED LOCALLY</span>
        <nav aria-label="Legal">
          <a href="/terms">Terms of Service</a>
          <a href="/privacy">Privacy Policy</a>
        </nav>
      </footer>
    </main>
  );
}
