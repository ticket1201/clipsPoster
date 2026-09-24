"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ClipProcessControl } from "./clip-process-control";
import { ClipThumbnail } from "./clip-thumbnail";
import { ClipWorkflowActions } from "./clip-workflow-actions";
import { PublishControl } from "./publish-control";

export interface FeedClip {
  id: string;
  externalId: string;
  source: "KICK" | "TWITCH";
  title: string;
  url: string;
  thumbnailUrl: string | null;
  currentViews: number;
  viralScore: number | null;
  processedFilePath: string | null;
  tiktokFilePath: string | null;
  processedAt: string | null;
  status: string;
  sourceCreatedAt: string;
  kickChannel: { slug: string; displayName: string } | null;
  twitchChannel?: { login: string; displayName: string } | null;
  metrics: Array<{ viewsPerMinute: number | null }>;
}

type SourceFilter = "ALL" | "KICK" | "TWITCH";
type StatusFilter = "ALL" | "UNDECIDED" | "PENDING" | "CANDIDATE" | "PROCESSING" | "READY" | "APPROVED" | "DRAFTED" | "REJECTED" | "FAILED";
type SortMode = "VIRAL" | "NEWEST" | "VIEWS" | "VELOCITY";

const SORT_STORAGE_KEY = "clips-poster:clip-sort:v1";
const sortModes = new Set<SortMode>(["VIRAL", "NEWEST", "VIEWS", "VELOCITY"]);

const formatNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const formatDate = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const processingStatuses = new Set(["SELECTED", "DOWNLOADED"]);
const decidedStatuses = new Set(["APPROVED", "DRAFTED", "PUBLISHED", "REJECTED"]);

export function ClipFeed({ clips, apiUrl }: { clips: FeedClip[]; apiUrl: string }) {
  const [items, setItems] = useState(clips);
  const [source, setSource] = useState<SourceFilter>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [sort, setSort] = useState<SortMode>("NEWEST");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());

  useEffect(() => {
    try {
      const savedSort = localStorage.getItem(SORT_STORAGE_KEY) as SortMode | null;
      if (savedSort && sortModes.has(savedSort)) setSort(savedSort);
    } catch {
      // Keep the default when browser storage is unavailable.
    }
  }, []);

  const handleSortChange = (nextSort: SortMode) => {
    setSort(nextSort);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, nextSort);
    } catch {
      // Sorting still works for the current page when persistence is unavailable.
    }
  };

  const updateClipStatus = useCallback((clipId: string, nextStatus: string) => {
    setItems((current) => current.map((clip) => (
      clip.id === clipId ? { ...clip, status: nextStatus } : clip
    )));
  }, []);

  const visibleClips = useMemo(() => items
    .filter((clip) => {
      if (source !== "ALL" && clip.source !== source) return false;
      if (status === "UNDECIDED" && decidedStatuses.has(clip.status)) return false;
      if (status === "READY" && clip.status !== "PROCESSED") return false;
      if (status === "CANDIDATE" && clip.status !== "CANDIDATE") return false;
      if (status === "APPROVED" && clip.status !== "APPROVED") return false;
      if (status === "DRAFTED" && clip.status !== "DRAFTED") return false;
      if (status === "REJECTED" && clip.status !== "REJECTED") return false;
      if (status === "FAILED" && clip.status !== "FAILED") return false;
      if (status === "PROCESSING" && !processingStatuses.has(clip.status)) return false;
      if (status === "PENDING" && (
        clip.processedFilePath
        || clip.status === "FAILED"
        || processingStatuses.has(clip.status)
      )) return false;
      if (!deferredSearch) return true;
      const channel = clip.twitchChannel?.displayName ?? clip.kickChannel?.displayName ?? "";
      return `${clip.title} ${channel}`.toLocaleLowerCase().includes(deferredSearch);
    })
    .toSorted((left, right) => {
      if (sort === "VIEWS") return right.currentViews - left.currentViews;
      if (sort === "VELOCITY") return velocity(right) - velocity(left);
      if (sort === "NEWEST") return createdAt(right) - createdAt(left);
      return (right.viralScore ?? 0) - (left.viralScore ?? 0) || createdAt(right) - createdAt(left);
    }), [deferredSearch, items, sort, source, status]);

  return (
    <>
      <div className="clip-toolbar">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по названию или каналу"
          aria-label="Поиск клипов"
        />
        <select value={source} onChange={(event) => setSource(event.target.value as SourceFilter)} aria-label="Источник">
          <option value="ALL">Все источники</option>
          <option value="TWITCH">Twitch</option>
          <option value="KICK">Kick</option>
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="Статус">
          <option value="ALL">Все статусы</option>
          <option value="UNDECIDED">Без решения</option>
          <option value="PENDING">Не обработаны</option>
          <option value="CANDIDATE">Кандидаты</option>
          <option value="PROCESSING">Кодируются</option>
          <option value="READY">Готовые MP4</option>
          <option value="APPROVED">Одобрены</option>
          <option value="DRAFTED">Доставлены в TikTok Inbox</option>
          <option value="REJECTED">Отклонены</option>
          <option value="FAILED">С ошибкой</option>
        </select>
        <select value={sort} onChange={(event) => handleSortChange(event.target.value as SortMode)} aria-label="Сортировка">
          <option value="VIRAL">По viral score</option>
          <option value="NEWEST">Сначала новые</option>
          <option value="VIEWS">По просмотрам</option>
          <option value="VELOCITY">По скорости</option>
        </select>
        <span className="filter-count">{visibleClips.length} / {items.length}</span>
        <form className="collect-form" action="/actions/collect" method="post">
          <button className="ghost-button" type="submit">Collect now</button>
        </form>
      </div>

      <div className="clip-list">
        {visibleClips.map((clip) => {
          const metric = clip.metrics[0];
          const channel = clip.twitchChannel?.displayName ?? clip.kickChannel?.displayName ?? clip.source;
          const score = clip.viralScore ?? 0;
          const clipUrl = clip.source === "TWITCH" && clip.twitchChannel
            ? `https://www.twitch.tv/${encodeURIComponent(clip.twitchChannel.login)}/clip/${encodeURIComponent(clip.externalId)}`
            : clip.url;
          return (
            <div className="clip-entry" key={clip.id}>
              <a className="clip-row" href={clipUrl} target="_blank" rel="noreferrer">
                <ClipThumbnail channel={channel} source={clip.source} thumbnailUrl={clip.thumbnailUrl} />
                <div className="clip-copy">
                  <strong>{clip.title}</strong>
                  <small>{formatDate.format(new Date(clip.sourceCreatedAt))} · {clip.source}</small>
                  <span className={`mobile-score ${score >= 60 ? "hot" : score >= 35 ? "warm" : ""}`}>
                    VIRAL {score.toFixed(1)}
                  </span>
                </div>
                <div className="metric"><strong>{formatNumber.format(clip.currentViews)}</strong><small>views</small></div>
                <div className="metric accent velocity"><strong>{formatVelocity(metric?.viewsPerMinute)}</strong><small>views/min</small></div>
                <div className={`viral-score ${score >= 60 ? "hot" : score >= 35 ? "warm" : ""}`}>
                  <strong>{score.toFixed(1)}</strong><small>score</small>
                </div>
              </a>
              <div className="clip-entry-actions">
                <ClipWorkflowActions
                  clipId={clip.id}
                  status={clip.status}
                  isProcessed={Boolean(clip.processedFilePath)}
                  onStatusChange={(nextStatus) => updateClipStatus(clip.id, nextStatus)}
                />
                <PublishControl
                  clipId={clip.id}
                  status={clip.status}
                  onStatusChange={(nextStatus) => updateClipStatus(clip.id, nextStatus)}
                />
                <ClipProcessControl
                  clipId={clip.id}
                  initialStatus={clip.status}
                  isProcessed={Boolean(clip.processedFilePath)}
                  initialProcessedAt={clip.processedAt}
                  processedHref={`${apiUrl}/clips/${clip.id}/processed`}
                  onStatusChange={(nextStatus) => updateClipStatus(clip.id, nextStatus)}
                />
              </div>
            </div>
          );
        })}
        {visibleClips.length === 0 ? <div className="empty">По этим фильтрам клипов нет.</div> : null}
      </div>
    </>
  );
}

const velocity = (clip: FeedClip): number => clip.metrics[0]?.viewsPerMinute ?? 0;
const createdAt = (clip: FeedClip): number => new Date(clip.sourceCreatedAt).getTime();

const formatVelocity = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
};
