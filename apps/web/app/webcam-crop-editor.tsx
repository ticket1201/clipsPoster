"use client";

import { useRouter } from "next/navigation";
import { useState, type PointerEvent as ReactPointerEvent } from "react";

export interface WebcamCropValue {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WebcamCropEditorProps {
  channelId: string;
  source: "TWITCH" | "KICK";
  displayName: string;
  handle: string;
  thumbnailUrls: string[];
  initialCrop: WebcamCropValue | null;
  initialWebcamOnly: boolean;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function WebcamCropEditor({
  channelId,
  source,
  displayName,
  handle,
  thumbnailUrls,
  initialCrop,
  initialWebcamOnly,
}: WebcamCropEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [crop, setCrop] = useState<WebcamCropValue | null>(initialCrop);
  const [draft, setDraft] = useState<WebcamCropValue | null>(initialCrop);
  const [webcamOnly, setWebcamOnly] = useState(initialWebcamOnly);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const previewUrls = thumbnailUrls.map((thumbnailUrl) => source === "TWITCH"
    ? `/actions/thumbnail?url=${encodeURIComponent(thumbnailUrl)}`
    : thumbnailUrl);
  const previewUrl = previewUrls[previewIndex] ?? null;

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  const startSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!previewUrl) return;
    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(point);
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const updateSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const point = pointFromEvent(event);
    setDraft({
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    });
  };

  const finishSelection = () => setDragStart(null);

  const save = async (nextCrop: WebcamCropValue | null, nextWebcamOnly = false) => {
    if (nextCrop && (nextCrop.width < 0.05 || nextCrop.height < 0.05)) {
      setError("Рамка слишком маленькая. Выделите вебку целиком.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/actions/webcam-crop", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, channelId, crop: nextCrop, webcamOnly: nextCrop ? nextWebcamOnly : false }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить рамку вебки");
      setCrop(nextCrop);
      setDraft(nextCrop);
      setWebcamOnly(nextCrop ? nextWebcamOnly : false);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить рамку вебки");
    } finally {
      setSaving(false);
    }
  };

  const showEditor = () => {
    setDraft(crop);
    setPreviewIndex(0);
    setError(null);
    setOpen(true);
  };

  const showPreviousPreview = () => {
    setPreviewIndex((current) => (current - 1 + previewUrls.length) % previewUrls.length);
  };

  const showNextPreview = () => {
    setPreviewIndex((current) => (current + 1) % previewUrls.length);
  };

  return (
    <>
      <button
        className={`webcam-config-button ${crop ? "configured" : ""}`}
        type="button"
        onClick={showEditor}
      >
        <span aria-hidden="true" />{webcamOnly ? "Только вебка" : crop ? "Вебка настроена" : "Настроить вебку"}
      </button>
      {open ? (
        <div className="webcam-editor-overlay" role="dialog" aria-modal="true" aria-label={`Webcam crop for ${displayName}`}>
          <div className="webcam-editor-dialog">
            <header>
              <div><p className="section-kicker">{source} · @{handle}</p><h2>Область вебкамеры</h2></div>
              <button type="button" className="dialog-close" onClick={() => setOpen(false)} aria-label="Закрыть">×</button>
            </header>
            <div className="webcam-editor-body">
              <p>Зажмите и протяните рамку точно по границам вебки. Перелистайте разные клипы, чтобы проверить шаблон. «На весь экран» оставит в вертикальном видео только выбранную вебку, по центру.</p>
              {previewUrl ? (
                <>
                  <div className="webcam-preview-nav">
                    <button type="button" onClick={showPreviousPreview} disabled={previewUrls.length < 2} aria-label="Предыдущий клип">←</button>
                    <span>Клип <b>{previewIndex + 1}</b> из {previewUrls.length}</span>
                    <button type="button" onClick={showNextPreview} disabled={previewUrls.length < 2} aria-label="Следующий клип">→</button>
                  </div>
                  <div
                    className="webcam-crop-stage"
                    onPointerDown={startSelection}
                    onPointerMove={updateSelection}
                    onPointerUp={finishSelection}
                    onPointerCancel={finishSelection}
                  >
                    <img src={previewUrl} alt={`Клип ${previewIndex + 1} канала ${displayName}`} draggable={false} />
                    {draft ? (
                      <span
                        className="webcam-crop-box"
                        style={{
                          left: `${draft.x * 100}%`,
                          top: `${draft.y * 100}%`,
                          width: `${draft.width * 100}%`,
                          height: `${draft.height * 100}%`,
                        }}
                      ><i>ВЕБКА</i></span>
                    ) : null}
                  </div>
                </>
              ) : <div className="webcam-preview-missing">Сначала соберите хотя бы один клип этого канала — его превью понадобится для настройки.</div>}
              {error ? <p className="routing-error" role="alert">{error}</p> : null}
              <footer>
                <button type="button" className="webcam-reset-button" disabled={saving || !crop} onClick={() => void save(null)}>Автодетект</button>
                <button
                  type="button"
                  className={`webcam-fullscreen-button ${webcamOnly ? "active" : ""}`}
                  disabled={saving || !previewUrl || !draft}
                  onClick={() => void save(draft, true)}
                >
                  {saving ? "Сохраняем…" : "На весь экран"}
                </button>
                <button type="button" className="webcam-save-button" disabled={saving || !previewUrl || !draft} onClick={() => void save(draft, false)}>
                  {saving ? "Сохраняем…" : "Сохранить рамку"}
                </button>
              </footer>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
