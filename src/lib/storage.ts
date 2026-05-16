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
} from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Extraction, Memo } from "./schema";

const MAX_RELATED = 3;

function memosCollection() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  return collection(db, "users", uid, "memos");
}

export async function loadMemos(): Promise<Memo[]> {
  const uid = auth.currentUser?.uid;
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
