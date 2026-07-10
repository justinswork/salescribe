"use client";

import { useState } from "react";
import ExtractionView from "@/components/ExtractionView";
import VisibilityPill from "@/components/VisibilityPill";
import MemoEditor from "@/components/MemoEditor";
import MemoHistoryView, { ago } from "@/components/MemoHistoryView";
import { useAuth } from "@/lib/AuthContext";
import type { Memo } from "@/lib/schema";

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

// The "what's inside a memo" view: a header (number, author, updated-by, edit)
// plus Details / History tabs. Editable in place by the author, or by an admin
// when the memo is shared. The parent owns navigation and receives edits via
// onUpdated.
export default function MemoDetailView({
  memo,
  onUpdated,
}: {
  memo: Memo;
  onUpdated?: (m: Memo) => void;
}) {
  const { user, org } = useAuth();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"details" | "history">("details");

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
  const last = revisions[revisions.length - 1];

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
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
          {last && (
            <div className="text-xs text-zinc-400 dark:text-zinc-500">
              Updated by {last.byName} · {ago(last.at)}
            </div>
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

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("details")}
          className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab === "details"
              ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100 font-medium"
              : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          Details
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
            tab === "history"
              ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100 font-medium"
              : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          <ClockIcon />
          History
          {revisions.length > 0 && (
            <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-normal">
              {revisions.length}
            </span>
          )}
        </button>
      </div>

      {tab === "details" ? (
        <>
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
        </>
      ) : (
        <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
          <MemoHistoryView revisions={revisions} />
        </section>
      )}
    </>
  );
}
