"use client";

// Org-scoped customer (account) records. A customer is the canonical, geocodable
// company profile that a memo's location resolves to — we geocode ONCE per
// customer, not per memo. Lives at orgs/{orgId}/customers/{id}, keyed by the
// normalized company name so upserts are idempotent and a memo resolves to its
// customer by name alone (no stored foreign key needed for a first cut).
//
// Mirrors storage.ts: client Firestore SDK, org id from org.ts, access enforced
// by firestore.rules (any member reads/upserts; only admins delete).

import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { getAuthInstance, getDbInstance, getStorageInstance } from "./firebase";
import { currentOrgId } from "./org";
import type { Customer, Memo } from "./schema";

function customersCollection() {
  if (!getAuthInstance().currentUser) throw new Error("Not signed in");
  return collection(getDbInstance(), "orgs", currentOrgId(), "customers");
}

// The join key between a free-text company name and a Customer. Lowercase, trim,
// collapse internal whitespace, and drop a trailing legal suffix/punctuation so
// "Foo, Inc." and "Foo Inc" resolve together. Used as the match key and (after
// slugifying) as the doc id.
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,]+$/g, "")
    .replace(/\b(inc|inc\.|llc|corp|corporation|co|ltd|limited|gmbh)$/g, "")
    .trim();
}

// Firestore doc id from the normalized name: [a-z0-9-] only, so it's a safe key
// (no slashes) and stable across identical names.
export function customerId(name: string): string {
  const slug = normalizeCompany(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

export async function loadCustomers(): Promise<Customer[]> {
  if (!getAuthInstance().currentUser) return [];
  const snap = await getDocs(customersCollection());
  return snap.docs
    .map((d) => d.data() as Customer)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const snap = await getDoc(doc(customersCollection(), id));
  return snap.exists() ? (snap.data() as Customer) : null;
}

// Resolve the customer for a free-text company name (by normalized key). Null if
// none exists yet.
export async function getCustomerByCompany(company: string): Promise<Customer | null> {
  return getCustomer(customerId(company));
}

// Create-or-merge a customer. Only the provided fields are written, so updating
// an address never clobbers coordinates and vice-versa. Stamps updated_iso
// every time; sets created_iso only on first write. The canonical `name` is set
// once (first writer wins) — a later variant spelling won't rename the record.
export async function upsertCustomer(
  patch: Partial<Customer> & { name: string },
): Promise<Customer> {
  const id = patch.id ?? customerId(patch.name);
  const ref = doc(customersCollection(), id);
  const existing = (await getDoc(ref)).data() as Customer | undefined;
  const now = new Date().toISOString();
  const merged: Customer = {
    ...existing,
    ...patch,
    id,
    name: existing?.name ?? patch.name,
    created_iso: existing?.created_iso ?? now,
    updated_iso: now,
  };
  await setDoc(ref, merged, { merge: true });
  return merged;
}

// Distinct VISITED accounts across memos → { canonical name, alias spellings },
// keyed by normalized name. The visited account is the memo's deal.company (a
// memo with deal=null contributes nothing). Contacts' companies are deliberately
// excluded: a contact may work somewhere the team never visited, so folding them
// in inflates the customer list with places that will never have an address or a
// map pin. Canonical name = most frequent spelling; the rest become aliases.
function companiesFromMemos(
  memos: Memo[],
): Map<string, { name: string; aliases: string[] }> {
  const byKey = new Map<string, Map<string, number>>(); // key → spelling → count
  const note = (raw?: string | null) => {
    const display = raw?.trim();
    if (!display) return;
    const key = normalizeCompany(display);
    if (!key) return;
    const spellings = byKey.get(key) ?? new Map<string, number>();
    spellings.set(display, (spellings.get(display) ?? 0) + 1);
    byKey.set(key, spellings);
  };
  for (const m of memos) {
    note(m.extraction.deal?.company);
  }
  const out = new Map<string, { name: string; aliases: string[] }>();
  for (const [key, spellings] of byKey) {
    const sorted = Array.from(spellings.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    out.set(key, { name: sorted[0][0], aliases: sorted.slice(1).map(([s]) => s) });
  }
  return out;
}

// Upsert a customer record for every distinct company found across the given
// memos. Only name + aliases are written, so an existing customer's address and
// coordinates are never clobbered (and the canonical name is kept). Idempotent:
// safe to run repeatedly as new memos arrive. Returns how many distinct
// customers were touched.
export async function deriveCustomersFromMemos(
  memos: Memo[],
): Promise<{ processed: number }> {
  const companies = companiesFromMemos(memos);
  let processed = 0;
  for (const { name, aliases } of companies.values()) {
    await upsertCustomer({ name, ...(aliases.length ? { aliases } : {}) });
    processed += 1;
  }
  return { processed };
}

export async function deleteCustomer(id: string): Promise<void> {
  await deleteDoc(doc(customersCollection(), id));
}

// Upload a customer's logo to orgs/{orgId}/customers/{id}/logo.<ext> and return
// a tokenized download URL (stored on the customer as logoUrl).
export async function uploadCustomerLogo(id: string, blob: Blob, ext: string): Promise<string> {
  const ref = storageRef(getStorageInstance(), `orgs/${currentOrgId()}/customers/${id}/logo.${ext}`);
  await uploadBytes(ref, blob, { contentType: blob.type || undefined });
  return getDownloadURL(ref);
}

// The memos (visits) whose visited account resolves to this customer.
export function memosForCustomer(memos: Memo[], id: string): Memo[] {
  return memos.filter((m) => {
    const company = m.extraction.deal?.company;
    return Boolean(company) && customerId(company as string) === id;
  });
}

// A contact known at this customer, aggregated across its visits.
export type CustomerContact = {
  name: string;
  role: string | null;
  company: string | null;
  count: number; // how many of the customer's memos mention them
  memoSeqs: number[]; // visits that mention them, for linking
};

// Derive the customer's contacts from its memos' extracted contacts, deduped by
// name (case-insensitive). Most-mentioned first. No stored FK — recomputed from
// memos so it's always current.
export function contactsForCustomer(memos: Memo[], id: string): CustomerContact[] {
  const byName = new Map<string, CustomerContact>();
  for (const m of memosForCustomer(memos, id)) {
    for (const c of m.extraction.contacts) {
      const key = (c.name || "").trim().toLowerCase();
      if (!key) continue;
      const existing = byName.get(key);
      if (existing) {
        existing.count += 1;
        existing.role = existing.role ?? c.role ?? null;
        existing.company = existing.company ?? c.company ?? null;
        if (typeof m.seq === "number" && !existing.memoSeqs.includes(m.seq)) existing.memoSeqs.push(m.seq);
      } else {
        byName.set(key, {
          name: c.name.trim(),
          role: c.role ?? null,
          company: c.company ?? null,
          count: 1,
          memoSeqs: typeof m.seq === "number" ? [m.seq] : [],
        });
      }
    }
  }
  return Array.from(byName.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
