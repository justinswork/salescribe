import { Fragment } from "react";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Render text with case-insensitive matches of any term wrapped in <mark>.
// Used to keep a memo's search terms visible after opening it.
export default function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const cleaned = terms.map((t) => t.trim()).filter(Boolean);
  if (!text || cleaned.length === 0) return <>{text}</>;
  const pattern = cleaned.map(escapeRegExp).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));
  const testRe = new RegExp(`^(?:${pattern})$`, "i");
  return (
    <>
      {parts.map((p, i) =>
        p && testRe.test(p) ? (
          <mark key={i} className="rounded bg-yellow-200 dark:bg-yellow-500/40 px-0.5 text-inherit">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}
