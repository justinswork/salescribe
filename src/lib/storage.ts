"use client";

// Org-scoped memo persistence + retrieval via Firestore.
//
// Memos live at orgs/{orgId}/memos/{memoId}. Every member of the org can read
// a memo unless it's marked visibility:"private", in which case only its
// author can. Security rules (firestore.rules) enforce both the org boundary
// and the private/shared split — a teammate literally cannot read a private
// memo, so it can never surface in a shared briefing.
//
// Retrieval is intentionally simple: extract company hints from the current
// memo, substring-match against the loaded memos. Now that the pool spans the
// whole team, vector retrieval is a stronger eventual upgrade — but naive
// matching stays honest and debuggable for a first cut.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getAuthInstance, getDbInstance } from "./firebase";
import { currentOrgId } from "./org";
import type { Extraction, Memo, MemoChange, MemoRevision, MemoVisibility } from "./schema";

const MAX_RELATED = 3;

function requireUser() {
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error("Not signed in");
  return user;
}

function memosCollection() {
  requireUser();
  // Use the resolved org id (may differ from the email domain for invited
  // users), not a fresh domain computation.
  return collection(getDbInstance(), "orgs", currentOrgId(), "memos");
}

// Load everything this user is allowed to see: all shared memos across the
// team, plus their own (which includes their private ones). Two single-field
// queries merged client-side — avoids the composite index an OR query would
// need, and each query only returns docs the rules already permit.
export async function loadMemos(): Promise<Memo[]> {
  const user = getAuthInstance().currentUser;
  if (!user) return [];
  const col = memosCollection();
  const [sharedSnap, mineSnap] = await Promise.all([
    getDocs(query(col, where("visibility", "==", "shared"))),
    getDocs(query(col, where("authorUid", "==", user.uid))),
  ]);
  const byId = new Map<string, Memo>();
  for (const d of [...sharedSnap.docs, ...mineSnap.docs]) {
    byId.set(d.id, d.data() as Memo);
  }
  return Array.from(byId.values()).sort((a, b) =>
    b.created_iso.localeCompare(a.created_iso),
  );
}

function editorOf() {
  const user = requireUser();
  return { uid: user.uid, name: user.displayName ?? user.email ?? "Teammate", user };
}

// Atomically claim the next per-org memo number. Runs in a transaction so
// concurrent saves never collide on the same number.
async function nextMemoSeq(): Promise<number> {
  const db = getDbInstance();
  const ref = doc(db, "orgs", currentOrgId(), "counters", "memos");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists() ? (snap.data().value as number) : 0) + 1;
    tx.set(ref, { value: next }, { merge: true });
    return next;
  });
}

// Create a memo. Assigns a sequential number and seeds the revision log.
export async function saveMemo(memo: Memo): Promise<Memo> {
  const { uid, name } = editorOf();
  const seq = memo.seq ?? (await nextMemoSeq());
  const toSave: Memo = {
    ...memo,
    authorUid: memo.authorUid ?? uid,
    authorName: memo.authorName ?? name,
    visibility: memo.visibility ?? "shared",
    seq,
    revisions: memo.revisions ?? [
      { at: new Date().toISOString(), byUid: uid, byName: name, action: "created" },
    ],
  };
  await setDoc(doc(memosCollection(), memo.id), toSave);
  return toSave;
}

// Human-readable value for a field, for the diff view.
function nameList(items: Array<{ name?: string; title?: string; text?: string }>): string {
  const labels = items.map((x) => x.name || x.title || x.text || "—").filter(Boolean);
  return labels.length ? `${labels.length}: ${labels.join(", ")}` : "none";
}

// Field-level diff between two versions of a memo, for the revision history.
function diffMemo(prev: Memo, next: Memo): MemoChange[] {
  const changes: MemoChange[] = [];
  const add = (field: string, from: unknown, to: unknown) => {
    const f = from == null ? "" : String(from);
    const t = to == null ? "" : String(to);
    if (f !== t) changes.push({ field, from: f, to: t });
  };

  add("Transcript", prev.transcript, next.transcript);
  add("Summary", prev.extraction.summary, next.extraction.summary);
  add("Visibility", prev.visibility ?? "shared", next.visibility ?? "shared");

  const dealFields: Array<[keyof NonNullable<Extraction["deal"]>, string]> = [
    ["company", "Company"],
    ["prospect_name", "Prospect name"],
    ["stated_problem", "Stated problem"],
    ["budget_signals", "Budget signals"],
    ["decision_makers", "Decision makers"],
    ["objections", "Objections"],
    ["competitors", "Competitors"],
    ["next_step", "Next step"],
    ["next_step_due_iso", "Next step due"],
  ];
  for (const [key, label] of dealFields) {
    add(label, prev.extraction.deal?.[key] ?? "", next.extraction.deal?.[key] ?? "");
  }

  // Arrays: compare structurally; show a readable label list when they differ.
  const arrayField = (
    field: string,
    a: Array<{ name?: string; title?: string; text?: string }>,
    b: Array<{ name?: string; title?: string; text?: string }>,
  ) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ field, from: nameList(a), to: nameList(b) });
    }
  };
  arrayField("Contacts", prev.extraction.contacts, next.extraction.contacts);
  arrayField("Calendar events", prev.extraction.calendar_events, next.extraction.calendar_events);
  arrayField("Reminders", prev.extraction.reminders, next.extraction.reminders);

  return changes;
}

// Overwrite a memo's contents (full edit) and append an "edited" revision with
// the field-level diff. The caller passes the previous memo and the whole
// updated memo (which preserves seq/authorUid/created).
export async function updateMemo(previous: Memo, updated: Memo): Promise<Memo> {
  const { uid, name } = editorOf();
  const revision: MemoRevision = {
    at: new Date().toISOString(),
    byUid: uid,
    byName: name,
    action: "edited",
    changes: diffMemo(previous, updated),
  };
  const toSave: Memo = {
    ...updated,
    revisions: [...(updated.revisions ?? []), revision],
  };
  await setDoc(doc(memosCollection(), updated.id), toSave);
  return toSave;
}

export async function deleteMemo(id: string): Promise<void> {
  await deleteDoc(doc(memosCollection(), id));
}

// Flip a memo between shared and private after the fact. Rules only permit this
// for the memo's author.
export async function setMemoVisibility(id: string, visibility: MemoVisibility): Promise<void> {
  await setDoc(doc(memosCollection(), id), { visibility }, { merge: true });
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
// user's org so features that need a populated history (like cross-document
// briefings) can be exercised immediately. The JSON ships as a static asset.
//
// Demo memos are stamped is_demo=true and authored by the loading user so
// clearDemoData() can remove exactly the caller's own demo records without
// touching real memos or a teammate's data.
// -------------------------------------------------------------------------

type DemoDataFile = { memos?: Memo[] };

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
  const { uid, name } = editorOf();
  const db = getDbInstance();
  const col = memosCollection();
  // Assign a contiguous block of sequence numbers off the current counter.
  const counterRef = doc(db, "orgs", currentOrgId(), "counters", "memos");
  const counterSnap = await getDoc(counterRef);
  const base = counterSnap.exists() ? (counterSnap.data().value as number) : 0;
  const now = new Date().toISOString();
  const memos = found.data.memos!;
  // Firestore writeBatch caps at 500 operations — well above our ~88 memos.
  const batch = writeBatch(db);
  memos.forEach((memo, i) => {
    batch.set(doc(col, memo.id), {
      ...memo,
      authorUid: uid,
      authorName: name,
      visibility: "shared",
      is_demo: true,
      seq: base + i + 1,
      revisions: [{ at: now, byUid: uid, byName: name, action: "created" }],
    });
  });
  batch.set(counterRef, { value: base + memos.length }, { merge: true });
  await batch.commit();
  return { loaded: memos.length, source: found.source };
}

// Whether the caller has their own demo memos loaded. Scoped to the user's own
// authored memos (delete requires authorship) so it never reports or removes a
// teammate's demo data.
async function myDemoMemos(uid: string) {
  const q = query(memosCollection(), where("authorUid", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.filter((d) => (d.data() as Memo).is_demo === true);
}

export async function hasDemoData(): Promise<boolean> {
  const user = getAuthInstance().currentUser;
  if (!user) return false;
  return (await myDemoMemos(user.uid)).length > 0;
}

export async function clearDemoData(): Promise<{ deleted: number }> {
  const user = requireUser();
  const demos = await myDemoMemos(user.uid);
  if (demos.length === 0) return { deleted: 0 };
  const batch = writeBatch(getDbInstance());
  demos.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return { deleted: demos.length };
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
