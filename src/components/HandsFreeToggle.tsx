"use client";

import { useHandsFree } from "@/lib/HandsFreeContext";

function HeadphonesIcon({ on }: { on: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1v-6a9 9 0 0 1 18 0v6a1 1 0 0 1-1 1h-2a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
      {on && <circle cx="12" cy="11" r="1.5" fill="currentColor" />}
    </svg>
  );
}

export default function HandsFreeToggle() {
  const { enabled, supported, toggle } = useHandsFree();

  const title = !supported
    ? "Hands-free not supported in this browser"
    : enabled
      ? "Hands-free: ON. Click to disable."
      : "Hands-free: OFF. Click to enable.";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!supported}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        enabled ? "text-blue-600 dark:text-blue-400" : "text-zinc-600 dark:text-zinc-300"
      } disabled:opacity-30 disabled:cursor-not-allowed`}
      aria-label={title}
      title={title}
    >
      <HeadphonesIcon on={enabled} />
    </button>
  );
}
