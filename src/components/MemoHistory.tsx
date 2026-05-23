"use client";

import Link from "next/link";
import type { Memo } from "@/lib/schema";

type Props = {
  memos: Memo[];
  onOpen: (memo: Memo) => void;
  onDelete: (id: string) => void;
};

const VISIBLE_LIMIT = 8;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function memoLabel(m: Memo): string {
  const company = m.extraction.deal?.company || m.extraction.contacts[0]?.company;
  if (company) return company;
  if (m.extraction.contacts[0]?.name) return m.extraction.contacts[0].name;
  return m.extraction.summary.slice(0, 40) + (m.extraction.summary.length > 40 ? "…" : "");
}

export default function MemoHistory({ memos, onOpen, onDelete }: Props) {
  if (memos.length === 0) return null;

  const hasMore = memos.length > VISIBLE_LIMIT;

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Recent memos
          <span className="ml-2 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-normal text-zinc-700 dark:text-zinc-300">
            {memos.length}
          </span>
        </h2>
        {hasMore && (
          <Link
            href="/memos"
            className="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            View all {memos.length} →
          </Link>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {memos.slice(0, VISIBLE_LIMIT).map((m) => (
          <li
            key={m.id}
            className="flex items-start justify-between gap-3 rounded border border-zinc-200 dark:border-zinc-800 p-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <button
              type="button"
              onClick={() => onOpen(m)}
              className="text-left flex-1 min-w-0"
            >
              <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate flex items-center gap-2">
                <span className="truncate">{memoLabel(m)}</span>
                {m.is_demo && (
                  <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                    demo
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
                {m.extraction.summary}
              </div>
            </button>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                {formatDate(m.created_iso)}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Delete this memo?")) onDelete(m.id);
                }}
                className="text-xs text-zinc-400 hover:text-red-600"
                aria-label="Delete memo"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
