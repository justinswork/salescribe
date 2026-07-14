import type { CSSProperties } from "react";

// Identity avatar: a real profile photo when we have one, otherwise initials on
// a color derived deterministically from the author's stable id — so a given
// person is always the same color everywhere. (Future: let users pick their own
// photo or color; this is the sensible default until then.)

export const AVATAR_COLORS = [
  "#0F6E56", // teal
  "#534AB7", // purple
  "#993C1D", // coral
  "#185FA5", // blue
  "#993556", // pink
  "#3B6D11", // green
];

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export default function Avatar({
  name,
  seed,
  photoURL,
  color,
  size = 40,
  label,
}: {
  name: string;
  // Stable identity key (e.g. uid) so color is consistent regardless of display
  // name; falls back to the name.
  seed?: string;
  photoURL?: string | null;
  // Explicit color chosen by the user; overrides the auto (hashed) color.
  color?: string | null;
  size?: number;
  // Tooltip text; defaults to the name.
  label?: string;
}) {
  const title = label ?? name;
  const box: CSSProperties = { width: `${size}px`, height: `${size}px` };

  if (photoURL) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoURL}
        alt=""
        title={title}
        aria-label={title}
        referrerPolicy="no-referrer"
        style={box}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }

  const resolved = color || AVATAR_COLORS[hashString(seed || name) % AVATAR_COLORS.length];
  return (
    <span
      title={title}
      aria-label={title}
      style={{ ...box, backgroundColor: resolved, fontSize: Math.round(size * 0.33) }}
      className="shrink-0 inline-flex items-center justify-center rounded-full font-medium text-white"
    >
      {initialsFrom(name)}
    </span>
  );
}
