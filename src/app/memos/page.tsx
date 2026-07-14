"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import HandsFreeToggle from "@/components/HandsFreeToggle";
import Avatar from "@/components/Avatar";
import VisibilityPill from "@/components/VisibilityPill";
import { useAuth } from "@/lib/AuthContext";
import { loadMemos } from "@/lib/storage";
import { parseQuery, matchMemo, type SearchField, type SearchOp } from "@/lib/search";
import type { Memo } from "@/lib/schema";

type FilterRow = { field: SearchField; op: SearchOp; value: string };

// Serialize builder rows into the query string that drives filtering and
// highlighting: `field:value` for contains, `field=value` for exact, quoting
// values with spaces.
function serializeRows(rows: FilterRow[]): string {
  return rows
    .filter((r) => r.value.trim())
    .map((r) => {
      const v = r.value.trim();
      const val = /\s/.test(v) ? `"${v}"` : v;
      if (r.field === "any") return val;
      return `${r.field}${r.op === "exact" ? "=" : ":"}${val}`;
    })
    .join(" ");
}

const PAGE_SIZE = 25;

export default function MemosPage() {
  return (
    <AuthGuard>
      <MemosPageContent />
    </AuthGuard>
  );
}

function MemosPageContent() {
  const { user, profile, roster } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const authorNameOf = (m: Memo) =>
    m.authorName || (m.authorUid ? roster[m.authorUid]?.displayName ?? "" : "");

  // URL is the source of truth for query + page so back/forward navigation and
  // sharing both work. The filter builder keeps local rows for snappy editing
  // and debounces URL updates (serialized to the `field:value` query string).
  const urlQuery = searchParams.get("q") ?? "";
  const urlPage = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const urlStart = searchParams.get("start") ?? ""; // YYYY-MM-DD
  const urlEnd = searchParams.get("end") ?? ""; // YYYY-MM-DD
  const urlAuthor = searchParams.get("author") ?? ""; // authorUid

  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  // Simple search (one box) vs. the advanced filter builder. Both edit the same
  // URL query; only the active one syncs to the URL.
  const [advanced, setAdvanced] = useState(false);
  const [simpleText, setSimpleText] = useState(urlQuery);
  // Advanced builder rows, seeded once from the URL (author lives in its own
  // dropdown, so it's filtered out of the text rows).
  const [rows, setRows] = useState<FilterRow[]>(() => {
    const parsed = parseQuery(urlQuery).filter((c) => c.field !== "author");
    return parsed.length ? parsed : [{ field: "any", op: "contains", value: "" }];
  });

  const setRow = (i: number, patch: Partial<FilterRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { field: "any", op: "contains", value: "" }]);
  const removeRow = (i: number) =>
    setRows((rs) => {
      const next = rs.filter((_, j) => j !== i);
      return next.length ? next : [{ field: "any", op: "contains", value: "" }];
    });

  // Enter the builder seeded from the current query; leave it back to a plain box.
  function openAdvanced() {
    const parsed = parseQuery(urlQuery).filter((c) => c.field !== "author");
    setRows(parsed.length ? parsed : [{ field: "any", op: "contains", value: "" }]);
    setAdvanced(true);
  }
  function closeAdvanced() {
    setSimpleText(urlQuery);
    setAdvanced(false);
  }
  function clearAll() {
    setRows([{ field: "any", op: "contains", value: "" }]);
    setSimpleText("");
    pushUrl({ q: "", start: "", end: "", author: "" });
  }

  // Count of active advanced filters (field conditions + date + salesperson),
  // shown on the Filters button so simple mode still signals hidden filters.
  const activeAdvanced =
    parseQuery(urlQuery).filter((c) => c.field !== "any").length +
    (urlStart ? 1 : 0) +
    (urlEnd ? 1 : 0) +
    (urlAuthor ? 1 : 0);

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
    overrides: { q?: string; start?: string; end?: string; author?: string; page?: number } = {},
    resetPage = true,
  ) {
    const params = new URLSearchParams();
    const q = overrides.q !== undefined ? overrides.q : urlQuery;
    const start = overrides.start !== undefined ? overrides.start : urlStart;
    const end = overrides.end !== undefined ? overrides.end : urlEnd;
    const author = overrides.author !== undefined ? overrides.author : urlAuthor;
    const nextPage = overrides.page !== undefined ? overrides.page : resetPage ? 1 : urlPage;
    if (q) params.set("q", q);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (author) params.set("author", author);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    router.replace(qs ? `/memos?${qs}` : "/memos", { scroll: false });
  }

  // Debounced sync to the URL (300ms). Only the active editor writes: the plain
  // box in simple mode, the builder rows in advanced mode.
  useEffect(() => {
    if (advanced || simpleText === urlQuery) return;
    const t = setTimeout(() => pushUrl({ q: simpleText }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simpleText, urlQuery, advanced]);

  useEffect(() => {
    if (!advanced) return;
    const q = serializeRows(rows);
    if (q === urlQuery) return;
    const t = setTimeout(() => pushUrl({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, urlQuery, advanced]);

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
    // Salesperson.
    if (urlAuthor) {
      result = result.filter((m) => m.authorUid === urlAuthor);
    }
    // Field-scoped text search (AND-ed conditions).
    const conditions = parseQuery(urlQuery);
    if (conditions.length) {
      result = result.filter((m) => matchMemo(m, conditions, authorNameOf(m)));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memos, urlQuery, urlStart, urlEnd, urlAuthor, roster]);

  const hasAnyFilter = Boolean(urlQuery || urlStart || urlEnd || urlAuthor);

  // Salespeople for the dropdown, from the org roster.
  const salespeople = Object.values(roster).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

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
          <HandsFreeToggle />
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );

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

        {!advanced ? (
          /* Simple mode: one search box + a Filters toggle. */
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={simpleText}
              onChange={(e) => setSimpleText(e.target.value)}
              placeholder="Search memos…"
              className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
            />
            <button
              type="button"
              onClick={openAdvanced}
              className="shrink-0 rounded border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              Filters{activeAdvanced > 0 ? ` (${activeAdvanced})` : ""}
            </button>
            {hasAnyFilter && (
              <button
                type="button"
                onClick={clearAll}
                className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                Clear
              </button>
            )}
          </div>
        ) : (
          /* Advanced mode: field/operator/value rows + date + salesperson. */
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Filters</span>
              <button
                type="button"
                onClick={closeAdvanced}
                className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                ← Simple search
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={row.field}
                    onChange={(e) => setRow(i, { field: e.target.value as SearchField })}
                    className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 shrink-0"
                  >
                    <option value="any">Any field</option>
                    <option value="company">Company</option>
                    <option value="contact">Contact</option>
                    <option value="summary">Summary</option>
                    <option value="transcript">Transcript</option>
                  </select>
                  {row.field === "any" ? (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0">contains</span>
                  ) : (
                    <select
                      value={row.op}
                      onChange={(e) => setRow(i, { op: e.target.value as SearchOp })}
                      className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 shrink-0"
                    >
                      <option value="contains">contains</option>
                      <option value="exact">is</option>
                    </select>
                  )}
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) => setRow(i, { value: e.target.value })}
                    placeholder={row.field === "any" ? "Search anything…" : `Search ${row.field}…`}
                    className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    aria-label="Remove filter"
                    className="shrink-0 px-1 text-zinc-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-3">
                <button type="button" onClick={addRow} className="text-xs text-blue-600 hover:underline">
                  + Add filter
                </button>
                {rows.filter((r) => r.value.trim()).length > 1 && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">All conditions must match</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-3 text-sm text-zinc-600 dark:text-zinc-400">
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
              <label className="flex items-center gap-1.5">
                <span className="text-xs uppercase tracking-wide">By</span>
                <select
                  value={urlAuthor}
                  onChange={(e) => pushUrl({ author: e.target.value })}
                  className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100"
                >
                  <option value="">All salespeople</option>
                  {salespeople.map((p) => (
                    <option key={p.uid} value={p.uid}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {hasAnyFilter && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

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
                  ? "No memos match your filters."
                  : `Showing ${startIdx + 1}–${startIdx + visible.length} of ${filtered.length}${hasAnyFilter ? " matching" : ""}.`}
              </div>
              <Pagination compact={true} />
            </div>

            {visible.length > 0 && (
              <ul className="flex flex-col gap-2">
                {visible.map((m) => (
                  <li
                    key={m.id}
                    className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 p-3"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {typeof m.seq === "number" && (
                          <span className="font-mono text-[11px] font-semibold text-zinc-400 dark:text-zinc-500">
                            #{m.seq}
                          </span>
                        )}
                        {m.is_demo && (
                          <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                            demo
                          </span>
                        )}
                        <VisibilityPill visibility={m.visibility} />
                      </div>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0">
                        {formatDate(m.created_iso)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            `/memos/${m.seq ?? m.id}${urlQuery ? `?q=${encodeURIComponent(urlQuery)}` : ""}`,
                          )
                        }
                        className="flex-1 min-w-0 text-left text-sm"
                      >
                        <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {memoLabel(m)}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
                          {m.extraction.summary}
                        </div>
                      </button>
                      {(() => {
                        const mine = Boolean(m.authorUid && m.authorUid === user?.uid);
                        const member = m.authorUid ? roster[m.authorUid] : undefined;
                        const authorName = m.authorName || member?.displayName || "Teammate";
                        return (
                          <Avatar
                            size={36}
                            name={authorName}
                            seed={m.authorUid || authorName}
                            label={mine ? "You" : authorName}
                            photoURL={(mine ? user?.photoURL : member?.photoURL) || undefined}
                            color={(mine ? profile?.avatarColor : member?.avatarColor) || undefined}
                          />
                        );
                      })()}
                    </div>
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
