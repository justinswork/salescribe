"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { clearDemoData, hasDemoData, loadDemoData } from "@/lib/storage";

export default function AccountMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  // null = haven't checked yet (treat as "still loading" in UI).
  // true/false = current state of demo data in the signed-in user's account.
  const [hasDemo, setHasDemo] = useState<boolean | null>(null);

  // Re-query each time the menu opens. Cheap (one indexed Firestore read) and
  // ensures the load/clear buttons reflect current state even after
  // operations that happen outside this component.
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setHasDemo(null);
    hasDemoData()
      .then((exists) => {
        if (!cancelled) setHasDemo(exists);
      })
      .catch(() => {
        // If the check fails, fall back to "unknown" → buttons stay enabled
        // so the user isn't blocked by a transient error.
        if (!cancelled) setHasDemo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  if (!user) return null;

  const initials = (user.displayName || user.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleLoadDemo() {
    const ok = window.confirm(
      "Load fictional demo memos into your account?\n\n" +
        "This adds a year of synthetic sales memos about a fictional salesperson, " +
        "so you can try out features like cross-document briefings without recording " +
        "30 memos yourself. They show up in your Recent Memos list and are clearly " +
        "marked as demo data.\n\n" +
        "You can remove them anytime via Clear demo data.",
    );
    if (!ok) return;
    setOpen(false);
    setDemoBusy(true);
    try {
      await loadDemoData();
      // The reload IS the feedback — the user will see the new memos appear
      // immediately. Showing a success alert here would block the reload
      // until the user clicked it, making "Reloading…" a lie.
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(`Could not load demo data:\n${msg}`);
      setDemoBusy(false);
    }
  }

  async function handleClearDemo() {
    const ok = window.confirm(
      "Remove all demo memos from your account?\n\n" +
        "This only deletes memos flagged as demo data. Memos you dictated yourself are not affected.",
    );
    if (!ok) return;
    setOpen(false);
    setDemoBusy(true);
    try {
      await clearDemoData();
      window.location.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(`Could not clear demo data:\n${msg}`);
      setDemoBusy(false);
    }
  }

  return (
    <div className="relative">
      {demoBusy && (
        // Full-screen overlay during demo-data writes. The actual operation
        // takes ~3-5 seconds (one static-asset fetch + one Firestore batch
        // commit + page reload), but without this the user sees zero feedback
        // between clicking OK and the page reloading, which feels broken.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg px-6 py-5 flex items-center gap-3 text-sm text-zinc-900 dark:text-zinc-100"
          >
            <span className="inline-block h-3 w-3 rounded-full bg-blue-600 animate-pulse" />
            <span>Updating your memo collection…</span>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 py-1"
        aria-label="Account menu"
      >
        {user.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.photoURL}
            alt=""
            width={28}
            height={28}
            className="rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-white text-xs dark:bg-zinc-100 dark:text-zinc-900">
            {initials}
          </span>
        )}
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          />
          <div className="absolute right-0 mt-2 w-64 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg z-20 py-1 text-sm">
            <div className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
              <div className="font-medium truncate">{user.displayName || "Signed in"}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{user.email}</div>
            </div>
            <div className="border-t border-zinc-200 dark:border-zinc-800" />
            <button
              type="button"
              onClick={handleLoadDemo}
              disabled={demoBusy || hasDemo === true || hasDemo === null}
              title={
                hasDemo === true
                  ? "Demo data is already loaded — clear it first to reload"
                  : hasDemo === null
                    ? "Checking…"
                    : undefined
              }
              className="block w-full text-left px-3 py-2 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            >
              Load demo data
              {hasDemo === true && (
                <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">(already loaded)</span>
              )}
            </button>
            <button
              type="button"
              onClick={handleClearDemo}
              disabled={demoBusy || hasDemo === false || hasDemo === null}
              title={
                hasDemo === false
                  ? "No demo data to clear"
                  : hasDemo === null
                    ? "Checking…"
                    : undefined
              }
              className="block w-full text-left px-3 py-2 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            >
              Clear demo data
              {hasDemo === false && (
                <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">(none loaded)</span>
              )}
            </button>
            <div className="border-t border-zinc-200 dark:border-zinc-800" />
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await signOut();
              }}
              className="block w-full text-left px-3 py-2 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
