"use client";

import { useState } from "react";
import { updateMemo } from "@/lib/storage";
import type { Extraction, Memo } from "@/lib/schema";

type Deal = NonNullable<Extraction["deal"]>;
type Contact = Extraction["contacts"][number];
type CalEvent = Extraction["calendar_events"][number];
type Reminder = Extraction["reminders"][number];

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

const DEAL_FIELDS: Array<{ key: keyof Deal; label: string }> = [
  { key: "company", label: "Company" },
  { key: "prospect_name", label: "Prospect name" },
  { key: "stated_problem", label: "Stated problem" },
  { key: "budget_signals", label: "Budget signals" },
  { key: "decision_makers", label: "Decision makers" },
  { key: "objections", label: "Objections" },
  { key: "competitors", label: "Competitors" },
  { key: "next_step", label: "Next step" },
  { key: "next_step_due_iso", label: "Next step due (ISO date)" },
];

const inputCls =
  "w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400";
const labelCls = "text-xs font-medium text-zinc-500 dark:text-zinc-400";

// Empty string → null, for the schema's nullable fields.
function nn(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

export default function MemoEditor({
  memo,
  onUpdated,
  onCancel,
}: {
  memo: Memo;
  onUpdated: (m: Memo) => void;
  onCancel: () => void;
}) {
  const [transcript, setTranscript] = useState(memo.transcript);
  const [summary, setSummary] = useState(memo.extraction.summary);
  const [deal, setDeal] = useState<Deal | null>(memo.extraction.deal);
  const [contacts, setContacts] = useState<Contact[]>(memo.extraction.contacts);
  const [events, setEvents] = useState<CalEvent[]>(memo.extraction.calendar_events);
  const [reminders, setReminders] = useState<Reminder[]>(memo.extraction.reminders);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function setDealField(key: keyof Deal, value: string) {
    setDeal((d) => ({ ...(d ?? EMPTY_DEAL), [key]: nn(value) }));
  }

  function handleSave() {
    void (async () => {
      setSaving(true);
      setError("");
      try {
        // Drop a deal whose every field is empty.
        const dealClean =
          deal && Object.values(deal).some((v) => v != null && String(v).trim() !== "")
            ? deal
            : null;
        const updated: Memo = {
          ...memo,
          transcript,
          extraction: {
            summary,
            deal: dealClean,
            contacts,
            calendar_events: events,
            reminders,
          },
        };
        const saved = await updateMemo(memo, updated);
        onUpdated(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Transcript</span>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={5}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Summary</span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </label>
      </section>

      {/* Deal */}
      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Deal</h3>
          {deal ? (
            <button type="button" onClick={() => setDeal(null)} className="text-xs text-zinc-400 hover:text-red-600">
              Remove deal
            </button>
          ) : (
            <button type="button" onClick={() => setDeal(EMPTY_DEAL)} className="text-xs text-blue-600 hover:underline">
              Add deal details
            </button>
          )}
        </div>
        {deal && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DEAL_FIELDS.map(({ key, label }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className={labelCls}>{label}</span>
                <input
                  type="text"
                  value={deal[key] ?? ""}
                  onChange={(e) => setDealField(key, e.target.value)}
                  className={inputCls}
                />
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Contacts */}
      <RowSection
        title="Contacts"
        onAdd={() => setContacts((c) => [...c, { name: "", role: null, company: null, notes: null }])}
      >
        {contacts.map((c, i) => (
          <RowCard key={i} onRemove={() => setContacts((arr) => arr.filter((_, j) => j !== i))}>
            <Field label="Name" value={c.name} onChange={(v) => setContacts((a) => a.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
            <Field label="Role" value={c.role ?? ""} onChange={(v) => setContacts((a) => a.map((x, j) => (j === i ? { ...x, role: nn(v) } : x)))} />
            <Field label="Company" value={c.company ?? ""} onChange={(v) => setContacts((a) => a.map((x, j) => (j === i ? { ...x, company: nn(v) } : x)))} />
            <Field label="Notes" value={c.notes ?? ""} onChange={(v) => setContacts((a) => a.map((x, j) => (j === i ? { ...x, notes: nn(v) } : x)))} />
          </RowCard>
        ))}
      </RowSection>

      {/* Calendar events */}
      <RowSection
        title="Calendar events"
        onAdd={() =>
          setEvents((e) => [...e, { title: "", start_iso: "", end_iso: null, location: null, attendees: [], notes: null }])
        }
      >
        {events.map((ev, i) => (
          <RowCard key={i} onRemove={() => setEvents((arr) => arr.filter((_, j) => j !== i))}>
            <Field label="Title" value={ev.title} onChange={(v) => setEvents((a) => a.map((x, j) => (j === i ? { ...x, title: v } : x)))} />
            <Field label="Start (ISO)" value={ev.start_iso} onChange={(v) => setEvents((a) => a.map((x, j) => (j === i ? { ...x, start_iso: v } : x)))} />
            <Field label="End (ISO)" value={ev.end_iso ?? ""} onChange={(v) => setEvents((a) => a.map((x, j) => (j === i ? { ...x, end_iso: nn(v) } : x)))} />
            <Field label="Location" value={ev.location ?? ""} onChange={(v) => setEvents((a) => a.map((x, j) => (j === i ? { ...x, location: nn(v) } : x)))} />
            <Field
              label="Attendees (comma-separated)"
              value={ev.attendees.join(", ")}
              onChange={(v) =>
                setEvents((a) =>
                  a.map((x, j) => (j === i ? { ...x, attendees: v.split(",").map((s) => s.trim()).filter(Boolean) } : x)),
                )
              }
            />
            <Field label="Notes" value={ev.notes ?? ""} onChange={(v) => setEvents((a) => a.map((x, j) => (j === i ? { ...x, notes: nn(v) } : x)))} />
          </RowCard>
        ))}
      </RowSection>

      {/* Reminders */}
      <RowSection title="Reminders" onAdd={() => setReminders((r) => [...r, { text: "", due_iso: null }])}>
        {reminders.map((r, i) => (
          <RowCard key={i} onRemove={() => setReminders((arr) => arr.filter((_, j) => j !== i))}>
            <Field label="Text" value={r.text} onChange={(v) => setReminders((a) => a.map((x, j) => (j === i ? { ...x, text: v } : x)))} />
            <Field label="Due (ISO)" value={r.due_iso ?? ""} onChange={(v) => setReminders((a) => a.map((x, j) => (j === i ? { ...x, due_iso: nn(v) } : x)))} />
          </RowCard>
        ))}
      </RowSection>

      {error && <div className="text-sm text-red-600 dark:text-red-400 break-words">{error}</div>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-sm text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </label>
  );
}

function RowSection({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h3>
        <button type="button" onClick={onAdd} className="text-xs text-blue-600 hover:underline">
          + Add
        </button>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function RowCard({ onRemove, children }: { onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onRemove} className="text-xs text-zinc-400 hover:text-red-600">
          Remove
        </button>
      </div>
    </div>
  );
}
