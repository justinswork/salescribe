// Create Firebase Auth accounts + org membership for a list of people, so the
// audio import can attribute memos to them and they show up on the team.
//
// Accounts are created with emailVerified:true (an admin is vouching), which
// bypasses the client email-verification gate — so you do NOT need to disable
// verification. The real owner can sign in later via Google SSO on the same
// email, or by using "Forgot password?" to set a password. Idempotent: an
// existing account is reused, not recreated.
//
// CSV (header row required): email,displayName
//   collin@vibrationresearch.com,Collin Van Overloop
//
// Prereqs: GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key for
// the target Firebase project; firebase-admin installed.
//
// Usage:
//   node scripts/create-users.mjs --users ./scripts/users.csv --org vibrationresearch.com [--role member] [--dry-run]

import { readFileSync } from "node:fs";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const USERS = arg("users");
const ORG = arg("org");
const ROLE = arg("role", "member") === "admin" ? "admin" : "member";
const DRY_RUN = Boolean(arg("dry-run", false));

if (!USERS || !ORG) {
  console.error("Need --users <csv> and --org <orgId>. See the header of this file for usage.");
  process.exit(1);
}

function parseCsv(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift().split(",").map((h) => h.trim());
  return lines.map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = {};
    header.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const auth = getAuth();

const rows = parseCsv(USERS);
console.log(`Creating ${rows.length} account(s) in org "${ORG}"${DRY_RUN ? " (dry run)" : ""}\n`);

let ok = 0;
const failures = [];
for (const row of rows) {
  const email = (row.email || "").trim().toLowerCase();
  const displayName = (row.displayName || "").trim() || email;
  try {
    if (!email) throw new Error("missing email");

    let user;
    try {
      user = await auth.getUserByEmail(email);
    } catch {
      user = null;
    }
    if (DRY_RUN) {
      console.log(`  ~ ${email} (${displayName}) ${user ? "[exists]" : "[would create]"}`);
      ok++;
      continue;
    }
    if (!user) {
      user = await auth.createUser({ email, displayName, emailVerified: true });
    } else if (!user.displayName && displayName) {
      await auth.updateUser(user.uid, { displayName });
    }

    // Org membership + profile so they appear on the team and the extractor
    // treats them as internal (not prospect contacts).
    const now = new Date().toISOString();
    await db.doc(`users/${user.uid}`).set(
      { uid: user.uid, orgId: ORG, role: ROLE, email, displayName },
      { merge: true },
    );
    await db.doc(`orgs/${ORG}/members/${user.uid}`).set(
      { uid: user.uid, email, displayName, role: ROLE, joined_iso: now },
      { merge: true },
    );
    console.log(`  ✓ ${email} (${displayName})`);
    ok++;
  } catch (e) {
    failures.push({ email, message: e?.message || String(e) });
    console.log(`  ✗ ${email} -> ${e?.message || e}`);
  }
}

console.log(`\nDone: ${ok}/${rows.length}.`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f.email}: ${f.message}`);
  process.exit(1);
}
