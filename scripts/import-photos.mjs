// Set org members' avatars from profile photos — either local image files
// (--dir) or their Microsoft 365 / Teams photo via Microsoft Graph (default).
// It uploads each image to Cloud Storage at avatars/{uid}/ with a Firebase
// download token and sets it as the member's photoURL (Auth + profile + member
// doc). ALWAYS dry-run first to confirm the file→person matches.
//
// Local mode (recommended when you already have the images):
//   node scripts/import-photos.mjs --org vibrationresearch.com --dir "C:\path\to\images" --dry-run
//   Files are matched to members by filename (full name, first name, or email
//   local-part, ignoring case/spaces/punctuation). e.g. "Brad Moelker.jpg" ->
//   Brad Moelker. Unmatched members are skipped and reported.
//
// Graph mode (pull from M365):
//   node scripts/import-photos.mjs --org vibrationresearch.com --dry-run
//   Needs an Entra app with Graph Application permission User.Read.All (admin
//   consent) and env AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET.
//
// Both need GOOGLE_APPLICATION_CREDENTIALS (Firebase admin) + a storage bucket
// (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET or --bucket).

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { extname, basename, join } from "node:path";
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

// Read a value from the environment, falling back to .env.local (the shell
// doesn't load NEXT_PUBLIC_* vars the way the dev server does).
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
const DIR = arg("dir"); // local-folder mode when set
const DRY_RUN = Boolean(arg("dry-run", false));
const BUCKET = arg("bucket", fromEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"));

if (!ORG) {
  console.error("Missing --org. See the header of this file for usage.");
  process.exit(1);
}

const IMAGE_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
const keyize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// --- local-folder source ----------------------------------------------------
function localFiles() {
  return readdirSync(DIR)
    .filter((f) => IMAGE_TYPES[extname(f).slice(1).toLowerCase()])
    .map((f) => ({ file: f, key: keyize(basename(f, extname(f))) }));
}

// Best filename match for a member: exact full-name / email-local / first-name,
// then a substring fallback. Returns { file, ext, contentType } or null.
function matchLocal(files, { displayName, email }) {
  const disp = keyize(displayName);
  const local = keyize((email || "").split("@")[0]);
  const first = keyize((displayName || "").split(/\s+/)[0]);
  const keys = [disp, local, first].filter(Boolean);
  const hit =
    files.find((f) => f.key === disp) ||
    files.find((f) => keys.includes(f.key)) ||
    files.find((f) => keys.some((k) => k.length >= 3 && (f.key.includes(k) || k.includes(f.key))));
  if (!hit) return null;
  const ext = extname(hit.file).slice(1).toLowerCase();
  return { file: hit.file, ext, contentType: IMAGE_TYPES[ext] };
}

// --- Microsoft Graph source --------------------------------------------------
async function graphToken() {
  const { AZURE_TENANT_ID: t, AZURE_CLIENT_ID: id, AZURE_CLIENT_SECRET: secret } = process.env;
  if (!t || !id || !secret) throw new Error("Missing AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET.");
  const body = new URLSearchParams({ client_id: id, client_secret: secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token HTTP ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function graphPhoto(token, email) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/photo/$value`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Graph photo HTTP ${r.status}: ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

// --- firebase-admin ----------------------------------------------------------
initializeApp({
  credential: applicationDefault(),
  storageBucket: BUCKET,
  projectId: fromEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
});
const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();

async function uploadAvatar(uid, buf, ext, contentType) {
  const dest = `avatars/${uid}/photo.${ext}`;
  const downloadToken = randomUUID();
  await bucket.file(dest).save(buf, {
    metadata: { contentType, metadata: { firebaseStorageDownloadTokens: downloadToken } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${downloadToken}`;
}

const files = DIR ? localFiles() : [];
const token = DIR ? null : await graphToken();
if (DIR) console.log(`Found ${files.length} image(s) in ${DIR}`);

const membersSnap = await db.collection(`orgs/${ORG}/members`).get();
console.log(`Matching photos for ${membersSnap.size} member(s) in "${ORG}"${DRY_RUN ? " (dry run)" : ""}\n`);

let set = 0;
let skipped = 0;
const failures = [];
for (const doc of membersSnap.docs) {
  const { uid, email, displayName } = doc.data();
  try {
    let buf;
    let ext = "jpg";
    let contentType = "image/jpeg";

    if (DIR) {
      const m = matchLocal(files, { displayName, email });
      if (!m) {
        console.log(`  - ${displayName || email} (no matching file)`);
        skipped++;
        continue;
      }
      if (DRY_RUN) {
        console.log(`  ~ ${displayName || email}  <-  ${m.file}`);
        set++;
        continue;
      }
      buf = readFileSync(join(DIR, m.file));
      ext = m.ext;
      contentType = m.contentType;
    } else {
      if (!email) throw new Error("member has no email");
      buf = await graphPhoto(token, email);
      if (!buf) {
        console.log(`  - ${email} (no M365 photo)`);
        skipped++;
        continue;
      }
      if (DRY_RUN) {
        console.log(`  ~ ${email} [would set photo, ${buf.length} bytes]`);
        set++;
        continue;
      }
    }

    const url = await uploadAvatar(uid, buf, ext, contentType);
    await auth.updateUser(uid, { photoURL: url });
    await db.doc(`users/${uid}`).set({ photoURL: url }, { merge: true });
    await doc.ref.set({ photoURL: url }, { merge: true });
    console.log(`  ✓ ${displayName || email}`);
    set++;
  } catch (e) {
    failures.push({ who: displayName || email, message: e?.message || String(e) });
    console.log(`  ✗ ${displayName || email} -> ${e?.message || e}`);
  }
}

console.log(`\nDone: ${set} ${DRY_RUN ? "matched" : "set"}, ${skipped} without a photo.`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f.who}: ${f.message}`);
  process.exit(1);
}
