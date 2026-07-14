"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ExtractionView from "@/components/ExtractionView";
import Avatar from "@/components/Avatar";
import CustomerAvatar from "@/components/CustomerAvatar";
import Highlight from "@/components/Highlight";
import VisibilityPill from "@/components/VisibilityPill";
import MemoEditor from "@/components/MemoEditor";
import MemoHistoryView, { ago } from "@/components/MemoHistoryView";
import { useAuth } from "@/lib/AuthContext";
import { getMemoAudioUrl, updateMemo, deleteMemo, loadMemos } from "@/lib/storage";
import { getCustomerByCompany, customerId } from "@/lib/customers";
import { authedFetch, apiError } from "@/lib/api";
import type { Customer, Extraction, Memo } from "@/lib/schema";

function memoLabel(m: Memo): string {
  return (
    m.extraction.deal?.company ||
    m.extraction.contacts[0]?.company ||
    m.extraction.contacts[0]?.name ||
    m.extraction.summary.slice(0, 50) ||
    "(untitled)"
  );
}

type Deal = NonNullable<Extraction["deal"]>;
const EMPTY_DEAL: Deal = {
  company: null,
  prospect_name: null,
  stated_problem: null,
  budget_signals: null,
  decision_makers: null,
  objections: null,
  competitors: null,
  next_step: null,
  next_step_due_iso: null,
};

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
  highlight = [],
}: {
  memo: Memo;
  onUpdated?: (m: Memo) => void;
  // Search terms to keep highlighted in the memo's content.
  highlight?: string[];
}) {
  const { user, org, orgGrounding, roster } = useAuth();
  const router = useRouter();
  const authorMember = memo.authorUid ? roster[memo.authorUid] : undefined;

  const company = memo.extraction.deal?.company?.trim() || "";
  const [customer, setCustomer] = useState<Customer | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!company) {
        if (!cancelled) setCustomer(null);
        return;
      }
      try {
        const c = await getCustomerByCompany(company);
        if (!cancelled) setCustomer(c);
      } catch {
        if (!cancelled) setCustomer(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [company]);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"details" | "history">("details");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [reextracting, setReextracting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [companyEditing, setCompanyEditing] = useState(false);
  const [companyDraft, setCompanyDraft] = useState("");
  const [savingCompany, setSavingCompany] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState<Memo[] | null>(null);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);

  // Resolve a playable URL for the original recording, if this memo has one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!memo.audioPath) {
        if (!cancelled) setAudioUrl(null);
        return;
      }
      try {
        const url = await getMemoAudioUrl(memo.audioPath);
        if (!cancelled) setAudioUrl(url);
      } catch {
        if (!cancelled) setAudioUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memo.audioPath]);

  const isAuthor = Boolean(memo.authorUid && user?.uid && memo.authorUid === user.uid);
  const canEdit =
    isAuthor || (org?.role === "admin" && (memo.visibility ?? "shared") === "shared");

  function handleReextract() {
    if (!onUpdated) return;
    if (
      !confirm(
        "Re-run extraction from the transcript? This regenerates the structured fields (summary, contacts, events, reminders, deal), but keeps the Company you set.",
      )
    ) {
      return;
    }
    setTab("details"); // so the fields visibly clear and regenerate
    void (async () => {
      setReextracting(true);
      setActionError("");
      try {
        const r = await authedFetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: memo.transcript,
            chat: [],
            reference_now_iso: memo.created_iso,
            org_context: orgGrounding?.extractContext ?? undefined,
          }),
        });
        if (!r.ok) throw new Error(await apiError(r, "Re-extraction failed"));
        const data = (await r.json()) as { extraction: Extraction };
        // Company is a user-curated field (it groups memos and may not appear
        // in the transcript), so preserve a previously set company rather than
        // let re-extraction clear or overwrite it. Only adopt an extracted
        // company when none was set.
        const prevCompany = memo.extraction.deal?.company ?? null;
        const next = data.extraction;
        const deal: Deal | null = next.deal
          ? { ...next.deal, company: prevCompany ?? next.deal.company }
          : prevCompany
            ? { ...EMPTY_DEAL, company: prevCompany }
            : null;
        const saved = await updateMemo(memo, { ...memo, extraction: { ...next, deal } });
        onUpdated(saved);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setReextracting(false);
      }
    })();
  }

  // Quick inline overwrite of just the company (the memo's identity — it drives
  // the list label and meeting-prep grouping). Writes through updateMemo so the
  // change lands in revision history like any other edit.
  function saveCompany() {
    if (!onUpdated) return;
    void (async () => {
      setSavingCompany(true);
      setActionError("");
      try {
        const base = memo.extraction.deal ?? EMPTY_DEAL;
        const updated: Memo = {
          ...memo,
          extraction: {
            ...memo.extraction,
            deal: { ...base, company: companyDraft.trim() || null },
          },
        };
        const saved = await updateMemo(memo, updated);
        onUpdated(saved);
        setCompanyEditing(false);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingCompany(false);
      }
    })();
  }

  // Merge this memo into another (for afterthought/second-clip recordings that
  // landed as their own memo). Appends this transcript to the target, keeps the
  // target's audio + fields, then deletes this one and navigates to the target.
  // Stopgap until memos support multiple audio recordings.
  function openMerge() {
    setMergeOpen(true);
    setActionError("");
    if (mergeCandidates === null) {
      loadMemos()
        .then((all) => setMergeCandidates(all.filter((m) => m.id !== memo.id)))
        .catch((e) => setActionError(e instanceof Error ? e.message : String(e)));
    }
  }

  function performMerge(target: Memo) {
    void (async () => {
      setMergeBusy(true);
      setActionError("");
      try {
        const when = new Date(memo.created_iso).toLocaleString();
        const combined =
          `${target.transcript.trim()}\n\n` +
          `— Merged from memo #${memo.seq ?? memo.id} (recorded ${when}) —\n` +
          memo.transcript.trim();
        await updateMemo(target, { ...target, transcript: combined });
        await deleteMemo(memo.id);
        // Target keeps its own structured fields; the merged-in transcript is
        // available to re-extract from if the user wants it folded in.
        router.push(`/memos/${target.seq ?? target.id}`);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
        setMergeBusy(false);
      }
    })();
  }

  const mergeMatches = (mergeCandidates ?? []).filter((m) => {
    const q = mergeQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      memoLabel(m).toLowerCase().includes(q) ||
      (m.seq != null && `#${m.seq}`.includes(q)) ||
      m.extraction.summary.toLowerCase().includes(q)
    );
  });

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
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <Avatar
                  size={20}
                  name={memo.authorName}
                  seed={memo.authorUid || memo.authorName}
                  photoURL={authorMember?.photoURL}
                  color={authorMember?.avatarColor}
                />
                {memo.authorName}
              </span>
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
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleReextract}
              disabled={reextracting}
              className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
              title="Regenerate the structured fields from the transcript"
            >
              {reextracting ? "Re-extracting…" : "Re-extract"}
            </button>
            <button
              type="button"
              onClick={openMerge}
              className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              title="Merge this memo's recording into another memo"
            >
              Merge into…
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              Edit
            </button>
          </div>
        )}
      </div>
      {actionError && (
        <div className="text-sm text-red-600 dark:text-red-400 break-words">{actionError}</div>
      )}

      {/* Customer — the memo's account: editable company name + logo/address,
          and a link to the full customer profile. */}
      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
        <div className="flex items-center gap-3">
          {company && (
            <CustomerAvatar
              name={customer?.name || company}
              logoUrl={customer?.logoUrl}
              seed={customer?.id || customerId(company)}
              size={40}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
              Customer
            </div>
            {companyEditing ? (
              <input
                type="text"
                autoFocus
                value={companyDraft}
                onChange={(e) => setCompanyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCompany();
                  if (e.key === "Escape") setCompanyEditing(false);
                }}
                placeholder="Company name"
                className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
              />
            ) : (
              <>
                <div className="text-base font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {memo.extraction.deal?.company || (
                    <span className="italic font-normal text-zinc-400 dark:text-zinc-500">No company set</span>
                  )}
                </div>
                {customer?.address && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{customer.address}</div>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {canEdit && onUpdated && (
              companyEditing ? (
                <>
                  <button
                    type="button"
                    onClick={saveCompany}
                    disabled={savingCompany}
                    className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
                  >
                    {savingCompany ? "Saving…" : "OK"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompanyEditing(false)}
                    disabled={savingCompany}
                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCompanyDraft(memo.extraction.deal?.company ?? "");
                    setCompanyEditing(true);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  Edit
                </button>
              )
            )}
            {company && !companyEditing && (
              <Link
                href={`/customers/${customerId(company)}`}
                className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                View customer →
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Merge picker */}
      {mergeOpen && (
        <section className="rounded-lg border border-blue-300 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Merge this memo into another
            </h3>
            <button
              type="button"
              onClick={() => setMergeOpen(false)}
              disabled={mergeBusy}
              className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
            Pick the memo to keep. This memo&apos;s transcript is appended to it, then this memo (#{memo.seq ?? "?"}) is deleted. The kept memo&apos;s audio and fields stay; re-extract it afterward if you want the merged details folded in.
          </p>
          <input
            type="search"
            value={mergeQuery}
            onChange={(e) => setMergeQuery(e.target.value)}
            placeholder="Search memos by company, #, or summary…"
            className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 mb-3"
          />
          {mergeCandidates === null ? (
            <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">Loading memos…</div>
          ) : mergeMatches.length === 0 ? (
            <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">No other memos match.</div>
          ) : (
            <ul className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
              {mergeMatches.slice(0, 50).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={mergeBusy}
                    onClick={() => {
                      if (
                        confirm(
                          `Merge memo #${memo.seq ?? memo.id} into "${memoLabel(m)}" (#${m.seq ?? "?"})? This deletes memo #${memo.seq ?? memo.id}.`,
                        )
                      ) {
                        performMerge(m);
                      }
                    }}
                    className="w-full flex items-center justify-between gap-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex items-center gap-2">
                      {typeof m.seq === "number" && (
                        <span className="font-mono text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 shrink-0">
                          #{m.seq}
                        </span>
                      )}
                      <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {memoLabel(m)}
                      </span>
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0 tabular-nums">
                      {new Date(m.created_iso).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mergeBusy && (
            <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Merging…</div>
          )}
        </section>
      )}

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
          {audioUrl && (
            <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
                Recording
              </h2>
              <audio controls src={audioUrl} className="w-full" />
            </section>
          )}
          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
              Transcript
            </h2>
            <p className="text-sm whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
              <Highlight text={memo.transcript} terms={highlight} />
            </p>
          </section>

          {reextracting ? (
            <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
              <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                <span className="inline-block h-3 w-3 rounded-full bg-zinc-400 animate-pulse" />
                <span>Re-extracting from the transcript…</span>
              </div>
            </section>
          ) : (
            <ExtractionView extraction={memo.extraction} highlight={highlight} />
          )}

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
