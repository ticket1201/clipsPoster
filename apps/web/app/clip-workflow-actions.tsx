"use client";

import { useState } from "react";

interface ClipWorkflowActionsProps {
  clipId: string;
  status: string;
  isProcessed: boolean;
  onStatusChange: (status: string) => void;
}

const statusLabels: Record<string, string> = {
  DISCOVERED: "Новый",
  TRACKING: "Наблюдаем",
  CANDIDATE: "Кандидат",
  SELECTED: "В очереди",
  DOWNLOADED: "Кодируется",
  PROCESSED: "Готов",
  APPROVED: "Готов к публикации",
  DRAFTED: "Доставлено в TikTok Inbox",
  PUBLISHED: "Опубликован",
  REJECTED: "Отклонён",
  FAILED: "Ошибка",
};

const rejectIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

interface WorkflowAction {
  status: string;
  label: string;
  kind?: "danger";
  icon?: "reject";
}

export function ClipWorkflowActions({
  clipId,
  status,
  isProcessed,
  onStatusChange,
}: ClipWorkflowActionsProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const changeStatus = async (nextStatus: string) => {
    if (pending) return;
    setPending(nextStatus);
    setError(false);
    try {
      const response = await fetch("/actions/clip-status", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clipId, status: nextStatus }),
      });
      if (!response.ok) throw new Error("Unable to change status");
      const result = (await response.json()) as { status: string };
      onStatusChange(result.status);
    } catch {
      setError(true);
    } finally {
      setPending(null);
    }
  };

  const actions = getActions(status, isProcessed);

  return (
    <div className="workflow">
      <span className={`workflow-status status-${status.toLocaleLowerCase()}`}>
        {error ? "Не сохранено" : statusLabels[status] ?? status}
      </span>
      {actions.map((action) => (
        <button
          key={action.status}
          type="button"
          className={`${action.kind === "danger" ? "danger" : ""} ${action.icon ? "icon-button" : ""}`}
          disabled={Boolean(pending)}
          onClick={() => void changeStatus(action.status)}
          title={action.label}
          aria-label={action.label}
        >
          {pending === action.status ? "…" : action.icon === "reject" ? rejectIcon : action.label}
        </button>
      ))}
    </div>
  );
}

const getActions = (status: string, isProcessed: boolean): WorkflowAction[] => {
  if (status === "PUBLISHED" || status === "DRAFTED") return [];
  if (status === "APPROVED") return [{ status: "REJECTED", label: "Отклонить", kind: "danger", icon: "reject" }];
  if (status === "PROCESSED" || (isProcessed && status !== "REJECTED")) {
    return [
      { status: "APPROVED", label: "Одобрить" },
      { status: "REJECTED", label: "Отклонить", kind: "danger" },
    ];
  }
  if (status === "REJECTED" || status === "FAILED") {
    return [{ status: isProcessed ? "PROCESSED" : "TRACKING", label: "Вернуть" }];
  }
  if (status === "CANDIDATE") {
    return [{ status: "REJECTED", label: "Отклонить", kind: "danger" }];
  }
  if (status === "SELECTED" || status === "DOWNLOADED") return [];
  return [
    { status: "CANDIDATE", label: "В кандидаты" },
    { status: "REJECTED", label: "Отклонить", kind: "danger" },
  ];
};
