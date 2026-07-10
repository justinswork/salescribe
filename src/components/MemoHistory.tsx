"use client";

import Link from "next/link";
import Avatar from "./Avatar";
import VisibilityPill from "./VisibilityPill";
import type { Memo } from "@/lib/schema";

type Props = {
  memos: Memo[];
  onOpen: (memo: Memo) => void;
  onDelete: (id: string) => void;
  // Signed-in user's uid + photo, so we can label their own memos "You", show
  // their profile photo, and only offer delete on memos they authored (matches
  // the Firestore rules).
  currentUid?: string;
  currentPhotoURL?: string | null;
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

export default function MemoHistory({
  memos,
  onOpen,
  onDelete,
  currentUid,
  currentPhotoURL,
}: Props) {
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
        {memos.slice(0, VISIBLE_LIMIT).map((m) => {
          const mine = Boolean(m.authorUid && currentUid && m.authorUid === currentUid);
          const authorName = m.authorName || "Teammate";
          return (
            <li
              key={m.id}
              className="rounded border border-zinc-200 dark:border-zinc-800 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {m.is_demo && (
                    <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                      demo
                    </span>
                  )}
                  <VisibilityPill visibility={m.visibility} />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                    {formatDate(m.created_iso)}
                  </span>
                  {(!m.authorUid || mine) && (
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
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onOpen(m)}
                  className="text-left flex-1 min-w-0"
                >
                  <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {memoLabel(m)}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
                    {m.extraction.summary}
                  </div>
                </button>
                <Avatar
                  size={36}
                  name={authorName}
                  seed={m.authorUid || authorName}
                  label={mine ? "You" : authorName}
                  photoURL={mine ? currentPhotoURL : undefined}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
