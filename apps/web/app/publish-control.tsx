"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface PublishControlProps {
  clipId: string;
  status: string;
  onStatusChange: (status: string) => void;
}

type PublishingPlatform = "TIKTOK" | "YOUTUBE" | "INSTAGRAM";
type Publication = { id: string; platform: PublishingPlatform; status: string };
type FailedTarget = { platform: PublishingPlatform; error: string };
type Phase = "idle" | "starting" | "processing" | "failed";
type TitleSuggestion = { title: string; words: number; fits: Array<"TIKTOK" | "YOUTUBE"> };
type TitleSuggestionsResponse = {
  original: string;
  preferences: Record<"TIKTOK" | "YOUTUBE", { label: string; videos: number; score: number }>;
  suggestions: TitleSuggestion[];
};
type TitlePlatform = "TIKTOK" | "YOUTUBE";
type TitleEvaluation = {
  overall: number;
  platforms: Record<TitlePlatform, number>;
  feedback: string;
};

const platformLabels: Record<PublishingPlatform, string> = {
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
};

const resendIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />
  </svg>
);

const titleLengthBucket = (title: string) => {
  const words = title.trim().split(/\s+/u).filter(Boolean).length;
  if (words <= 2) return { label: "Короткий · 1–2 слова", rank: 0 };
  if (words <= 5) return { label: "Средний · 3–5 слов", rank: 1 };
  return { label: "Длинный · 6+ слов", rank: 2 };
};

const preferredBucketRank = (label: string) => {
  if (label.startsWith("Короткий")) return 0;
  if (label.startsWith("Средний")) return 1;
  return 2;
};

const evaluateTitle = (
  title: string,
  preferences: TitleSuggestionsResponse["preferences"],
): TitleEvaluation => {
  const trimmed = title.trim();
  if (!trimmed) return { overall: 0, platforms: { TIKTOK: 0, YOUTUBE: 0 }, feedback: "Введите заголовок, чтобы увидеть оценку." };

  const bucket = titleLengthBucket(trimmed);
  const quality = Math.min(20, trimmed.length < 8 ? Math.round(trimmed.length * 2.5) : trimmed.length <= 70 ? 20 : Math.max(5, 20 - Math.ceil((trimmed.length - 70) / 2)))
    + (/\p{L}/u.test(trimmed) ? 8 : 0)
    + (!trimmed.includes("#") ? 4 : 0)
    + (!/[\r\n]/u.test(trimmed) ? 4 : 0)
    + (!/[!?.,]{3,}/u.test(trimmed) ? 4 : 0);
  const platforms = Object.fromEntries(
    (["TIKTOK", "YOUTUBE"] as const).map((platform) => {
      const distance = Math.abs(bucket.rank - preferredBucketRank(preferences[platform].label));
      const fit = distance === 0 ? 60 : distance === 1 ? 42 : 25;
      return [platform, Math.min(100, fit + quality)];
    }),
  ) as Record<TitlePlatform, number>;
  const feedback: string[] = [];
  const mismatched = (["TIKTOK", "YOUTUBE"] as const).filter(
    (platform) => bucket.label !== preferences[platform].label,
  );
  if (mismatched.length) {
    feedback.push(mismatched.map((platform) => `${platformLabels[platform]}: лучше ${preferences[platform].label.split(" · ")[1]?.toLowerCase()}`).join("; "));
  }
  if (trimmed.length < 8) feedback.push("Заголовок слишком короткий и теряет контекст");
  if (trimmed.length > 70) feedback.push("Лучше сократить до 70 символов");
  if (trimmed.includes("#")) feedback.push("Хэштеги добавятся отдельно — уберите их из заголовка");
  if (feedback.length === 0) feedback.push("Заголовок попадает в лучшие диапазоны по вашей аналитике");

  return {
    overall: Math.round((platforms.TIKTOK + platforms.YOUTUBE) / 2),
    platforms,
    feedback: feedback.join(" · "),
  };
};

const humanizePublishError = (message: string) => {
  if (message.includes("spam_risk_too_many_pending_share")) {
    return "TikTok: достигнут лимит из 5 незавершённых отправок за 24 часа. Опубликуйте или удалите ожидающие ролики в Inbox TikTok либо повторите позже.";
  }
  if (message.includes("not assigned") || message === "Нет привязанных площадок") {
    return "Для этого канала не назначен аккаунт публикации.";
  }
  if (message.includes("already uploaded") || message.includes("already published")) {
    return "Видео уже отправлено в эту площадку.";
  }
  return message;
};

export function PublishControl({ clipId, status, onStatusChange }: PublishControlProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [publications, setPublications] = useState<Publication[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failedTargets, setFailedTargets] = useState<FailedTarget[]>([]);
  const [titleDialogOpen, setTitleDialogOpen] = useState(false);
  const [titleLoading, setTitleLoading] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState<TitleSuggestionsResponse | null>(null);
  const [selectedTitle, setSelectedTitle] = useState("");
  const titleEvaluation = titleSuggestions ? evaluateTitle(selectedTitle, titleSuggestions.preferences) : null;

  useEffect(() => {
    if (phase !== "processing" || publications.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const results = await Promise.all(publications.map(async (publication) => {
          const response = await fetch(`/actions/publish?publicationId=${encodeURIComponent(publication.id)}`, { cache: "no-store" });
          const result = await response.json() as { status?: string; error?: string };
          if (!response.ok) throw new Error(result.error || `Ошибка ${publication.platform}`);
          return { ...publication, status: result.status ?? publication.status, error: result.error };
        }));
        if (cancelled) return;
        if (results.some((result) => result.status === "FAILED")) {
          const failedPublication = results.find((result) => result.status === "FAILED")!;
          const failureMessage = failedPublication.error || `Ошибка ${platformLabels[failedPublication.platform]}`;
          setFailedTargets((current) => [
            ...current.filter(({ platform }) => platform !== failedPublication.platform),
            { platform: failedPublication.platform, error: failureMessage },
          ]);
          setPhase("failed");
          setError(humanizePublishError(failureMessage));
          return;
        }
        if (results.every((result) => result.status === "DELIVERED" || result.status === "PUBLISHED")) {
          if (failedTargets.length > 0) {
            setPhase("failed");
            setError(humanizePublishError(failedTargets[0]!.error));
            return;
          }
          onStatusChange(results.some((result) => result.status === "DELIVERED") ? "DRAFTED" : "PUBLISHED");
          setPhase("idle");
          return;
        }
      } catch (caught) {
        if (!cancelled) {
          setPhase("failed");
          setError(caught instanceof Error ? caught.message : "Ошибка публикации");
        }
        return;
      }
      if (!cancelled) timer = setTimeout(poll, 4_000);
    };
    timer = setTimeout(poll, 2_000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [failedTargets, onStatusChange, phase, publications]);

  const isRepeat = status === "DRAFTED" || status === "PUBLISHED";
  if (status !== "APPROVED" && !isRepeat) return null;

  const publish = async (platform?: PublishingPlatform, title = selectedTitle, repeat = false) => {
    if (phase === "starting" || phase === "processing") return;
    setPhase("starting");
    setError(null);
    try {
      const response = await fetch("/actions/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clipId, ...(platform ? { platform } : {}), ...(title.trim() ? { title: title.trim() } : {}), ...(repeat ? { repeat: true } : {}) }),
      });
      const result = await response.json() as {
        publications?: Publication[];
        failures?: FailedTarget[];
        error?: string;
      };
      const remainingFailures = platform
        ? failedTargets.filter((failure) => failure.platform !== platform)
        : [];
      const nextFailures = [...remainingFailures, ...(result.failures ?? [])];
      setFailedTargets(nextFailures);
      if (!response.ok || !result.publications?.length) {
        setPhase("failed");
        setError(humanizePublishError(result.error || "Нет привязанных площадок"));
        return;
      }
      setPublications(result.publications);
      setPhase("processing");
    } catch (caught) {
      if (platform) {
        setFailedTargets((current) => [
          ...current.filter((failure) => failure.platform !== platform),
          { platform, error: caught instanceof Error ? caught.message : `Ошибка ${platformLabels[platform]}` },
        ]);
      }
      setPhase("failed");
      setError(caught instanceof Error ? caught.message : "Ошибка публикации");
    }
  };

  const openTitleDialog = async () => {
    setTitleDialogOpen(true);
    if (titleSuggestions) return;
    setTitleLoading(true);
    setError(null);
    try {
      const response = await fetch(`/actions/title-suggestions?clipId=${encodeURIComponent(clipId)}`, { cache: "no-store" });
      const result = await response.json() as TitleSuggestionsResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось подобрать заголовки");
      setTitleSuggestions(result);
      setSelectedTitle(result.original);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось подобрать заголовки");
      setTitleDialogOpen(false);
    } finally {
      setTitleLoading(false);
    }
  };

  if (phase === "failed" && failedTargets.length > 0) {
    return (
      <div className="publish-retry-buttons">
        {failedTargets.map((failure) => (
          <button
            key={failure.platform}
            type="button"
            className="publish-button failed"
            onClick={() => void publish(failure.platform, selectedTitle)}
            title={humanizePublishError(failure.error)}
          >
            {`Повторить ${platformLabels[failure.platform]}`}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`publish-button ${isRepeat ? "icon" : ""} ${phase === "failed" ? "failed" : ""}`}
        disabled={phase === "starting" || phase === "processing"}
        onClick={() => void openTitleDialog()}
        title={error ?? (isRepeat ? "Отправить ролик повторно во все привязанные аккаунты" : "Подобрать заголовок и опубликовать во все привязанные аккаунты")}
        aria-label={isRepeat ? "Отправить снова" : undefined}
      >
        {phase === "starting" ? "…" : phase === "processing" ? "…" : phase === "failed" ? "Повторить" : isRepeat ? resendIcon : "Опубликовать"}
      </button>
      {titleDialogOpen ? createPortal((
        <div className="title-suggestions-overlay" role="presentation" onMouseDown={() => setTitleDialogOpen(false)}>
          <section className="title-suggestions-dialog" role="dialog" aria-modal="true" aria-labelledby={`title-suggestions-${clipId}`} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><p className="section-kicker">SMART TITLE</p><h2 id={`title-suggestions-${clipId}`}>Оптимальный заголовок</h2></div>
              <button type="button" onClick={() => setTitleDialogOpen(false)} aria-label="Закрыть">×</button>
            </header>
            {titleLoading ? <div className="title-suggestions-loading">Анализируем опубликованные ролики…</div> : titleSuggestions ? (
              <div className="title-suggestions-body">
                <div className="title-strategy">
                  <span><b>TikTok</b><small>{titleSuggestions.preferences.TIKTOK.label} · {titleSuggestions.preferences.TIKTOK.videos || "мало"} видео</small></span>
                  <span><b>YouTube</b><small>{titleSuggestions.preferences.YOUTUBE.label} · {titleSuggestions.preferences.YOUTUBE.videos || "мало"} видео</small></span>
                </div>
                <label className="title-editor">Заголовок
                  <input value={selectedTitle} maxLength={100} onChange={(event) => setSelectedTitle(event.target.value)} autoFocus />
                  <small>{selectedTitle.length} / 100</small>
                </label>
                {titleEvaluation ? (
                  <div className={`title-score ${titleEvaluation.overall >= 80 ? "good" : titleEvaluation.overall >= 55 ? "medium" : "weak"}`} role="status" aria-live="polite">
                    <div className="title-score-heading">
                      <span><strong>{titleEvaluation.overall}</strong><small>/100</small></span>
                      <div className="title-score-bar" role="progressbar" aria-label="Оценка заголовка" aria-valuemin={0} aria-valuemax={100} aria-valuenow={titleEvaluation.overall}>
                        <i style={{ width: `${titleEvaluation.overall}%` }} />
                      </div>
                    </div>
                    <div className="title-score-platforms">
                      <span>TikTok <b>{titleEvaluation.platforms.TIKTOK}</b></span>
                      <span>YouTube <b>{titleEvaluation.platforms.YOUTUBE}</b></span>
                    </div>
                    <p>{titleEvaluation.feedback}</p>
                  </div>
                ) : null}
                <div className="title-suggestion-list">
                  {titleSuggestions.suggestions.map((suggestion) => (
                    <button className={selectedTitle === suggestion.title ? "selected" : ""} type="button" key={suggestion.title} onClick={() => setSelectedTitle(suggestion.title)}>
                      <span>{suggestion.title}</span>
                      <small>{suggestion.words} слов{suggestion.fits.length ? ` · подходит: ${suggestion.fits.map((platform) => platformLabels[platform]).join(", ")}` : ""}</small>
                    </button>
                  ))}
                </div>
                <footer>
                  <button type="button" className="ghost-button" onClick={() => setTitleDialogOpen(false)}>Отмена</button>
                  <button type="button" className="publish-submit" disabled={!selectedTitle.trim()} onClick={() => { setTitleDialogOpen(false); void publish(undefined, selectedTitle, isRepeat); }}>
                    {isRepeat ? "Отправить снова во все аккаунты" : "Опубликовать в привязанные аккаунты"}
                  </button>
                </footer>
              </div>
            ) : null}
          </section>
        </div>
      ), document.body) : null}
    </>
  );
}
