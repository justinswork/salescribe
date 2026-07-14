"use client";

import { useState, type CSSProperties } from "react";
import { AVATAR_COLORS, hashString, initialsFrom } from "@/components/Avatar";

// Circular company avatar — the customer counterpart to the person Avatar. Shows
// the customer's logo inset on a white disc (logos are drawn for a light
// background; insetting keeps square favicons from having their corners clipped
// by the circle), falling back to initials on a color hashed from the customer's
// stable id — so an account is the same color everywhere it appears.
//
// Logos come from a third-party favicon service that can be slow/flaky on a
// cold fetch, especially when a long list requests dozens at once. So we
// lazy-load (only visible rows fetch) and, if an image fails, fall back to the
// initials disc rather than the browser's broken-image placeholder. We key the
// failure on the URL, so editing the logo re-attempts the new one.

export default function CustomerAvatar({
  name,
  logoUrl,
  seed,
  size = 40,
  label,
}: {
  name: string;
  logoUrl?: string | null;
  // Stable key (the customer id) so the fallback color is consistent; falls back
  // to the name.
  seed?: string;
  size?: number;
  label?: string;
}) {
  const title = label ?? name;
  const box: CSSProperties = { width: `${size}px`, height: `${size}px` };
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (logoUrl && failedUrl !== logoUrl) {
    return (
      <span
        title={title}
        aria-label={title}
        style={box}
        className="shrink-0 inline-flex items-center justify-center rounded-full bg-white border border-zinc-200 dark:border-zinc-700 overflow-hidden"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(logoUrl)}
          className="h-[78%] w-[78%] object-contain"
        />
      </span>
    );
  }

  const color = AVATAR_COLORS[hashString(seed || name) % AVATAR_COLORS.length];
  return (
    <span
      title={title}
      aria-label={title}
      style={{ ...box, backgroundColor: color, fontSize: Math.round(size * 0.36) }}
      className="shrink-0 inline-flex items-center justify-center rounded-full font-semibold text-white"
    >
      {initialsFrom(name)}
    </span>
  );
}
