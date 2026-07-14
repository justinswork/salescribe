"use client";

// Customer (account) detail: the profile a memo links to. Shows the logo,
// address, notes, contacts derived from the account's memos, and the list of
// visits. Address/notes/logo are editable in place (any member). The customer
// record is created lazily from its memos if it doesn't exist yet (e.g. imported
// memos that were never synced).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/lib/AuthContext";
import { loadMemos } from "@/lib/storage";
import {
  getCustomer,
  upsertCustomer,
  uploadCustomerLogo,
  renameCustomer,
  memosForCustomer,
  contactsForCustomer,
  type CustomerContact,
} from "@/lib/customers";
import type { Customer, Memo } from "@/lib/schema";

export default function CustomerPage() {
  return (
    <AuthGuard>
      <CustomerPageContent />
    </AuthGuard>
  );
}

// Most frequent company spelling across the visits — used to name a customer
// record we're creating lazily.
function canonicalName(visits: Memo[]): string {
  const counts = new Map<string, number>();
  for (const m of visits) {
    const n = m.extraction.deal?.company?.trim();
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

function CustomerPageContent() {
  const { org } = useAuth();
  const id = String(useParams().id ?? "");

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [c, ms] = await Promise.all([getCustomer(id), loadMemos()]);
        if (cancelled) return;
        setMemos(ms);
        if (c) {
          setCustomer(c);
        } else {
          // No record yet — derive one from its memos so the page (and the
          // memo's "View customer" link) always resolves.
          const visits = memosForCustomer(ms, id);
          if (visits.length) {
            const created = await upsertCustomer({ id, name: canonicalName(visits) });
            if (!cancelled) setCustomer(created);
          } else {
            setError("This customer doesn't exist, or has no memos yet.");
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id, id]);

  const visits = useMemo(() => memosForCustomer(memos, id), [memos, id]);
  const contacts = useMemo(() => contactsForCustomer(memos, id), [memos, id]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-3xl px-6 py-5 flex items-center justify-between">
          <Link href="/" className="inline-flex items-baseline rounded hover:opacity-80" aria-label="Go to home">
            <span className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Salescribe
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <Link
            href="/customers"
            className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ← All customers
          </Link>
        </div>

        {error && (
          <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">Loading…</div>
        ) : customer ? (
          <>
            <CustomerHeaderCard customer={customer} onSaved={setCustomer} onError={setError} visitCount={visits.length} />
            <ProfileCard customer={customer} onSaved={setCustomer} onError={setError} />
            <ContactsCard contacts={contacts} />
            <VisitsCard visits={visits} />
          </>
        ) : null}
      </main>
    </div>
  );
}

function CustomerHeaderCard({
  customer,
  onSaved,
  onError,
  visitCount,
}: {
  customer: Customer;
  onSaved: (c: Customer) => void;
  onError: (m: string) => void;
  visitCount: number;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(customer.name);
  const [savingName, setSavingName] = useState(false);

  function saveName() {
    const n = nameDraft.trim();
    if (!n) return;
    void (async () => {
      setSavingName(true);
      onError("");
      try {
        onSaved(await renameCustomer(customer.id, n));
        setEditingName(false);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingName(false);
      }
    })();
  }

  function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      onError("That logo is over 3 MB — pick a smaller one.");
      return;
    }
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    void (async () => {
      setUploading(true);
      onError("");
      try {
        const url = await uploadCustomerLogo(customer.id, file, ext);
        onSaved(await upsertCustomer({ id: customer.id, name: customer.name, logoUrl: url }));
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    })();
  }

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Upload logo"
          className="relative h-16 w-16 shrink-0 rounded border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white flex items-center justify-center hover:opacity-80 disabled:opacity-50"
        >
          {customer.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={customer.logoUrl} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="text-2xl font-semibold text-zinc-300 dark:text-zinc-600">
              {customer.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickLogo} />
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="min-w-0 flex-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={saveName}
                disabled={savingName || !nameDraft.trim()}
                className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
              >
                {savingName ? "Saving…" : "OK"}
              </button>
              <button
                type="button"
                onClick={() => setEditingName(false)}
                disabled={savingName}
                className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 truncate">
                {customer.name}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(customer.name);
                  setEditingName(true);
                }}
                className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                Edit
              </button>
            </div>
          )}
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {visitCount} {visitCount === 1 ? "visit" : "visits"}
            {customer.lat != null && customer.lng != null ? " · located" : ""}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="mt-1 text-xs text-blue-600 hover:underline disabled:opacity-50"
          >
            {uploading ? "Uploading…" : customer.logoUrl ? "Change logo" : "Add logo"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ProfileCard({
  customer,
  onSaved,
  onError,
}: {
  customer: Customer;
  onSaved: (c: Customer) => void;
  onError: (m: string) => void;
}) {
  const [address, setAddress] = useState(customer.address ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = address.trim() !== (customer.address ?? "").trim() || notes.trim() !== (customer.notes ?? "").trim();

  function handleSave() {
    void (async () => {
      setSaving(true);
      onError("");
      try {
        onSaved(
          await upsertCustomer({
            id: customer.id,
            name: customer.name,
            address: address.trim() || null,
            notes: notes.trim() || null,
          }),
        );
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Address</span>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Street address, city, state"
          className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Anything worth knowing about this account…"
          className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
        />
      </label>
      <div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

function ContactsCard({ contacts }: { contacts: CustomerContact[] }) {
  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
        Contacts
        <span className="ml-2 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-normal text-zinc-700 dark:text-zinc-300">
          {contacts.length}
        </span>
      </h2>
      {contacts.length === 0 ? (
        <p className="text-sm italic text-zinc-400 dark:text-zinc-500">
          No contacts mentioned in this account&apos;s memos yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {contacts.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{c.name}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {[c.role, c.company].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {c.memoSeqs.slice(0, 3).map((seq) => (
                  <Link
                    key={seq}
                    href={`/memos/${seq}`}
                    className="font-mono text-[11px] text-blue-600 hover:underline"
                  >
                    #{seq}
                  </Link>
                ))}
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {c.count} {c.count === 1 ? "mention" : "mentions"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function VisitsCard({ visits }: { visits: Memo[] }) {
  const ordered = [...visits].sort((a, b) => b.created_iso.localeCompare(a.created_iso));
  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
        Visits
        <span className="ml-2 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-normal text-zinc-700 dark:text-zinc-300">
          {ordered.length}
        </span>
      </h2>
      {ordered.length === 0 ? (
        <p className="text-sm italic text-zinc-400 dark:text-zinc-500">No memos for this account yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((m) => (
            <li key={m.id}>
              <Link
                href={`/memos/${m.seq ?? m.id}`}
                className="block rounded border border-zinc-200 dark:border-zinc-800 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-zinc-900 dark:text-zinc-100 line-clamp-1">
                    {m.extraction.summary || "(no summary)"}
                  </span>
                  <span className="shrink-0 flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                    {typeof m.seq === "number" && <span className="font-mono">#{m.seq}</span>}
                    <span>{new Date(m.created_iso).toLocaleDateString()}</span>
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
