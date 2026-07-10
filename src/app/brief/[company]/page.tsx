"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import BriefView from "@/components/BriefView";
import { useAuth } from "@/lib/AuthContext";
import { authedFetch, apiError } from "@/lib/api";
import { loadMemos, findMemosByCompany } from "@/lib/storage";
import type { Brief } from "@/lib/schema";

export default function BriefPage() {
  return (
    <AuthGuard>
      <BriefPageContent />
    </AuthGuard>
  );
}

function BriefPageContent() {
  const { user, org } = useAuth();
  const router = useRouter();
  const company = decodeURIComponent(String(useParams().company ?? ""));

  const [brief, setBrief] = useState<Brief | null>(null);
  const [memoCount, setMemoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !org) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const memos = await loadMemos();
        const matching = findMemosByCompany(company, memos);
        if (cancelled) return;
        setMemoCount(matching.length);
        if (matching.length === 0) {
          setError(`No memos found for "${company}".`);
          return;
        }
        const r = await authedFetch("/api/brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company, memos: matching }),
        });
        if (!r.ok) throw new Error(await apiError(r, "Briefing failed"));
        const data = (await r.json()) as { brief: Brief };
        if (!cancelled) setBrief(data.brief);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, org, company]);

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
        {loading && (
          <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            <span className="inline-block h-3 w-3 rounded-full bg-zinc-400 animate-pulse" />
            <span>
              Prepping for your meeting with {company} — reading {memoCount} past memo
              {memoCount === 1 ? "" : "s"}…
            </span>
          </div>
        )}
        {error && (
          <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        )}
        {brief && <BriefView company={company} memoCount={memoCount} brief={brief} />}
      </main>
    </div>
  );
}
