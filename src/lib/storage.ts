// Client-side memo persistence + retrieval.
//
// Memos live in localStorage under a single key. Retrieval is intentionally simple:
// we extract company hints from the current memo and substring-match against past
// memos. Vector embeddings would be a fine upgrade later, but for tens-to-hundreds of
// memos a single salesperson would realistically accumulate, naive matching is honest
// and debuggable.

import type { Memo, Extraction } from "./schema";

const STORAGE_KEY = "salescribe:memos";
const MAX_RELATED = 3;

export function loadMemos(): Memo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Memo[]) : [];
  } catch {
    return [];
  }
}

export function saveMemo(memo: Memo): void {
  if (typeof window === "undefined") return;
  const memos = loadMemos();
  // De-dupe by id (in case finalize is hit twice).
  const filtered = memos.filter((m) => m.id !== memo.id);
  filtered.unshift(memo);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export function deleteMemo(id: string): void {
  if (typeof window === "undefined") return;
  const memos = loadMemos().filter((m) => m.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
}

export function newMemoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `memo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Pulls every company-ish string we can find in an extraction.
function companyHintsFor(ex: Extraction): string[] {
  const hints = new Set<string>();
  if (ex.deal?.company) hints.add(ex.deal.company.toLowerCase());
  for (const c of ex.contacts) {
    if (c.company) hints.add(c.company.toLowerCase());
  }
  return Array.from(hints);
}

// Returns past memos that share a company hint with the current extraction.
// Most recent first, capped at MAX_RELATED.
export function findRelatedMemos(current: Extraction, all: Memo[]): Memo[] {
  const currentHints = companyHintsFor(current);
  if (currentHints.length === 0) return [];

  const matches = all.filter((m) => {
    const pastHints = companyHintsFor(m.extraction);
    return pastHints.some((p) => currentHints.some((c) => p.includes(c) || c.includes(p)));
  });

  matches.sort((a, b) => b.created_iso.localeCompare(a.created_iso));
  return matches.slice(0, MAX_RELATED);
}
