"use client";

import { createContext, useContext } from "react";
import Highlight from "@/components/Highlight";
import type { Extraction } from "@/lib/schema";

// Search terms to highlight, shared with the module-level Field without
// threading a prop through every call site.
const HighlightContext = createContext<string[]>([]);

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

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
        {title}
        {typeof count === "number" && (
          <span className="ml-2 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-normal text-zinc-700 dark:text-zinc-300">
            {count}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-sm italic text-zinc-400 dark:text-zinc-500">{label}</p>;
}

function Field({ label, value }: { label: string; value: string | null }) {
  const highlight = useContext(HighlightContext);
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="font-medium text-zinc-500 dark:text-zinc-400 w-32 shrink-0">{label}</span>
      <span className="text-zinc-900 dark:text-zinc-100">
        <Highlight text={value} terms={highlight} />
      </span>
    </div>
  );
}

export default function ExtractionView({
  extraction,
  highlight = [],
}: {
  extraction: Extraction;
  highlight?: string[];
}) {
  return (
    <HighlightContext.Provider value={highlight}>
    <div className="flex flex-col gap-3">
      <Section title="Summary">
        <p className="text-sm text-zinc-900 dark:text-zinc-100">
          <Highlight text={extraction.summary} terms={highlight} />
        </p>
      </Section>

      <Section title="Calendar events" count={extraction.calendar_events.length}>
        {extraction.calendar_events.length === 0 ? (
          <Empty label="No events mentioned." />
        ) : (
          <ul className="flex flex-col gap-3">
            {extraction.calendar_events.map((e, i) => (
              <li key={i} className="rounded border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  <Highlight text={e.title} terms={highlight} />
                </div>
                <Field label="When" value={formatIso(e.start_iso) ?? null} />
                {e.end_iso && <Field label="Until" value={formatIso(e.end_iso)} />}
                <Field label="Where" value={e.location} />
                {e.attendees.length > 0 && (
                  <Field label="With" value={e.attendees.join(", ")} />
                )}
                <Field label="Notes" value={e.notes} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Reminders" count={extraction.reminders.length}>
        {extraction.reminders.length === 0 ? (
          <Empty label="No reminders." />
        ) : (
          <ul className="flex flex-col gap-2">
            {extraction.reminders.map((r, i) => (
              <li key={i} className="flex justify-between text-sm rounded border border-zinc-200 dark:border-zinc-800 p-3">
                <span className="text-zinc-900 dark:text-zinc-100">
                  <Highlight text={r.text} terms={highlight} />
                </span>
                {r.due_iso && (
                  <span className="text-zinc-500 dark:text-zinc-400 ml-3 shrink-0">{formatIso(r.due_iso)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Contacts" count={extraction.contacts.length}>
        {extraction.contacts.length === 0 ? (
          <Empty label="No people mentioned." />
        ) : (
          <ul className="flex flex-col gap-2">
            {extraction.contacts.map((c, i) => (
              <li key={i} className="rounded border border-zinc-200 dark:border-zinc-800 p-3 text-sm">
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  <Highlight text={c.name} terms={highlight} />
                </div>
                <Field label="Role" value={c.role} />
                <Field label="Company" value={c.company} />
                <Field label="Notes" value={c.notes} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Deal">
        {!extraction.deal ? (
          <Empty label="No deal context in this memo." />
        ) : (
          <div className="flex flex-col gap-1">
            <Field label="Company" value={extraction.deal.company} />
            <Field label="Prospect" value={extraction.deal.prospect_name} />
            <Field label="Stated problem" value={extraction.deal.stated_problem} />
            <Field label="Budget signals" value={extraction.deal.budget_signals} />
            <Field label="Decision-makers" value={extraction.deal.decision_makers} />
            <Field label="Objections" value={extraction.deal.objections} />
            <Field label="Competitors" value={extraction.deal.competitors} />
            <Field label="Next step" value={extraction.deal.next_step} />
            <Field label="Next-step due" value={formatIso(extraction.deal.next_step_due_iso)} />
          </div>
        )}
      </Section>
    </div>
    </HighlightContext.Provider>
  );
}
