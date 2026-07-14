// One-time seed of customer addresses from the OneNote-export manifests.
//
// The Sales Audio export (manifest.csv per rep/year) pairs each recording's
// company with the street address we pulled off the OneNote page. This script
// reads those manifests and fills the `address` field on matching customer
// records in Firestore — the geocoding input we need before we can map anything.
//
// Matching is by NORMALIZED company name (the same customerId() the app uses to
// key orgs/{org}/customers), so a manifest company only seeds an app customer
// when the two normalize to the same id. It reports coverage either way.
//
// Prerequisites (same as import-audio.mjs):
//   - GOOGLE_APPLICATION_CREDENTIALS -> a service-account key JSON for the target
//     Firebase project (admin; bypasses rules).
//   - NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local (or the env).
//
// Usage:
//   node scripts/seed-customer-addresses.mjs --org vibrationresearch.com \
//     --dir "C:\\Users\\justin.king\\Downloads\\Sales Audio" [--dry-run] [--overwrite] [--create] [--parse-only]
//
//   --dry-run     read + report matches, write nothing
//   --overwrite   replace an address a customer already has (default: skip those)
//   --create      also create customer records for manifest companies with no
//                 existing app customer (default: only update existing)
//   --parse-only  just parse the manifests and print company->address coverage,
//                 then exit WITHOUT touching Firebase (no creds needed) — useful
//                 to sanity-check parsing/filtering offline.

import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

function fromEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq > 0 && line.slice(0, eq).trim() === name) return line.slice(eq + 1).trim();
    }
  } catch {
    // no .env.local — fall through
  }
  return undefined;
}

const ORG = arg("org");
const DIR = arg("dir");
const DRY_RUN = Boolean(arg("dry-run", false));
const OVERWRITE = Boolean(arg("overwrite", false));
const CREATE = Boolean(arg("create", false));
const PARSE_ONLY = Boolean(arg("parse-only", false));

if (!DIR || (!ORG && !PARSE_ONLY)) {
  console.error("Need --dir (and --org unless --parse-only). See the header of this file for usage.");
  process.exit(1);
}

// --- normalization: must match src/lib/customers.ts exactly so ids align ------
function normalizeCompany(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,]+$/g, "")
    .replace(/\b(inc|inc\.|llc|corp|corporation|co|ltd|limited|gmbh)$/g, "")
    .trim();
}
function customerId(name) {
  const slug = normalizeCompany(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

// --- quote-aware CSV parsing (fields may contain commas / escaped quotes) -----
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

function parseManifest(path) {
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const o = {};
    header.forEach((h, i) => (o[h] = (cols[i] ?? "").trim()));
    return o;
  });
}

// An address is usable if it looks like a US mailing address — a ", ST" state
// segment plus a digit — and isn't one of the junk values that landed in the
// column (LinkedIn URLs, Salesforce links, bare contact names, emails).
function isUsableAddress(a) {
  if (!a) return false;
  const s = a.trim();
  if (s.length < 6 || !/\d/.test(s)) return false;
  if (/(linkedin|https?:\/\/|salesforce|@|\|)/i.test(s)) return false;
  // A ", ST" state segment OR a 5-digit ZIP — the latter also catches addresses
  // with a spelled-out or lowercase state.
  return /,\s*[A-Z]{2}\b/.test(s) || /\b\d{5}(-\d{4})?\b/.test(s);
}

// Last path segment of a file path (handles Windows and POSIX separators), for
// matching a manifest FileName to a memo's stored sourceFile.
function baseName(p) {
  return (p || "").split(/[\\/]/).pop() || "";
}

// Prefer an address that carries a ZIP over one that doesn't.
function betterAddress(a, b) {
  if (!a) return b;
  if (!b) return a;
  const zip = (s) => /\b\d{5}(-\d{4})?\b/.test(s);
  if (zip(a) && !zip(b)) return a;
  if (zip(b) && !zip(a)) return b;
  return a; // keep first
}

// --- gather manifests ---------------------------------------------------------
function findManifests(root) {
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.toLowerCase() === "manifest.csv" && extname(ent.name) === ".csv") out.push(p);
    }
  };
  walk(root);
  return out;
}

const manifests = findManifests(DIR);
if (!manifests.length) {
  console.error(`No manifest.csv files found under ${DIR}`);
  process.exit(1);
}

// Every usable row: { name, address, fileBase }.
const rows = [];
let rowCount = 0;
let usableRows = 0;
for (const path of manifests) {
  for (const r of parseManifest(path)) {
    const name = (r.Customer ?? "").trim();
    if (!name) continue;
    rowCount++;
    if (!isUsableAddress(r.Address)) continue;
    usableRows++;
    rows.push({ name, address: r.Address.trim(), fileBase: baseName(r.FileName).toLowerCase() });
  }
}

// Collapse rows to a customer id via `resolve` (best usable address wins).
function group(resolve) {
  const byId = new Map();
  for (const row of rows) {
    const id = resolve(row);
    const existing = byId.get(id);
    byId.set(id, {
      name: existing?.name ?? row.name,
      address: betterAddress(existing?.address, row.address),
    });
  }
  return byId;
}

console.log(`Parsed ${manifests.length} manifest(s): ${rowCount} rows, ${usableRows} with a usable address.\n`);

if (PARSE_ONLY) {
  const byId = group((row) => customerId(row.name));
  console.log(`${byId.size} distinct companies (by name):\n`);
  for (const [id, v] of [...byId.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    console.log(`  ${v.name}  [${id}]\n      ${v.address}`);
  }
  process.exit(0);
}

// --- firebase-admin -----------------------------------------------------------
const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
initializeApp({
  credential: applicationDefault(),
  projectId: fromEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
});
const db = getFirestore();

// Load existing app customers so we only touch ones that exist (unless --create).
const snap = await db.collection(`orgs/${ORG}/customers`).get();
const existing = new Set(snap.docs.map((d) => d.id));
console.log(`Org "${ORG}" has ${existing.size} customer(s).${DRY_RUN ? " (dry run)" : ""}\n`);

// Match each manifest row to the customer its memo actually created: imported
// memos store sourceFile, and each manifest row has the matching FileName, so
// filename → memo → customerId(deal.company) is a precise join that sidesteps
// spelling differences between the OneNote page name and the extracted company.
// Falls back to the manifest company name when no memo matches.
const memoSnap = await db.collection(`orgs/${ORG}/memos`).get();
const fileToCustomer = new Map();
for (const d of memoSnap.docs) {
  const m = d.data();
  const company = m.extraction?.deal?.company;
  if (company && m.sourceFile) fileToCustomer.set(baseName(m.sourceFile).toLowerCase(), customerId(company));
}
let viaFile = 0;
const byId = group((row) => {
  const hit = row.fileBase && fileToCustomer.get(row.fileBase);
  if (hit) {
    viaFile++;
    return hit;
  }
  return customerId(row.name);
});
console.log(
  `Resolved ${rows.length} usable row(s) to ${byId.size} customer(s) — ${viaFile} matched by filename.\n`,
);

let updated = 0;
let skippedHasAddr = 0;
let created = 0;
const unmatched = [];

for (const [id, v] of byId) {
  const doc = existing.has(id) ? snap.docs.find((d) => d.id === id) : null;
  if (!doc && !CREATE) {
    unmatched.push(v.name);
    continue;
  }
  if (doc) {
    const cur = doc.data();
    if (cur.address && cur.address.trim() && !OVERWRITE) {
      skippedHasAddr++;
      continue;
    }
    console.log(`  ${OVERWRITE && cur.address ? "↻" : "＋"} ${v.name}  →  ${v.address}`);
    if (!DRY_RUN) {
      await db.doc(`orgs/${ORG}/customers/${id}`).set(
        { address: v.address, updated_iso: new Date().toISOString() },
        { merge: true },
      );
    }
    updated++;
  } else {
    // --create: make a new customer record from the manifest company + address.
    console.log(`  ✚ (new) ${v.name}  →  ${v.address}`);
    if (!DRY_RUN) {
      const now = new Date().toISOString();
      await db.doc(`orgs/${ORG}/customers/${id}`).set(
        { id, name: v.name, address: v.address, created_iso: now, updated_iso: now },
        { merge: true },
      );
    }
    created++;
  }
}

console.log(
  `\nDone${DRY_RUN ? " (dry run — nothing written)" : ""}: ` +
    `${updated} address(es) set${skippedHasAddr ? `, ${skippedHasAddr} kept (already had one)` : ""}` +
    `${CREATE ? `, ${created} created` : ""}.`,
);
if (unmatched.length) {
  console.log(
    `\n${unmatched.length} manifest company(ies) had a usable address but no matching app customer ` +
      `(no memo references them yet). Re-run with --create to add them as new customers:`,
  );
  for (const n of unmatched.sort()) console.log(`  - ${n}`);
}
