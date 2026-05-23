"use client";

// Per-user memo persistence + retrieval via Firestore.
//
// Memos live at users/{uid}/memos/{memoId}. Security rules (firestore.rules)
// enforce that only the signed-in owner can read/write their subtree.
//
// Retrieval is intentionally simple: extract company hints from the current
// memo, substring-match against past memos. Vector embeddings would be a fine
// upgrade later, but for tens-to-hundreds of memos a salesperson would
// realistically accumulate, naive matching is honest and debuggable.

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getAuthInstance, getDbInstance } from "./firebase";
import type { Extraction, Memo } from "./schema";

const MAX_RELATED = 3;

function memosCollection() {
  const uid = getAuthInstance().currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  return collection(getDbInstance(), "users", uid, "memos");
}

export async function loadMemos(): Promise<Memo[]> {
  const uid = getAuthInstance().currentUser?.uid;
  if (!uid) return [];
  const q = query(memosCollection(), orderBy("created_iso", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Memo);
}

export async function saveMemo(memo: Memo): Promise<void> {
  await setDoc(doc(memosCollection(), memo.id), memo);
}

export async function deleteMemo(id: string): Promise<void> {
  await deleteDoc(doc(memosCollection(), id));
}

export function newMemoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `memo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Pure-logic retrieval. No Firestore access — operates on whatever memo list
// you give it. The page fetches all memos once on mount and filters in-memory.
function companyHintsFor(ex: Extraction): string[] {
  const hints = new Set<string>();
  if (ex.deal?.company) hints.add(ex.deal.company.toLowerCase());
  for (const c of ex.contacts) {
    if (c.company) hints.add(c.company.toLowerCase());
  }
  return Array.from(hints);
}

// -------------------------------------------------------------------------
// Demo data: load a pre-generated set of fictional memos into the signed-in
// user's Firestore subtree so a grader (or curious user) can immediately
// exercise features that need a populated memo history — like cross-document
// briefings. The JSON file ships as a static asset under /public.
//
// Each loaded memo is tagged with is_demo=true (the field is baked into the
// JSON by the generator script) so clearDemoData() can find and remove
// exactly the demo records without touching real memos the user dictated.
// -------------------------------------------------------------------------

type DemoDataFile = { memos?: Memo[] };

// Try the full dataset first, fall back to the sample file from a test run.
// Returns null if neither is present.
async function fetchDemoDataFile(): Promise<{ data: DemoDataFile; source: string } | null> {
  const candidates = ["/demo-data.json", "/demo-data-sample.json"];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = (await res.json()) as DemoDataFile;
      if (data?.memos && data.memos.length > 0) {
        return { data, source: url };
      }
    } catch {
      // try next
    }
  }
  return null;
}

export async function loadDemoData(): Promise<{ loaded: number; source: string }> {
  const found = await fetchDemoDataFile();
  if (!found) {
    throw new Error(
      'No demo data file found. Run "npm run gen:demo" locally first to produce public/demo-data.json.',
    );
  }
  const col = memosCollection();
  // Firestore writeBatch caps at 500 operations — well above our ~88 memos.
  const batch = writeBatch(getDbInstance());
  for (const memo of found.data.memos!) {
    // Belt-and-suspenders: ensure is_demo is true even if a generated file
    // somehow shipped without the flag.
    batch.set(doc(col, memo.id), { ...memo, is_demo: true });
  }
  await batch.commit();
  return { loaded: found.data.memos!.length, source: found.source };
}

// Quick existence check so the UI can vary "Load demo data" copy based on
// whether demo memos are already in the account. Returns true if at least one
// memo flagged is_demo=true exists for the signed-in user.
export async function hasDemoData(): Promise<boolean> {
  const col = memosCollection();
  const q = query(col, where("is_demo", "==", true));
  const snap = await getDocs(q);
  return !snap.empty;
}

export async function clearDemoData(): Promise<{ deleted: number }> {
  const col = memosCollection();
  const q = query(col, where("is_demo", "==", true));
  const snap = await getDocs(q);
  if (snap.empty) return { deleted: 0 };
  const batch = writeBatch(getDbInstance());
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return { deleted: snap.size };
}

// Find every memo that mentions a given company name (case-insensitive
// substring match on either deal.company or any contact's company field).
// Used by the briefing flow to pull all memos for a single prospect into
// one synthesized brief.
export function findMemosByCompany(company: string, all: Memo[]): Memo[] {
  const needle = company.trim().toLowerCase();
  if (!needle) return [];
  return all.filter((m) => {
    const haystack: string[] = [];
    if (m.extraction.deal?.company) haystack.push(m.extraction.deal.company.toLowerCase());
    for (const c of m.extraction.contacts) {
      if (c.company) haystack.push(c.company.toLowerCase());
    }
    return haystack.some((c) => c === needle || c.includes(needle) || needle.includes(c));
  });
}

// Returns the distinct companies that appear across all memos, with a count
// of how many memos reference each. Sorted descending by count so the most
// "briefable" prospects bubble up. Used to populate the briefings panel in
// the UI — only companies with at least 2 memos are worth a brief.
export function getCompanyOptions(all: Memo[]): Array<{ company: string; memoCount: number }> {
  const counts = new Map<string, { display: string; count: number }>();
  for (const m of all) {
    const candidates = new Set<string>();
    if (m.extraction.deal?.company) candidates.add(m.extraction.deal.company);
    for (const c of m.extraction.contacts) {
      if (c.company) candidates.add(c.company);
    }
    for (const company of candidates) {
      const key = company.trim().toLowerCase();
      if (!key) continue;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { display: company.trim(), count: 1 });
      }
    }
  }
  return Array.from(counts.values())
    .map((v) => ({ company: v.display, memoCount: v.count }))
    .sort((a, b) => b.memoCount - a.memoCount || a.company.localeCompare(b.company));
}

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
