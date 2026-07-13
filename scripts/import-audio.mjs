// One-time bulk import of existing audio notes into Salescribe.
//
// Pipeline per file:  audio -> transcript -> /api/extract -> Firestore memo + Storage audio
//   - Transcription: a sidecar .txt next to the audio (recommended), or a
//     local Whisper CLI if you pass --transcribe (free, offline, private).
//   - Extraction: POSTed to a RUNNING app's /api/extract, which uses the app's
//     own Anthropic key (no token needed when auth isn't enforced, e.g. local
//     `npm run dev`). This reuses the exact extractor prompt + schema.
//   - Write: firebase-admin (bypasses rules) writes each memo and uploads its
//     audio, attributed to a real user account (matched by email).
//
// Prerequisites:
//   - `npm run dev` running (or pass --server https://your-deploy + a token).
//   - GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key JSON for
//     the target Firebase project (admin access).
//   - Storage bucket via --bucket or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.
//   - For --transcribe: OpenAI Whisper installed (`pip install openai-whisper`).
//   - Each author email must already exist as a Firebase Auth user.
//
// Manifest CSV (header row required), commas not allowed inside fields:
//   file,email,date,visibility
//   2024-03-14_northwind.mp3,sarah@vibrationresearch.com,2024-03-14,shared
//
// Usage (manifest — mixed authors):
//   node scripts/import-audio.mjs --dir ./audio --manifest ./audio/manifest.csv \
//     --org vibrationresearch.com [--transcribe] [--model base] [--dry-run]
//
// Usage (single author — import a whole folder for one person, no manifest):
//   node scripts/import-audio.mjs --dir ./audio/collin --email collin@vibrationresearch.com \
//     --org vibrationresearch.com [--visibility shared] [--transcribe] [--dry-run]

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, basename, extname } from "node:path";
import { tmpdir } from "node:os";
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

const DIR = arg("dir", ".");
const MANIFEST = arg("manifest");
const EMAIL = arg("email"); // single-author mode: import every audio file in --dir for this user
const VISIBILITY = arg("visibility", "shared");
const ORG = arg("org");
const SERVER = arg("server", "http://localhost:3000");
const TOKEN = arg("token"); // SALESCRIBE_SERVICE_TOKEN when hitting a deployed server
const MODEL = arg("model", "base");
const DO_TRANSCRIBE = Boolean(arg("transcribe", false));
const DRY_RUN = Boolean(arg("dry-run", false));
const BUCKET = arg("bucket", process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);

if (!ORG || (!MANIFEST && !EMAIL)) {
  console.error("Need --org and either --manifest or --email. See the header of this file for usage.");
  process.exit(1);
}

const AUDIO_EXTS = new Set(["mp3", "m4a", "wav", "webm", "mp4", "ogg", "flac"]);

// --- manifest ----------------------------------------------------------------
function parseManifest(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift().split(",").map((h) => h.trim());
  return lines.map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = {};
    header.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

// --- transcription -----------------------------------------------------------
function transcriptFor(audioPath) {
  const sidecar = join(dirname(audioPath), `${basename(audioPath, extname(audioPath))}.txt`);
  if (existsSync(sidecar)) return readFileSync(sidecar, "utf8").trim();
  if (!DO_TRANSCRIBE) {
    throw new Error(`No transcript for ${audioPath}. Provide a .txt sidecar or pass --transcribe.`);
  }
  const out = tmpdir();
  const res = spawnSync("whisper", [audioPath, "--model", MODEL, "--output_format", "txt", "--output_dir", out], {
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`whisper failed for ${audioPath}: ${res.stderr || res.error}`);
  const txt = join(out, `${basename(audioPath, extname(audioPath))}.txt`);
  return readFileSync(txt, "utf8").trim();
}

// --- extraction (reuse the running app's extractor) --------------------------
async function extract(transcript, dateIso) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const r = await fetch(`${SERVER}/api/extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({ transcript, chat: [], reference_now_iso: dateIso }),
  });
  if (!r.ok) throw new Error(`extract HTTP ${r.status}: ${await r.text()}`);
  return (await r.json()).extraction;
}

// --- firebase-admin ----------------------------------------------------------
initializeApp({ credential: applicationDefault(), storageBucket: BUCKET });
const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();

async function nextSeq() {
  const ref = db.doc(`orgs/${ORG}/counters/memos`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? snap.data().value : 0) + 1;
    tx.set(ref, { value: next }, { merge: true });
    return next;
  });
}

// Rows come from a manifest CSV, or (single-author mode) every audio file in
// --dir attributed to --email.
const rows = MANIFEST
  ? parseManifest(MANIFEST)
  : readdirSync(DIR)
      .filter((f) => AUDIO_EXTS.has(extname(f).slice(1).toLowerCase()))
      .sort()
      .map((f) => ({ file: f, email: EMAIL, date: "", visibility: VISIBILITY }));

console.log(`Importing ${rows.length} note(s) into org "${ORG}"${DRY_RUN ? " (dry run)" : ""}\n`);

let ok = 0;
const failures = [];
for (const row of rows) {
  const audioPath = join(DIR, row.file);
  try {
    if (!existsSync(audioPath)) throw new Error(`file not found: ${audioPath}`);
    const user = await auth.getUserByEmail(row.email);
    const dateIso = row.date ? new Date(row.date).toISOString() : new Date().toISOString();
    const transcript = transcriptFor(audioPath);
    if (!transcript) throw new Error("empty transcript");
    const extraction = await extract(transcript, dateIso);

    const id = randomUUID();
    const ext = extname(audioPath).slice(1) || "webm";
    if (DRY_RUN) {
      console.log(`  ~ ${row.file} -> #? ${user.email} (${extraction.deal?.company ?? "no company"})`);
      ok++;
      continue;
    }

    const seq = await nextSeq();
    const dest = `orgs/${ORG}/memos/${id}/audio.${ext}`;
    await bucket.upload(audioPath, { destination: dest });
    const name = user.displayName || user.email || "Teammate";
    await db.doc(`orgs/${ORG}/memos/${id}`).set({
      id,
      created_iso: dateIso,
      transcript,
      extraction,
      chat: [],
      seq,
      authorUid: user.uid,
      authorName: name,
      visibility: row.visibility === "private" ? "private" : "shared",
      audioPath: dest,
      revisions: [{ at: new Date().toISOString(), byUid: user.uid, byName: name, action: "created" }],
    });
    console.log(`  ✓ ${row.file} -> #${seq} ${user.email}`);
    ok++;
  } catch (e) {
    failures.push({ file: row.file, message: e?.message || String(e) });
    console.log(`  ✗ ${row.file} -> ${e?.message || e}`);
  }
}

console.log(`\nDone: ${ok}/${rows.length} imported.`);
if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f.file}: ${f.message}`);
  process.exit(1);
}
