import type { MemoVisibility } from "@/lib/schema";

// Visibility badge: green "Shared" (team-visible) or blue "Private" with a lock.
// Kept visually distinct from the amber "Demo" pill. A missing value is treated
// as shared.
export default function VisibilityPill({ visibility }: { visibility?: MemoVisibility }) {
  const isPrivate = (visibility ?? "shared") === "private";

  if (isPrivate) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        Private
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300">
      Shared
    </span>
  );
}
