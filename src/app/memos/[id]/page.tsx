"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import MemoDetailView from "@/components/MemoDetailView";
import { useAuth } from "@/lib/AuthContext";
import { getMemo, getMemoBySeq } from "@/lib/storage";
import type { Memo } from "@/lib/schema";

export default function MemoPage() {
  return (
    <AuthGuard>
      <MemoPageContent />
    </AuthGuard>
  );
}

function MemoPageContent() {
  const { user, org } = useAuth();
  const router = useRouter();
  // The path segment is normally the memo's sequence number (memo #N); it may
  // also be a raw doc id for memos created before numbering.
  const key = String(useParams().id ?? "");

  const [memo, setMemo] = useState<Memo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !org) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const m = /^\d+$/.test(key) ? await getMemoBySeq(Number(key)) : await getMemo(key);
        if (cancelled) return;
        if (m) setMemo(m);
        else setError("This memo doesn't exist, or you don't have access to it.");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, org, key]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-3xl px-6 py-5 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-baseline rounded text-left hover:opacity-80"
            aria-label="Go to home"
          >
            <span className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Salescribe
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-sm text-zinc-500 dark:text-zinc-400 underline mr-2"
            >
              ← Back
            </button>
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
        {loading ? (
          <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">Loading…</div>
        ) : error ? (
          <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : memo ? (
          <MemoDetailView memo={memo} onUpdated={setMemo} />
        ) : null}
      </main>
    </div>
  );
}
