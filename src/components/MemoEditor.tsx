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

const inputCls =
  "w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400";
const labelCls = "text-xs font-medium text-zinc-500 dark:text-zinc-400";

function nn(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

// ISO string ↔ native date-input values (plain string slicing — no timezone
// math, so the shown date/time matches what was stored).
const toDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const toDateTime = (iso: string | null) => (iso && iso.includes("T") ? iso.slice(0, 16) : "");

function formatIso(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- small shared bits -------------------------------------------------------

function ReadField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="font-medium text-zinc-500 dark:text-zinc-400 w-32 shrink-0">{label}</span>
      <span className="text-zinc-900 dark:text-zinc-100">{value}</span>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </label>
  );
}

function ItemButtons({
  editing,
  onEdit,
  onOk,
  onCancel,
  onRemove,
}: {
  editing: boolean;
  onEdit: () => void;
  onOk: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="mt-2 flex justify-end gap-3">
      {editing ? (
        <>
          <button type="button" onClick={onOk} className="text-xs font-medium text-blue-600 hover:underline">
            OK
          </button>
          <button type="button" onClick={onCancel} className="text-xs text-zinc-400 hover:text-zinc-600">
            Cancel
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={onEdit} className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            Edit
          </button>
          <button type="button" onClick={onRemove} className="text-xs text-zinc-400 hover:text-red-600">
            Remove
          </button>
        </>
      )}
    </div>
  );
}

const cardCls = "rounded border border-zinc-200 dark:border-zinc-800 p-3";

// --- item editors (read view matches ExtractionView; edit-then-OK inline) ----

function ContactItem({
  value,
  onChange,
  onRemove,
}: {
  value: Contact;
  onChange: (c: Contact) => void;
  onRemove: () => void;
}) {
  const blank = !value.name && !value.role && !value.company && !value.notes;
  const [editing, setEditing] = useState(blank);
  const [draft, setDraft] = useState<Contact>(value);
  const set = (patch: Partial<Contact>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <li className={cardCls}>
      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField label="Name" value={draft.name} onChange={(v) => set({ name: v })} />
          <TextField label="Role" value={draft.role ?? ""} onChange={(v) => set({ role: nn(v) })} />
          <TextField label="Company" value={draft.company ?? ""} onChange={(v) => set({ company: nn(v) })} />
          <TextField label="Notes" value={draft.notes ?? ""} onChange={(v) => set({ notes: nn(v) })} />
        </div>
      ) : (
        <div className="text-sm">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">{value.name || "(unnamed)"}</div>
          <ReadField label="Role" value={value.role} />
          <ReadField label="Company" value={value.company} />
          <ReadField label="Notes" value={value.notes} />
        </div>
      )}
      <ItemButtons
        editing={editing}
        onEdit={() => {
          setDraft(value);
          setEditing(true);
        }}
        onOk={() => {
          onChange(draft);
          setEditing(false);
        }}
        onCancel={() => (blank ? onRemove() : (setDraft(value), setEditing(false)))}
        onRemove={onRemove}
      />
    </li>
  );
}

function EventItem({
  value,
  onChange,
  onRemove,
}: {
  value: CalEvent;
  onChange: (e: CalEvent) => void;
  onRemove: () => void;
}) {
  const blank = !value.title && !value.start_iso;
  const [editing, setEditing] = useState(blank);
  const [draft, setDraft] = useState<CalEvent>(value);
  const set = (patch: Partial<CalEvent>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <li className={cardCls}>
      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField label="Title" value={draft.title} onChange={(v) => set({ title: v })} />
          <TextField label="Location" value={draft.location ?? ""} onChange={(v) => set({ location: nn(v) })} />
          <TextField
            label="Start"
            type="datetime-local"
            value={toDateTime(draft.start_iso)}
            onChange={(v) => set({ start_iso: v })}
          />
          <TextField
            label="End"
            type="datetime-local"
            value={toDateTime(draft.end_iso)}
            onChange={(v) => set({ end_iso: v || null })}
          />
          <TextField
            label="Attendees (comma-separated)"
            value={draft.attendees.join(", ")}
            onChange={(v) => set({ attendees: v.split(",").map((s) => s.trim()).filter(Boolean) })}
          />
          <TextField label="Notes" value={draft.notes ?? ""} onChange={(v) => set({ notes: nn(v) })} />
        </div>
      ) : (
        <div className="text-sm">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">{value.title || "(untitled event)"}</div>
          <ReadField label="When" value={formatIso(value.start_iso)} />
          <ReadField label="Until" value={formatIso(value.end_iso)} />
          <ReadField label="Where" value={value.location} />
          <ReadField label="With" value={value.attendees.length ? value.attendees.join(", ") : null} />
          <ReadField label="Notes" value={value.notes} />
        </div>
      )}
      <ItemButtons
        editing={editing}
        onEdit={() => {
          setDraft(value);
          setEditing(true);
        }}
        onOk={() => {
          onChange(draft);
          setEditing(false);
        }}
        onCancel={() => (blank ? onRemove() : (setDraft(value), setEditing(false)))}
        onRemove={onRemove}
      />
    </li>
  );
}

function ReminderItem({
  value,
  onChange,
  onRemove,
}: {
  value: Reminder;
  onChange: (r: Reminder) => void;
  onRemove: () => void;
}) {
  const blank = !value.text;
  const [editing, setEditing] = useState(blank);
  const [draft, setDraft] = useState<Reminder>(value);
  const set = (patch: Partial<Reminder>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <li className={cardCls}>
      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField label="Reminder" value={draft.text} onChange={(v) => set({ text: v })} />
          <TextField
            label="Due"
            type="date"
            value={toDate(draft.due_iso)}
            onChange={(v) => set({ due_iso: v || null })}
          />
        </div>
      ) : (
        <div className="flex justify-between text-sm">
          <span className="text-zinc-900 dark:text-zinc-100">{value.text || "(empty reminder)"}</span>
          {value.due_iso && (
            <span className="text-zinc-500 dark:text-zinc-400 ml-3 shrink-0">{formatIso(value.due_iso)}</span>
          )}
        </div>
      )}
      <ItemButtons
        editing={editing}
        onEdit={() => {
          setDraft(value);
          setEditing(true);
        }}
        onOk={() => {
          onChange(draft);
          setEditing(false);
        }}
        onCancel={() => (blank ? onRemove() : (setDraft(value), setEditing(false)))}
        onRemove={onRemove}
      />
    </li>
  );
}

// --- section shell -----------------------------------------------------------

function Section({
  title,
  count,
  onAdd,
  children,
}: {
  title: string;
  count?: number;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {title}
          {typeof count === "number" && (
            <span className="ml-2 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-normal text-zinc-700 dark:text-zinc-300">
              {count}
            </span>
          )}
        </h3>
        {onAdd && (
          <button type="button" onClick={onAdd} className="text-xs text-blue-600 hover:underline">
            + Add
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

// --- main --------------------------------------------------------------------

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
  const [dealEditing, setDealEditing] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>(memo.extraction.contacts);
  const [events, setEvents] = useState<CalEvent[]>(memo.extraction.calendar_events);
  const [reminders, setReminders] = useState<Reminder[]>(memo.extraction.reminders);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const setDealField = (patch: Partial<Deal>) => setDeal((d) => ({ ...(d ?? EMPTY_DEAL), ...patch }));

  function handleSave() {
    void (async () => {
      setSaving(true);
      setError("");
      try {
        const dealClean =
          deal && Object.values(deal).some((v) => v != null && String(v).trim() !== "") ? deal : null;
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
    <div className="flex flex-col gap-4">
      <Section title="Transcript">
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={5} className={inputCls} />
      </Section>

      <Section title="Summary">
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} className={inputCls} />
      </Section>

      <Section title="Calendar events" count={events.length} onAdd={() =>
        setEvents((e) => [...e, { title: "", start_iso: "", end_iso: null, location: null, attendees: [], notes: null }])
      }>
        {events.length === 0 ? (
          <p className="text-sm italic text-zinc-400 dark:text-zinc-500">No events.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((ev, i) => (
              <EventItem
                key={i}
                value={ev}
                onChange={(v) => setEvents((a) => a.map((x, j) => (j === i ? v : x)))}
                onRemove={() => setEvents((a) => a.filter((_, j) => j !== i))}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Reminders" count={reminders.length} onAdd={() =>
        setReminders((r) => [...r, { text: "", due_iso: null }])
      }>
        {reminders.length === 0 ? (
          <p className="text-sm italic text-zinc-400 dark:text-zinc-500">No reminders.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reminders.map((r, i) => (
              <ReminderItem
                key={i}
                value={r}
                onChange={(v) => setReminders((a) => a.map((x, j) => (j === i ? v : x)))}
                onRemove={() => setReminders((a) => a.filter((_, j) => j !== i))}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Contacts" count={contacts.length} onAdd={() =>
        setContacts((c) => [...c, { name: "", role: null, company: null, notes: null }])
      }>
        {contacts.length === 0 ? (
          <p className="text-sm italic text-zinc-400 dark:text-zinc-500">No contacts.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {contacts.map((c, i) => (
              <ContactItem
                key={i}
                value={c}
                onChange={(v) => setContacts((a) => a.map((x, j) => (j === i ? v : x)))}
                onRemove={() => setContacts((a) => a.filter((_, j) => j !== i))}
              />
            ))}
          </ul>
        )}
      </Section>

      {/* Deal — read view with an Edit toggle (single record) */}
      <Section title="Deal">
        {dealEditing ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="Company" value={deal?.company ?? ""} onChange={(v) => setDealField({ company: nn(v) })} />
              <TextField label="Prospect name" value={deal?.prospect_name ?? ""} onChange={(v) => setDealField({ prospect_name: nn(v) })} />
              <TextField label="Stated problem" value={deal?.stated_problem ?? ""} onChange={(v) => setDealField({ stated_problem: nn(v) })} />
              <TextField label="Budget signals" value={deal?.budget_signals ?? ""} onChange={(v) => setDealField({ budget_signals: nn(v) })} />
              <TextField label="Decision makers" value={deal?.decision_makers ?? ""} onChange={(v) => setDealField({ decision_makers: nn(v) })} />
              <TextField label="Objections" value={deal?.objections ?? ""} onChange={(v) => setDealField({ objections: nn(v) })} />
              <TextField label="Competitors" value={deal?.competitors ?? ""} onChange={(v) => setDealField({ competitors: nn(v) })} />
              <TextField label="Next step" value={deal?.next_step ?? ""} onChange={(v) => setDealField({ next_step: nn(v) })} />
              <TextField label="Next step due" type="date" value={toDate(deal?.next_step_due_iso ?? null)} onChange={(v) => setDealField({ next_step_due_iso: v || null })} />
            </div>
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => setDealEditing(false)} className="text-xs font-medium text-blue-600 hover:underline">
                OK
              </button>
            </div>
          </>
        ) : !deal ? (
          <div className="flex items-center justify-between">
            <p className="text-sm italic text-zinc-400 dark:text-zinc-500">No deal context.</p>
            <button type="button" onClick={() => { setDeal(EMPTY_DEAL); setDealEditing(true); }} className="text-xs text-blue-600 hover:underline">
              Add deal details
            </button>
          </div>
        ) : (
          <div>
            <div className="flex flex-col gap-1">
              <ReadField label="Company" value={deal.company} />
              <ReadField label="Prospect" value={deal.prospect_name} />
              <ReadField label="Stated problem" value={deal.stated_problem} />
              <ReadField label="Budget signals" value={deal.budget_signals} />
              <ReadField label="Decision-makers" value={deal.decision_makers} />
              <ReadField label="Objections" value={deal.objections} />
              <ReadField label="Competitors" value={deal.competitors} />
              <ReadField label="Next step" value={deal.next_step} />
              <ReadField label="Next-step due" value={formatIso(deal.next_step_due_iso)} />
            </div>
            <div className="mt-2 flex justify-end gap-3">
              <button type="button" onClick={() => setDealEditing(true)} className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
                Edit
              </button>
              <button type="button" onClick={() => setDeal(null)} className="text-xs text-zinc-400 hover:text-red-600">
                Remove
              </button>
            </div>
          </div>
        )}
      </Section>

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
