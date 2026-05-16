"use client";

import type { Memo } from "@/lib/schema";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Renders the "memory" the coach has access to for this memo.
// Showing this visibly is half the point: it demonstrates that the coach's
// follow-up question is grounded against retrieved past context, not just
// the current transcript.
export default function RelatedMemos({ memos }: { memos: Memo[] }) {
  if (memos.length === 0) return null;
  return (
    <section className="rounded-lg border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/20 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-2">
        Related past memos · the coach can reference these
      </h2>
      <ul className="flex flex-col gap-2">
        {memos.map((m) => (
          <li key={m.id} className="text-sm">
            <span className="text-xs text-amber-700 dark:text-amber-400 tabular-nums mr-2">
              {formatDate(m.created_iso)}
            </span>
            <span className="text-zinc-900 dark:text-zinc-100">{m.extraction.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
