"use client";

import { useState } from "react";

interface ClipThumbnailProps {
  channel: string;
  source: "KICK" | "TWITCH";
  thumbnailUrl: string | null;
}

export function ClipThumbnail({ channel, source, thumbnailUrl }: ClipThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const src = source === "TWITCH" && thumbnailUrl
    ? `/actions/thumbnail?url=${encodeURIComponent(thumbnailUrl)}`
    : thumbnailUrl;

  return (
    <div className={`clip-thumb ${failed || !src ? "missing" : ""}`}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="clip-thumb-fallback" aria-hidden="true">{source === "TWITCH" ? "TW" : "K"}</span>
      )}
      <span>{channel}</span>
    </div>
  );
}
