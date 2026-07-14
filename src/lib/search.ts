// Field-scoped memo search. A query is a set of AND-ed conditions. Each token
// is either `field:value` (also written `field = value`, `field contains value`,
// or `field is value`) targeting one field, or a bare term that matches any
// field. Quote a value to include spaces: company:"Element Materials".
//
//   company:Element transcript:ObserVIEW      -> company has "Element" AND transcript has "ObserVIEW"
//   author:Kevin budget                       -> author has "Kevin" AND anything has "budget"

import type { Memo } from "./schema";

export type SearchField = "any" | "company" | "contact" | "summary" | "transcript" | "author";
export const SEARCH_FIELDS = ["company", "contact", "summary", "transcript", "author"] as const;

export type SearchCondition = { field: SearchField; value: string };

// Normalize the friendlier operators (`=`, `contains`, `is`) down to `field:`
// so the tokenizer only has to handle one form.
function normalize(q: string): string {
  const fields = SEARCH_FIELDS.join("|");
  return q
    .replace(new RegExp(`\\b(${fields})\\s*=\\s*`, "gi"), "$1:")
    .replace(new RegExp(`\\b(${fields})\\s+(?:contains|is)\\s+`, "gi"), "$1:");
}

const TOKEN_RE =
  /(?:(company|contact|summary|transcript|author)\s*:\s*)?(?:"([^"]+)"|(\S+))/gi;

// Parse a query into AND-ed conditions. Standalone "and" glue is ignored.
export function parseQuery(q: string): SearchCondition[] {
  const conditions: SearchCondition[] = [];
  if (!q || !q.trim()) return conditions;
  const normalized = normalize(q);
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(normalized)) !== null) {
    const field = (m[1]?.toLowerCase() as SearchField | undefined) ?? "any";
    const value = (m[2] ?? m[3] ?? "").trim();
    if (!value) continue;
    if (field === "any" && /^and$/i.test(value)) continue;
    conditions.push({ field, value });
  }
  return conditions;
}

function fieldText(m: Memo, field: SearchField, authorName: string): string {
  switch (field) {
    case "company":
      return [m.extraction.deal?.company, ...m.extraction.contacts.map((c) => c.company)]
        .filter(Boolean)
        .join(" ");
    case "contact":
      return m.extraction.contacts
        .flatMap((c) => [c.name, c.role, c.company, c.notes])
        .filter(Boolean)
        .join(" ");
    case "summary":
      return m.extraction.summary;
    case "transcript":
      return m.transcript;
    case "author":
      return authorName;
    default:
      return "";
  }
}

function anyText(m: Memo, authorName: string): string {
  return [
    m.seq != null ? `#${m.seq}` : null,
    m.extraction.deal?.company,
    m.extraction.deal?.prospect_name,
    m.extraction.deal?.stated_problem,
    m.extraction.deal?.next_step,
    ...m.extraction.contacts.flatMap((c) => [c.name, c.company, c.role]),
    m.extraction.summary,
    m.transcript,
    authorName,
  ]
    .filter(Boolean)
    .join(" ");
}

// Does the memo satisfy every condition (AND)? authorName is resolved by the
// caller (memo.authorName, falling back to the roster).
export function matchMemo(m: Memo, conditions: SearchCondition[], authorName: string): boolean {
  if (conditions.length === 0) return true;
  const any = anyText(m, authorName).toLowerCase();
  return conditions.every((c) => {
    const v = c.value.toLowerCase();
    return (c.field === "any" ? any : fieldText(m, c.field, authorName).toLowerCase()).includes(v);
  });
}

// The content values worth highlighting when a matched memo is opened
// (everything except the author name).
export function highlightTerms(conditions: SearchCondition[]): string[] {
  return conditions.filter((c) => c.field !== "author").map((c) => c.value).filter(Boolean);
}
