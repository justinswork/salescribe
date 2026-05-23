"use client";

import type { Brief } from "@/lib/schema";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
        {title}
        {typeof count === "number" && count > 0 && (
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

function OwnerPill({ owner }: { owner: "salesperson" | "prospect" | "unclear" }) {
  const palette =
    owner === "salesperson"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
      : owner === "prospect"
        ? "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  const label = owner === "salesperson" ? "you" : owner === "prospect" ? "them" : "?";
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${palette}`}>
      {label}
    </span>
  );
}

function RiskPill({ level }: { level: "low" | "medium" | "high" }) {
  const palette =
    level === "high"
      ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
      : level === "medium"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${palette}`}>
      {level}
    </span>
  );
}

export default function BriefView({
  company,
  memoCount,
  brief,
}: {
  company: string;
  memoCount: number;
  brief: Brief;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
        Briefing · {memoCount} past memo{memoCount === 1 ? "" : "s"}
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {company}
      </h2>

      <Section title="Where the deal stands">
        <p className="text-sm text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap">
          {brief.deal_status_summary}
        </p>
      </Section>

      <Section title="Deal arc" count={brief.deal_arc.length}>
        {brief.deal_arc.length === 0 ? (
          <Empty label="No notable moments to reconstruct." />
        ) : (
          <ol className="flex flex-col gap-2">
            {brief.deal_arc.map((e, i) => (
              <li key={i} className="text-sm flex gap-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0 w-24 pt-0.5">
                  {formatDate(e.date_iso)}
                </span>
                <span className="text-zinc-900 dark:text-zinc-100">{e.event}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Outstanding next steps" count={brief.outstanding_next_steps.length}>
        {brief.outstanding_next_steps.length === 0 ? (
          <Empty label="Nothing outstanding." />
        ) : (
          <ul className="flex flex-col gap-2">
            {brief.outstanding_next_steps.map((s, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <OwnerPill owner={s.owner} />
                <div className="flex-1">
                  <span className="text-zinc-900 dark:text-zinc-100">{s.action}</span>
                  {s.due_iso && (
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                      due {formatDate(s.due_iso)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Talking points" count={brief.talking_points.length}>
        {brief.talking_points.length === 0 ? (
          <Empty label="Nothing flagged." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {brief.talking_points.map((t, i) => (
              <li key={i} className="text-sm text-zinc-900 dark:text-zinc-100 flex gap-2">
                <span className="text-zinc-400">·</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Open questions" count={brief.open_questions.length}>
        {brief.open_questions.length === 0 ? (
          <Empty label="No open questions." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {brief.open_questions.map((q, i) => (
              <li key={i} className="text-sm text-zinc-900 dark:text-zinc-100 flex gap-2">
                <span className="text-zinc-400">·</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Risks" count={brief.risks.length}>
        {brief.risks.length === 0 ? (
          <Empty label="No risks flagged." />
        ) : (
          <ul className="flex flex-col gap-2">
            {brief.risks.map((r, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <RiskPill level={r.level} />
                <span className="text-zinc-900 dark:text-zinc-100">{r.description}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
