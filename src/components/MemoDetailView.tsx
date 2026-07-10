"use client";

import ExtractionView from "@/components/ExtractionView";
import VisibilityPill from "@/components/VisibilityPill";
import type { Memo } from "@/lib/schema";

// The "what's inside a memo" view: timestamp + DEMO pill (if applicable) +
// transcript + structured extraction + follow-up chat history. Used by both
// the home page (when the user opens a memo from Recent Memos) and the
// /memos page (when they click a memo on the all-memos list). Doesn't render
// its own header or back button — the parent page owns navigation chrome.
export default function MemoDetailView({ memo }: { memo: Memo }) {
  return (
    <>
      <div className="text-sm text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-2">
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
  );
}
