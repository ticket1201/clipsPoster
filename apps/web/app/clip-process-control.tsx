"use client";

import { type FormEvent, useEffect, useState } from "react";

type ProcessingPhase = "idle" | "processing" | "ready" | "failed";

interface ClipProcessControlProps {
  clipId: string;
  initialStatus: string;
  processedHref: string;
  isProcessed: boolean;
  initialProcessedAt: string | null;
  onStatusChange: (status: string) => void;
}

const processingStatuses = new Set(["SELECTED", "DOWNLOADED"]);
const regenerateIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 7v5h-5M4 17v-5h5M6.1 8.5A7 7 0 0 1 18.4 7L20 9M4 15l1.6 2A7 7 0 0 0 17.9 15.5" />
  </svg>
);

export function ClipProcessControl({
  clipId,
  initialStatus,
  processedHref,
  isProcessed,
  initialProcessedAt,
  onStatusChange,
}: ClipProcessControlProps) {
  const [phase, setPhase] = useState<ProcessingPhase>(() => {
    if (processingStatuses.has(initialStatus)) return "processing";
    if (isProcessed) return "ready";
    if (initialStatus === "FAILED") return "failed";
    return "idle";
  });
  const [processedAt, setProcessedAt] = useState(initialProcessedAt);
  const [processingBaseline, setProcessingBaseline] = useState<string | null>(initialProcessedAt);

  useEffect(() => {
    if (phase !== "processing") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`/actions/process-clip?clipId=${encodeURIComponent(clipId)}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Unable to read processing status");
        const result = (await response.json()) as { status: string; processed: boolean; processedAt: string | null };
        if (cancelled) return;
        if (result.processed && result.processedAt && result.processedAt !== processingBaseline) {
          setProcessedAt(result.processedAt);
          setPhase("ready");
          onStatusChange(result.status);
          return;
        }
        if (result.status === "FAILED") {
          setPhase("failed");
          onStatusChange("FAILED");
          return;
        }
      } catch {
        // A temporary status request failure should not interrupt the active render.
      }
      if (!cancelled) timer = setTimeout(poll, 2_000);
    };

    timer = setTimeout(poll, 800);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [clipId, onStatusChange, phase, processingBaseline]);

  const startProcessing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase === "processing") return;
    setProcessingBaseline(processedAt);
    setPhase("processing");
    onStatusChange("SELECTED");

    try {
      const response = await fetch("/actions/process-clip", {
        method: "POST",
        headers: { accept: "application/json" },
        body: new FormData(event.currentTarget),
      });
      if (!response.ok) {
        setPhase("failed");
        onStatusChange("FAILED");
      }
    } catch {
      setPhase("failed");
      onStatusChange("FAILED");
    }
  };

  return (
    <div className="process-controls">
      {phase === "ready" ? <a className="process-button ready" href={processedHref} target="_blank">MP4</a> : null}
      <form className="clip-action" action="/actions/process-clip" method="post" onSubmit={startProcessing}>
        <input type="hidden" name="clipId" value={clipId} />
        <button
          className={`process-button ${phase === "processing" ? "processing" : ""} ${phase === "failed" ? "failed" : ""} ${phase === "ready" ? "regenerate" : ""}`}
          type="submit"
          disabled={phase === "processing"}
          title={phase === "ready" ? "Перекодировать видео с текущими настройками канала" : phase === "failed" ? "Повторить обработку" : "Создать вертикальное видео"}
          aria-label={phase === "processing" ? "Видео кодируется" : phase === "ready" ? "Перегенерировать видео" : "Создать вертикальное видео"}
        >
          {phase === "processing" ? (
            <>
              <span className="encoding-spinner" aria-hidden="true" />
              <span>Кодируем</span>
              <span className="encoding-dots" aria-hidden="true"><i /><i /><i /></span>
            </>
          ) : phase === "ready" ? regenerateIcon : phase === "failed" ? "Повторить" : "9:16"}
        </button>
        <span className="sr-only" role="status" aria-live="polite">
          {phase === "processing" ? "Видео кодируется" : phase === "failed" ? "Ошибка обработки" : ""}
        </span>
      </form>
    </div>
  );
}
