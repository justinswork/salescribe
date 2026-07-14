"use client";

// Customers screen: the canonical company profiles a memo's location resolves
// to. "Sync from memos" derives a customer per distinct company seen across the
// team's memos; each customer gets an editable address (the geocoding input we
// wire up next). Mirrors the team panel's shell + styling.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/lib/AuthContext";
import { authedFetch, apiError } from "@/lib/api";
import { loadMemos } from "@/lib/storage";
import {
  loadCustomers,
  upsertCustomer,
  deriveCustomersFromMemos,
  customerId,
} from "@/lib/customers";
import type { Customer, Memo } from "@/lib/schema";

export default function CustomersPage() {
  return (
    <AuthGuard>
      <CustomersPageContent />
    </AuthGuard>
  );
}

function CustomersPageContent() {
  const { org } = useAuth();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function refresh() {
    try {
      const [cs, ms] = await Promise.all([loadCustomers(), loadMemos()]);
      setCustomers(cs);
      setMemos(ms);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!org) return;
    void (async () => {
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  // Visits per customer — memos whose deal.company (the visited account) is this
  // customer. This is the eventual bubble size on the map.
  const memoCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of memos) {
      const company = m.extraction.deal?.company;
      if (!company) continue;
      counts.set(customerId(company), (counts.get(customerId(company)) ?? 0) + 1);
    }
    return counts;
  }, [memos]);

  function handleSync() {
    void (async () => {
      setSyncing(true);
      setNotice("");
      setError("");
      try {
        const { processed } = await deriveCustomersFromMemos(memos);
        await refresh();
        setNotice(`Synced ${processed} ${processed === 1 ? "customer" : "customers"} from memos.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSyncing(false);
      }
    })();
  }

  // Geocode every customer that has an address but no coordinates yet, one at a
  // time through /api/geocode (server holds the provider key). Already-located
  // customers are skipped so this is resumable. A hard failure (bad key, quota)
  // stops the batch rather than hammering the API.
  function handleGeocode() {
    const targets = customers.filter(
      (c) => c.address && c.address.trim() && !(c.lat != null && c.lng != null),
    );
    if (targets.length === 0) {
      setNotice("Every customer with an address is already located.");
      return;
    }
    void (async () => {
      setGeoBusy(true);
      setError("");
      setNotice("");
      let okCount = 0;
      let noneCount = 0;
      try {
        for (let i = 0; i < targets.length; i++) {
          const c = targets[i];
          setNotice(`Geocoding ${i + 1}/${targets.length}…`);
          const r = await authedFetch("/api/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: c.address }),
          });
          if (!r.ok) throw new Error(await apiError(r, "Geocoding failed"));
          const data = (await r.json()) as {
            status: "ok" | "none";
            lat?: number;
            lng?: number;
            formattedAddress?: string | null;
            provider?: string;
          };
          const at = new Date().toISOString();
          if (data.status === "ok" && data.lat != null && data.lng != null) {
            const updated = await upsertCustomer({
              id: c.id,
              name: c.name,
              lat: data.lat,
              lng: data.lng,
              geocode: {
                status: "ok",
                formattedAddress: data.formattedAddress ?? undefined,
                provider: data.provider,
                query: c.address ?? undefined,
                at,
              },
            });
            handleSaved(updated);
            okCount += 1;
          } else {
            const updated = await upsertCustomer({
              id: c.id,
              name: c.name,
              geocode: { status: "none", provider: data.provider, query: c.address ?? undefined, at },
            });
            handleSaved(updated);
            noneCount += 1;
          }
        }
        setNotice(
          `Geocoded ${okCount} customer${okCount === 1 ? "" : "s"}` +
            `${noneCount ? `, ${noneCount} address${noneCount === 1 ? "" : "es"} had no match` : ""}.`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setGeoBusy(false);
      }
    })();
  }

  // Apply a saved address to local state so the row updates without a full reload.
  function handleSaved(updated: Customer) {
    setCustomers((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  const located = customers.filter((c) => c.lat != null && c.lng != null).length;
  const withAddress = customers.filter((c) => c.address && c.address.trim()).length;
  const geocodable = customers.filter(
    (c) => c.address && c.address.trim() && !(c.lat != null && c.lng != null),
  ).length;

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
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Customers</h1>
          <Link
            href="/"
            className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ← Back to home
          </Link>
        </div>

        {error && (
          <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {/* Sync + summary */}
        <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
                Company profiles
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                One record per company your team visits, built from the companies on your memos. Add a street
                address to each — that&apos;s what we&apos;ll geocode (once per customer) to place it on the map.
              </p>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing || geoBusy || loading}
                className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {syncing ? "Syncing…" : "Sync from memos"}
              </button>
              <button
                type="button"
                onClick={handleGeocode}
                disabled={geoBusy || syncing || loading || geocodable === 0}
                className="rounded border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
              >
                {geoBusy ? "Geocoding…" : geocodable > 0 ? `Geocode ${geocodable}` : "All geocoded"}
              </button>
            </div>
          </div>
          {notice && <div className="mt-3 text-sm text-green-700 dark:text-green-400">{notice}</div>}
          {!loading && customers.length > 0 && (
            <div className="mt-3 flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{customers.length} total</span>
              <span>{withAddress} with address</span>
              <span>{located} located</span>
            </div>
          )}
        </section>

        {/* Customer list */}
        <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
          {loading ? (
            <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">Loading…</div>
          ) : customers.length === 0 ? (
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              No customers yet. Click <span className="font-medium">Sync from memos</span> to create one for each
              company your team has recorded a note about.
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
              {customers.map((c) => (
                <CustomerRow
                  key={c.id}
                  customer={c}
                  memoCount={memoCounts.get(c.id) ?? 0}
                  onSaved={handleSaved}
                  onError={setError}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function CustomerRow({
  customer,
  memoCount,
  onSaved,
  onError,
}: {
  customer: Customer;
  memoCount: number;
  onSaved: (c: Customer) => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState(customer.address ?? "");
  const [saving, setSaving] = useState(false);

  const stored = customer.address ?? "";
  const dirty = draft.trim() !== stored.trim();
  const located = customer.lat != null && customer.lng != null;

  function handleSave() {
    void (async () => {
      setSaving(true);
      onError("");
      try {
        const updated = await upsertCustomer({
          id: customer.id,
          name: customer.name,
          address: draft.trim() || null,
        });
        onSaved(updated);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="sm:w-56 min-w-0">
        <Link
          href={`/customers/${customer.id}`}
          className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate hover:underline block"
        >
          {customer.name}
        </Link>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {memoCount} {memoCount === 1 ? "memo" : "memos"}
          </span>
          {located ? (
            <span className="rounded-full bg-green-100 dark:bg-green-950/40 px-2 py-0.5 text-[10px] font-semibold text-green-800 dark:text-green-300 uppercase tracking-wide">
              Located
            </span>
          ) : stored ? (
            <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Not geocoded
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
              No address
            </span>
          )}
        </div>
      </div>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Street address, city, state"
        className="flex-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !dirty}
        className="shrink-0 rounded border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </li>
  );
}
