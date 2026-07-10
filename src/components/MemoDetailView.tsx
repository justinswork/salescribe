"use client";

import { useState } from "react";
import ExtractionView from "@/components/ExtractionView";
import VisibilityPill from "@/components/VisibilityPill";
import MemoEditor from "@/components/MemoEditor";
import { useAuth } from "@/lib/AuthContext";
import type { Memo } from "@/lib/schema";

// The "what's inside a memo" view: number + timestamp + author + visibility +
// transcript + structured extraction + follow-up chat + edit history. Editable
// in place by the author, or by an admin when the memo is shared. The parent
// owns navigation chrome and receives edits via onUpdated.
export default function MemoDetailView({
  memo,
  onUpdated,
}: {
  memo: Memo;
  onUpdated?: (m: Memo) => void;
}) {
  const { user, org } = useAuth();
  const [editing, setEditing] = useState(false);

  const isAuthor = Boolean(memo.authorUid && user?.uid && memo.authorUid === user.uid);
  const canEdit =
    isAuthor || (org?.role === "admin" && (memo.visibility ?? "shared") === "shared");

  if (editing) {
    return (
      <MemoEditor
        memo={memo}
        onUpdated={(m) => {
          onUpdated?.(m);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const revisions = memo.revisions ?? [];

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-2">
          {typeof memo.seq === "number" && (
            <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">#{memo.seq}</span>
          )}
          <span>Recorded {new Date(memo.created_iso).toLocaleString()}</span>
          {memo.authorName && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">· {memo.authorName}</span>
          )}
          <VisibilityPill visibility={memo.visibility} />
          {memo.is_demo && (
            <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
              demo
            </span>
          )}
        </div>
        {canEdit && onUpdated && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            Edit
          </button>
        )}
      </div>

      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
          Transcript
        </h2>
        <p className="text-sm whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
          {memo.transcript}
        </p>
      </section>

      <ExtractionView extraction={memo.extraction} />

      {memo.chat.length > 0 && (
        <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
            Follow-up
          </h2>
          <div className="flex flex-col gap-3">
            {memo.chat.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "assistant" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "assistant"
                      ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                      : "bg-blue-600 text-white"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {revisions.length > 0 && (
        <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
            History
          </h2>
          <ul className="flex flex-col gap-2">
            {revisions
              .slice()
              .reverse()
              .map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {r.action === "created" ? "Created" : "Edited"} by {r.byName}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0">
                    {new Date(r.at).toLocaleString()}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  );
}
