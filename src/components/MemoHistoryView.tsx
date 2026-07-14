"use client";

import { useState } from "react";
import Avatar from "@/components/Avatar";
import { useAuth } from "@/lib/AuthContext";
import type { MemoRevision } from "@/lib/schema";

export function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function summarize(r: MemoRevision): string {
  if (r.action === "created") return "created this memo";
  const fields = (r.changes ?? []).map((c) => c.field);
  if (fields.length === 0) return "made an edit";
  if (fields.length <= 2) return `changed ${fields.join(", ")}`;
  return `changed ${fields.slice(0, 2).join(", ")}, and ${fields.length - 2} more`;
}

export default function MemoHistoryView({ revisions }: { revisions: MemoRevision[] }) {
  const { roster } = useAuth();
  // Newest first.
  const ordered = [...revisions].reverse();
  const [selected, setSelected] = useState(0);

  if (ordered.length === 0) {
    return <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">No history yet.</div>;
  }

  const current = ordered[Math.min(selected, ordered.length - 1)];

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* Change list */}
      <ul className="md:w-72 shrink-0 flex flex-col gap-1 md:border-r md:border-zinc-200 md:dark:border-zinc-800 md:pr-4">
        {ordered.map((r, i) => {
          const member = r.byUid ? roster[r.byUid] : undefined;
          return (
          <li key={i}>
            <button
              type="button"
              onClick={() => setSelected(i)}
              className={`w-full flex items-start gap-2 rounded p-2 text-left ${
                i === selected
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
              }`}
            >
              <Avatar size={28} name={r.byName} seed={r.byUid} photoURL={member?.photoURL} color={member?.avatarColor} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-zinc-900 dark:text-zinc-100 leading-snug">
                  <span className="font-medium">{r.byName}</span> {summarize(r)}
                </span>
                <span className="block text-xs text-zinc-400 dark:text-zinc-500">{ago(r.at)}</span>
              </span>
            </button>
          </li>
          );
        })}
      </ul>

      {/* Selected revision detail */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <Avatar
            size={32}
            name={current.byName}
            seed={current.byUid}
            photoURL={current.byUid ? roster[current.byUid]?.photoURL : undefined}
            color={current.byUid ? roster[current.byUid]?.avatarColor : undefined}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{current.byName}</div>
            <div className="text-xs text-zinc-400 dark:text-zinc-500">
              {new Date(current.at).toLocaleString()}
            </div>
          </div>
        </div>

        {current.action === "created" ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Created this memo.</div>
        ) : (current.changes ?? []).length === 0 ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Edited, no field changes recorded.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {(current.changes ?? []).map((c, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,140px)_1fr] gap-3 items-start">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 pt-0.5">{c.field}</div>
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="rounded bg-green-100 dark:bg-green-950/40 text-green-900 dark:text-green-200 px-2 py-1 text-sm break-words whitespace-pre-wrap">
                    {c.to || "—"}
                  </span>
                  <span className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 line-through px-2 py-1 text-sm break-words whitespace-pre-wrap">
                    {c.from || "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
