// Pull each org member's Microsoft 365 / Teams profile photo (via Microsoft
// Graph) and set it as their Salescribe avatar. One-time seeding tool.
//
// For every member of the org (read from Firestore) it fetches
// GET /users/{email}/photo/$value from Graph, uploads the image to Cloud
// Storage at avatars/{uid}/photo.jpg with a Firebase download token, and sets
// that URL as their photoURL (Auth + profile + member doc). Members with no
// M365 photo are skipped.
//
// Prereqs:
//   - Entra app (the one used for Microsoft sign-in) with Microsoft Graph
//     APPLICATION permission "User.Read.All" and ADMIN CONSENT granted.
//   - Env: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
//   - GOOGLE_APPLICATION_CREDENTIALS (Firebase admin) + a storage bucket
//     (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET or --bucket).
//
// Usage:
//   node scripts/import-photos.mjs --org vibrationresearch.com [--dry-run]

import { randomUUID } from "node:crypto";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const ORG = arg("org");
const DRY_RUN = Boolean(arg("dry-run", false));
const BUCKET = arg("bucket", process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
const TENANT = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;

if (!ORG) {
  console.error("Missing --org. See the header of this file for usage.");
  process.exit(1);
}
if (!TENANT || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET env vars.");
  process.exit(1);
}

// --- Microsoft Graph ---------------------------------------------------------
async function graphToken() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token HTTP ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

// Returns a JPEG Buffer, or null if the user has no photo.
async function fetchPhoto(token, email) {
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/photo/$value`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (r.status === 404) return null; // no photo set
  if (!r.ok) throw new Error(`Graph photo HTTP ${r.status}: ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

// --- firebase-admin ----------------------------------------------------------
initializeApp({ credential: applicationDefault(), storageBucket: BUCKET });
const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();

async function uploadAvatar(uid, buf) {
  const dest = `avatars/${uid}/photo.jpg`;
  const downloadToken = randomUUID();
  await bucket.file(dest).save(buf, {
    metadata: {
      contentType: "image/jpeg",
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${downloadToken}`;
}

const token = await graphToken();
const membersSnap = await db.collection(`orgs/${ORG}/members`).get();
console.log(`Fetching photos for ${membersSnap.size} member(s) in "${ORG}"${DRY_RUN ? " (dry run)" : ""}\n`);

let set = 0;
let skipped = 0;
const failures = [];
for (const doc of membersSnap.docs) {
  const { uid, email, displayName } = doc.data();
  try {
    if (!email) throw new Error("member has no email");
    const buf = await fetchPhoto(token, email);
    if (!buf) {
      console.log(`  - ${email} (no M365 photo)`);
      skipped++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  ~ ${email} (${displayName}) [would set photo, ${buf.length} bytes]`);
      set++;
      continue;
    }
    const url = await uploadAvatar(uid, buf);
    await auth.updateUser(uid, { photoURL: url });
    await db.doc(`users/${uid}`).set({ photoURL: url }, { merge: true });
    await doc.ref.set({ photoURL: url }, { merge: true });
    console.log(`  ✓ ${email}`);
    set++;
  } catch (e) {
    failures.push({ email, message: e?.message || String(e) });
    console.log(`  ✗ ${email} -> ${e?.message || e}`);
  }
}

console.log(`\nDone: ${set} set, ${skipped} without a photo.`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f.email}: ${f.message}`);
  process.exit(1);
}
