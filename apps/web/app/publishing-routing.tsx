"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PublishingAccount {
  id: string;
  platform: "TIKTOK" | "YOUTUBE" | "INSTAGRAM";
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  connectedAt: string | null;
  authorizedScopes: string | null;
}

export interface PublishingSource {
  id: string;
  source: "TWITCH" | "KICK";
  displayName: string;
  handle: string;
}

export interface PublishingAssignment {
  id: string;
  contentAccountId: string;
  twitchChannelId: string | null;
  kickChannelId: string | null;
}

export function PublishingRouting({
  platform,
  initialAccounts,
  sources,
  initialAssignments,
  connectUrl,
  notice,
}: {
  platform: "TIKTOK" | "YOUTUBE" | "INSTAGRAM";
  initialAccounts: PublishingAccount[];
  sources: PublishingSource[];
  initialAssignments: PublishingAssignment[];
  connectUrl: string | null;
  notice: string | null;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [savingAccount, setSavingAccount] = useState(false);
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openMenuRef = useRef<HTMLDivElement>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>(() => {
    const grouped: Record<string, string[]> = {};
    initialAssignments.forEach((assignment) => {
      const channelId = assignment.twitchChannelId ?? assignment.kickChannelId;
      if (channelId) grouped[channelId] = [...(grouped[channelId] ?? []), assignment.contentAccountId];
    });
    return grouped;
  });

  const assignedSourceCount = useMemo(
    () => sources.reduce((count, source) => count + ((selections[source.id]?.length ?? 0) > 0 ? 1 : 0), 0),
    [selections, sources],
  );
  const routeCount = useMemo(
    () => Object.values(selections).reduce((count, accountIds) => count + accountIds.length, 0),
    [selections],
  );
  const needsUploadScope = platform === "TIKTOK"
    && accounts.some((account) => !account.authorizedScopes?.split(/[\s,]+/).includes("video.upload"));
  const platformLabel = platform === "TIKTOK" ? "TikTok" : platform === "YOUTUBE" ? "YouTube" : "Instagram";

  useEffect(() => {
    if (!openSourceId) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!openMenuRef.current?.contains(event.target as Node)) setOpenSourceId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenSourceId(null);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openSourceId]);

  const removeAccount = async (accountId: string) => {
    if (savingAccount) return;
    setSavingAccount(true);
    setError(null);
    try {
      const response = await fetch(`/actions/publishing-account?accountId=${encodeURIComponent(accountId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`Не удалось удалить ${platformLabel}-аккаунт`);
      setAccounts((current) => current.filter((account) => account.id !== accountId));
      setSelections((current) => Object.fromEntries(Object.entries(current).map(([sourceId, selectedIds]) => [
        sourceId,
        selectedIds.filter((selectedId) => selectedId !== accountId),
      ])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить аккаунт");
    } finally {
      setSavingAccount(false);
    }
  };

  const assignAccount = async (source: PublishingSource, accountId: string, enabled = true) => {
    const pendingKey = `${source.id}:${accountId}`;
    setPendingSource(pendingKey);
    setError(null);
    try {
      const response = await fetch("/actions/publishing-assignment", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: source.source,
          platform,
          channelId: source.id,
          contentAccountId: accountId || null,
          enabled,
        }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить назначение");
      setSelections((current) => {
        const selectedIds = current[source.id] ?? [];
        return {
          ...current,
          [source.id]: enabled
            ? [...new Set([...selectedIds, accountId])]
            : selectedIds.filter((selectedId) => selectedId !== accountId),
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить назначение");
    } finally {
      setPendingSource(null);
    }
  };

  return (
    <details className="panel publishing-panel collapsible-panel">
      <summary className="panel-heading collapsible-summary">
        <div><p className="section-kicker">{platform} ROUTING</p><h2>Publishing accounts</h2></div>
        <span className="summary-meta">
          <span className="auto-label">{`${routeCount} ROUTES · ${assignedSourceCount}/${sources.length} SOURCES`}</span>
          <span className="collapse-chevron" aria-hidden="true" />
        </span>
      </summary>
      <div className="publishing-layout">
        <div className="publishing-accounts">
          <div className="oauth-connect">
            <span><b>{platformLabel} OAuth</b><small>Подключите канал через официальный экран {platformLabel}.</small></span>
            {connectUrl
              ? <a href={connectUrl}>{needsUploadScope ? `Переподключить ${platformLabel}` : `Подключить ${platformLabel}`}</a>
              : <button type="button" disabled>Добавьте credentials</button>}
          </div>
          <div className="account-chips">
            {accounts.map((account) => (
              <span key={account.id} className="account-chip">
                {account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : null}
                <b>{platformLabel}</b> {account.displayName ?? `@${account.username}`}
                <button type="button" onClick={() => void removeAccount(account.id)} aria-label={`Remove ${account.displayName ?? account.username}`}>×</button>
              </span>
            ))}
            {accounts.length === 0 ? <small>Добавьте аккаунт, на который будут уходить ролики.</small> : null}
          </div>
          {needsUploadScope ? <p className="routing-warning">Для черновиков включите scope <b>video.upload</b> в TikTok Developer Portal и переподключите аккаунт.</p> : null}
          <p className="routing-note">
            AUTO PROCESS · score &gt; 30 автоматически готовит видео 9:16. Отправка выполняется только вручную кнопкой «Опубликовать».
          </p>
          {notice ? <p className={`routing-notice ${notice === "connected" ? "success" : ""}`}>{notice === "connected" ? `${platformLabel}-аккаунт подключён.` : `${platformLabel} OAuth: ${notice}`}</p> : null}
          {error ? <p className="routing-error" role="alert">{error}</p> : null}
        </div>
        <div className="routing-list">
          {sources.map((source) => (
            <div key={source.id} className="routing-row">
              <span><b>{source.source}</b><strong>{source.displayName}</strong><small>@{source.handle}</small></span>
              <div
                className={`routing-account-select${openSourceId === source.id ? " open" : ""}`}
                ref={openSourceId === source.id ? openMenuRef : undefined}
              >
                <button
                  type="button"
                  className="routing-account-trigger"
                  aria-expanded={openSourceId === source.id}
                  aria-haspopup="listbox"
                  disabled={accounts.length === 0}
                  onClick={() => setOpenSourceId((current) => current === source.id ? null : source.id)}
                >
                  <span>{(() => {
                    const selectedAccounts = accounts.filter((account) => selections[source.id]?.includes(account.id));
                    if (selectedAccounts.length === 0) return accounts.length === 0 ? "Нет аккаунтов" : "Выбрать аккаунты";
                    if (selectedAccounts.length === 1) return selectedAccounts[0]?.displayName ?? `@${selectedAccounts[0]?.username}`;
                    return `${selectedAccounts.length} аккаунта`;
                  })()}</span>
                  <i aria-hidden="true" />
                </button>
                {openSourceId === source.id ? (
                  <div className="routing-account-menu" role="listbox" aria-multiselectable="true">
                    {accounts.map((account) => {
                      const checked = selections[source.id]?.includes(account.id) ?? false;
                      const pendingKey = `${source.id}:${account.id}`;
                      return (
                        <label key={account.id} className="routing-account-option">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={pendingSource === pendingKey}
                            onChange={(event) => void assignAccount(source, account.id, event.target.checked)}
                          />
                          {account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : null}
                          <span><strong>{account.displayName ?? `@${account.username}`}</strong><small>@{account.username}</small></span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
