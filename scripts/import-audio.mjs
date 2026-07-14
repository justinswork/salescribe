// One-time bulk import of existing audio notes into Salescribe.
//
// Pipeline per file:  audio -> transcript -> /api/extract -> Firestore memo + Storage audio
//   - Transcription: a sidecar .txt next to the audio, the OpenAI Whisper API
//     (--transcribe-api, needs OPENAI_API_KEY + ffmpeg on PATH), or a local
//     Whisper CLI (--transcribe, free/offline).
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
//   - For --transcribe-api: OPENAI_API_KEY + ffmpeg on PATH (downmixes to
//     stay under Whisper's 25MB limit). For --transcribe: OpenAI Whisper CLI.
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
//   The folder is scanned recursively (e.g. Collin/2026/*.mp4), and each memo's
//   date is parsed from a leading "YYYY-MM-DD HHMM" in the filename.

import { readFileSync, existsSync, readdirSync, createReadStream, statSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import OpenAI from "openai";
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

// Read a value from the environment, falling back to .env.local.
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

const DIR = arg("dir", ".");
const MANIFEST = arg("manifest");
const EMAIL = arg("email"); // single-author mode: import every audio file in --dir for this user
const VISIBILITY = arg("visibility", "shared");
const ORG = arg("org");
const SERVER = arg("server", "http://localhost:3000");
const TOKEN = arg("token"); // SALESCRIBE_SERVICE_TOKEN when hitting a deployed server
const MODEL = arg("model", "base");
const DO_TRANSCRIBE = Boolean(arg("transcribe", false));
const DO_TRANSCRIBE_API = Boolean(arg("transcribe-api", false));
const LIMIT = Number(arg("limit", 0)) || 0; // cap files processed (0 = all); handy for a first test
const DRY_RUN = Boolean(arg("dry-run", false));
const BUCKET = arg("bucket", fromEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"));

if (!ORG || (!MANIFEST && !EMAIL)) {
  console.error("Need --org and either --manifest or --email. See the header of this file for usage.");
  process.exit(1);
}

const OPENAI_KEY = fromEnv("OPENAI_API_KEY");
if (DO_TRANSCRIBE_API && !OPENAI_KEY) {
  console.error("Missing OPENAI_API_KEY (set it in .env.local) for --transcribe-api.");
  process.exit(1);
}
const openai = DO_TRANSCRIBE_API ? new OpenAI({ apiKey: OPENAI_KEY }) : null;

const AUDIO_EXTS = new Set(["mp3", "m4a", "wav", "webm", "mp4", "ogg", "flac", "3gp"]);

// Recursively collect audio files under root, returned as paths relative to
// root (single-author folders are laid out as {Person}/{Year}/*.mp4).
function walkAudio(root) {
  const out = [];
  const walk = (rel) => {
    for (const ent of readdirSync(join(root, rel), { withFileTypes: true })) {
      const relPath = rel ? join(rel, ent.name) : ent.name;
      if (ent.isDirectory()) walk(relPath);
      else if (AUDIO_EXTS.has(extname(ent.name).slice(1).toLowerCase())) out.push(relPath);
    }
  };
  walk("");
  return out;
}

// Deterministic memo id from author + source file, so re-running a folder
// (e.g. after a transient failure partway through) skips what's already in and
// doesn't create duplicates.
function memoId(uid, file) {
  return createHash("sha1").update(`${uid}|${file}`).digest("hex").slice(0, 20);
}

// Pull the visit date/time out of a filename like
// "2026-05-14 1106 - Collin - Milwaukee Tool.mp4" so the memo carries the real
// date. Returns "" (import falls back to "now") when there's no leading date.
function dateFromName(file) {
  const m = basename(file).match(/(\d{4})-(\d{2})-(\d{2})(?:[ _]+(\d{2})(\d{2}))?/);
  if (!m) return "";
  const [, y, mo, d, hh, mm] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), hh ? Number(hh) : 12, mm ? Number(mm) : 0).toISOString();
}

// Pull the account/company out of a filename like
// "2026-05-14 1106 - Collin - Milwaukee Tool - Battery Group.mp4". The name is
// "date[ time] - person - company[ - subteam]", so everything after the person
// segment is the account. Used as a strong hint so deal.company is reliable
// even when the audio doesn't clearly name the account. "" if not present.
function companyFromName(file) {
  const parts = basename(file, extname(file)).split(" - ");
  return parts.length >= 3 ? parts.slice(2).join(" - ").trim() : "";
}

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
async function transcriptFor(audioPath, whisperPrompt) {
  const sidecar = join(dirname(audioPath), `${basename(audioPath, extname(audioPath))}.txt`);
  if (existsSync(sidecar)) return readFileSync(sidecar, "utf8").trim();
  if (DO_TRANSCRIBE_API) return transcribeApi(audioPath, whisperPrompt);
  if (!DO_TRANSCRIBE) {
    throw new Error(`No transcript for ${audioPath}. Provide a .txt sidecar, --transcribe, or --transcribe-api.`);
  }
  const out = tmpdir();
  const args = [audioPath, "--model", MODEL, "--output_format", "txt", "--output_dir", out];
  // Bias Whisper toward the org's proper nouns (same glossary the app uses).
  if (whisperPrompt) args.push("--initial_prompt", whisperPrompt);
  const res = spawnSync("whisper", args, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`whisper failed for ${audioPath}: ${res.stderr || res.error}`);
  const txt = join(out, `${basename(audioPath, extname(audioPath))}.txt`);
  return readFileSync(txt, "utf8").trim();
}

// OpenAI Whisper API. These sources are often video and can exceed Whisper's
// 25MB limit, so downmix to a compact mono 16kHz mp3 with ffmpeg first (also
// strips video and normalizes 3gp/mp4 into a supported format). Falls back to
// the raw file if ffmpeg isn't available and the file is small enough.
async function transcribeApi(audioPath, prompt) {
  const tmp = join(tmpdir(), `salescribe-${randomUUID()}.mp3`);
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-i", audioPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", tmp],
    { encoding: "utf8" },
  );
  let sendPath = tmp;
  if (ff.status !== 0 || !existsSync(tmp)) {
    if (statSync(audioPath).size > 25 * 1024 * 1024) {
      throw new Error(`ffmpeg unavailable and ${basename(audioPath)} exceeds Whisper's 25MB limit — install ffmpeg.`);
    }
    sendPath = audioPath; // small enough to send as-is
  }
  try {
    const res = await openai.audio.transcriptions.create({
      file: createReadStream(sendPath),
      model: "whisper-1",
      prompt: prompt || undefined,
      response_format: "text",
    });
    return (typeof res === "string" ? res : res?.text || "").trim();
  } finally {
    if (sendPath === tmp) {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort temp cleanup
      }
    }
  }
}

// --- extraction (reuse the running app's extractor) --------------------------
async function extract(transcript, dateIso, orgContext) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const r = await fetch(`${SERVER}/api/extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      transcript,
      chat: [],
      reference_now_iso: dateIso,
      org_context: orgContext ?? undefined,
    }),
  });
  if (!r.ok) throw new Error(`extract HTTP ${r.status}: ${await r.text()}`);
  return (await r.json()).extraction;
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

async function nextSeq() {
  const ref = db.doc(`orgs/${ORG}/counters/memos`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? snap.data().value : 0) + 1;
    tx.set(ref, { value: next }, { merge: true });
    return next;
  });
}

// Build the glossary grounding (same shape the app uses) so imported notes get
// correct proper-noun spelling and don't file teammates as prospect contacts.
async function buildGrounding() {
  const uniq = (l) => Array.from(new Set(l.map((s) => s.trim()).filter(Boolean)));
  const [gSnap, mSnap, oSnap] = await Promise.all([
    db.doc(`orgs/${ORG}/config/glossary`).get(),
    db.collection(`orgs/${ORG}/members`).get(),
    db.doc(`orgs/${ORG}`).get(),
  ]);
  const g = gSnap.exists ? gSnap.data() : {};
  const terms = uniq(g.terms ?? []);
  const memberNames = mSnap.docs.map((d) => d.data().displayName || "").filter(Boolean);
  const team = uniq([...memberNames, ...(g.teamNames ?? [])]);
  const orgName = (oSnap.exists ? oSnap.data().name : "") || ORG;
  const lines = [`Our company is "${orgName}".`];
  if (team.length) lines.push(`People on our own team (do NOT record them as prospect contacts): ${team.join(", ")}.`);
  if (terms.length) lines.push(`Our products / known names (use these exact spellings): ${terms.join(", ")}.`);
  return {
    extractContext: lines.length > 1 ? lines.join(" ") : null,
    whisperPrompt: uniq([...terms, ...team]).join(", ").slice(0, 800),
  };
}

// Rows come from a manifest CSV, or (single-author mode) every audio file in
// --dir attributed to --email.
let rows = MANIFEST
  ? parseManifest(MANIFEST)
  : walkAudio(DIR)
      .sort()
      .map((f) => ({ file: f, email: EMAIL, date: dateFromName(f), visibility: VISIBILITY }));
if (LIMIT) rows = rows.slice(0, LIMIT);

console.log(`Importing ${rows.length} note(s) into org "${ORG}"${DRY_RUN ? " (dry run)" : ""}\n`);

const grounding = await buildGrounding();

let ok = 0;
let skipped = 0;
const failures = [];
for (const row of rows) {
  const audioPath = join(DIR, row.file);
  try {
    if (!existsSync(audioPath)) throw new Error(`file not found: ${audioPath}`);
    const user = await auth.getUserByEmail(row.email);
    const id = memoId(user.uid, row.file);
    if (!DRY_RUN && (await db.doc(`orgs/${ORG}/memos/${id}`).get()).exists) {
      console.log(`  = ${row.file} (already imported)`);
      skipped++;
      continue;
    }
    const dateIso = row.date ? new Date(row.date).toISOString() : new Date().toISOString();
    const transcript = await transcriptFor(audioPath, grounding.whisperPrompt);
    if (!transcript) throw new Error("empty transcript");
    // Feed the account named in the filename as a strong company hint.
    const company = companyFromName(row.file);
    const orgContext = company
      ? `${grounding.extractContext ?? ""} This recording is a sales visit with the account "${company}" — use that as deal.company unless the transcript clearly names a different company.`.trim()
      : grounding.extractContext;
    const extraction = await extract(transcript, dateIso, orgContext);

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
      sourceFile: row.file,
      revisions: [{ at: new Date().toISOString(), byUid: user.uid, byName: name, action: "created" }],
    });
    console.log(`  ✓ ${row.file} -> #${seq} ${user.email}`);
    ok++;
  } catch (e) {
    failures.push({ file: row.file, message: e?.message || String(e) });
    console.log(`  ✗ ${row.file} -> ${e?.message || e}`);
  }
}

console.log(`\nDone: ${ok}/${rows.length} imported${skipped ? `, ${skipped} already present` : ""}.`);
if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f.file}: ${f.message}`);
  process.exit(1);
}
