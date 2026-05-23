"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import HandsFreeToggle from "@/components/HandsFreeToggle";
import MemoDetailView from "@/components/MemoDetailView";
import { useAuth } from "@/lib/AuthContext";
import { loadMemos } from "@/lib/storage";
import type { Memo } from "@/lib/schema";

const PAGE_SIZE = 25;

export default function MemosPage() {
  return (
    <AuthGuard>
      <MemosPageContent />
    </AuthGuard>
  );
}

function MemosPageContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL is the source of truth for query + page so back/forward navigation and
  // sharing both work. The text input keeps a local mirror for snappy typing
  // and debounces URL updates.
  const urlQuery = searchParams.get("q") ?? "";
  const urlPage = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const urlStart = searchParams.get("start") ?? ""; // YYYY-MM-DD
  const urlEnd = searchParams.get("end") ?? ""; // YYYY-MM-DD

  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMemo, setSelectedMemo] = useState<Memo | null>(null);
  const [inputValue, setInputValue] = useState(urlQuery);

  // Load memos when the signed-in user is known.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    loadMemos()
      .then((m) => {
        if (!cancelled) {
          setMemos(m);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Builds a URL with all current filters, optionally overriding any of them.
  // Page resets to 1 when filters change (the previous page index isn't
  // meaningful for a different filtered list); page nav passes resetPage=false.
  function pushUrl(
    overrides: { q?: string; start?: string; end?: string; page?: number } = {},
    resetPage = true,
  ) {
    const params = new URLSearchParams();
    const q = overrides.q !== undefined ? overrides.q : urlQuery;
    const start = overrides.start !== undefined ? overrides.start : urlStart;
    const end = overrides.end !== undefined ? overrides.end : urlEnd;
    const nextPage = overrides.page !== undefined ? overrides.page : resetPage ? 1 : urlPage;
    if (q) params.set("q", q);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    router.replace(qs ? `/memos?${qs}` : "/memos", { scroll: false });
  }

  // Debounced sync: when the user types in the search box, push to URL after
  // 300ms of no further typing. Resets to page 1.
  useEffect(() => {
    if (inputValue === urlQuery) return;
    const t = setTimeout(() => {
      pushUrl({ q: inputValue });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, urlQuery]);

  // If the URL's query changes externally (e.g., user hits back), sync the input.
  useEffect(() => {
    setInputValue(urlQuery);
  }, [urlQuery]);

  const filtered = useMemo(() => {
    let result = memos;
    // Date range. ISO 8601 strings compare correctly lexicographically, so
    // the date prefix of created_iso (YYYY-MM-DD...) can be compared against
    // the date-input value directly. End is inclusive of the full end day.
    if (urlStart) {
      result = result.filter((m) => m.created_iso >= urlStart);
    }
    if (urlEnd) {
      const endInclusive = `${urlEnd}T23:59:59.999Z`;
      result = result.filter((m) => m.created_iso <= endInclusive);
    }
    // Text search.
    if (urlQuery.trim()) {
      const q = urlQuery.toLowerCase();
      result = result.filter((m) => {
        const haystack = [
          m.extraction.deal?.company,
          m.extraction.deal?.prospect_name,
          m.extraction.deal?.stated_problem,
          m.extraction.deal?.next_step,
          ...m.extraction.contacts.flatMap((c) => [c.name, c.company, c.role]),
          m.extraction.summary,
          m.transcript,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    return result;
  }, [memos, urlQuery, urlStart, urlEnd]);

  const hasAnyFilter = Boolean(urlQuery || urlStart || urlEnd);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(urlPage, totalPages);
  const startIdx = (page - 1) * PAGE_SIZE;
  const visible = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  function navigateToPage(newPage: number) {
    pushUrl({ page: newPage }, false);
  }

  // Two pagination variants. The compact one renders above the list (small
  // icon buttons + page indicator); the full one renders below (labelled
  // Prev/Next buttons with more breathing room).
  function Pagination({ compact }: { compact: boolean }) {
    if (totalPages <= 1) return null;
    const btnBase =
      "text-zinc-700 dark:text-zinc-200 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";
    if (compact) {
      return (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => navigateToPage(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
            className={`${btnBase} px-2 py-0.5 text-sm`}
          >
            ←
          </button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => navigateToPage(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
            className={`${btnBase} px-2 py-0.5 text-sm`}
          >
            →
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 pt-3">
        <button
          type="button"
          onClick={() => navigateToPage(page - 1)}
          disabled={page === 1}
          className={`${btnBase} px-3 py-1.5 text-sm`}
        >
          ← Prev
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => navigateToPage(page + 1)}
          disabled={page === totalPages}
          className={`${btnBase} px-3 py-1.5 text-sm`}
        >
          Next →
        </button>
      </div>
    );
  }

  function memoLabel(m: Memo): string {
    const company = m.extraction.deal?.company || m.extraction.contacts[0]?.company;
    if (company) return company;
    if (m.extraction.contacts[0]?.name) return m.extraction.contacts[0].name;
    return m.extraction.summary.slice(0, 60) + (m.extraction.summary.length > 60 ? "…" : "");
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  const header = (
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
          <span
            className="ml-3 align-middle text-xs font-mono font-normal text-zinc-400 dark:text-zinc-500"
            title={`commit ${process.env.NEXT_PUBLIC_GIT_SHA}`}
          >
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {selectedMemo && (
            <button
              type="button"
              onClick={() => setSelectedMemo(null)}
              className="text-sm text-zinc-500 dark:text-zinc-400 underline mr-2"
            >
              ← Back to list
            </button>
          )}
          <HandsFreeToggle />
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );

  if (selectedMemo) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        {header}
        <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
          <MemoDetailView memo={selectedMemo} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {header}
      <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            All memos
          </h1>
          <Link
            href="/"
            className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ← Back to home
          </Link>
        </div>

        <input
          type="search"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Search by company, contact, summary, or transcript…"
          className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
        />

        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <label className="flex items-center gap-1.5">
            <span className="text-xs uppercase tracking-wide">From</span>
            <input
              type="date"
              value={urlStart}
              max={urlEnd || undefined}
              onChange={(e) => pushUrl({ start: e.target.value })}
              className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-xs uppercase tracking-wide">To</span>
            <input
              type="date"
              value={urlEnd}
              min={urlStart || undefined}
              onChange={(e) => pushUrl({ end: e.target.value })}
              className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </label>
          {hasAnyFilter && (
            <button
              type="button"
              onClick={() => {
                setInputValue("");
                pushUrl({ q: "", start: "", end: "" });
              }}
              className="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Clear filters
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">Loading…</div>
        ) : memos.length === 0 ? (
          <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">
            No memos yet. Record one from the home page, or load demo data via the account menu.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {filtered.length === 0
                  ? `No matches for "${urlQuery}".`
                  : `Showing ${startIdx + 1}–${startIdx + visible.length} of ${filtered.length}${urlQuery ? ` matching "${urlQuery}"` : ""}.`}
              </div>
              <Pagination compact={true} />
            </div>

            {visible.length > 0 && (
              <ul className="flex flex-col gap-2">
                {visible.map((m) => (
                  <li
                    key={m.id}
                    className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedMemo(m)}
                      className="w-full flex items-start justify-between gap-3 p-3 text-left text-sm"
                    >
                      <div className="flex-1 min-w-0">
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
                      </div>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0">
                        {formatDate(m.created_iso)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Pagination compact={false} />
          </>
        )}
      </main>
    </div>
  );
}
