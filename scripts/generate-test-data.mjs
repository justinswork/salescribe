#!/usr/bin/env node
// Generates synthetic voice-memo data for the Salescribe test roster.
//
// For each beat in scripts/test-roster.mjs, this script:
//   1. Asks Claude to write a realistic dictated transcript matching the beat,
//      the customer arc, and the prior memos in that arc (for continuity).
//   2. POSTs that transcript to a running /api/extract endpoint to produce a
//      real Extraction (so the data is bit-compatible with what the live app
//      produces from real recordings — same prompts, same model, same schema).
//   3. Stamps the memo with a backdated `created_iso` so the collection looks
//      like a year of weekly memos rather than a batch of "right now" memos.
//
// Output: public/demo-data.json — a single JSON file containing all memos,
// ready for the in-app "Load demo data" button to write into Firestore.
//
// Usage (from the repo root):
//   npm run dev                                          # in one terminal
//   node scripts/generate-test-data.mjs                  # in another
//
// Or target a deployed instance:
//   SALESCRIBE_URL=https://salescribe--salescribe-2532a.us-east4.hosted.app \
//     node scripts/generate-test-data.mjs
//
// Cost: ~88 Anthropic transcript generations + ~88 /api/extract calls.
// At ~$0.01-0.02 per call, roughly $2-$4 of Anthropic credit per full run.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { CUSTOMERS, PERSONA, rosterStats } from "./test-roster.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REFERENCE_NOW = new Date(process.env.REFERENCE_NOW ?? Date.now());
const SALESCRIBE_URL = process.env.SALESCRIBE_URL ?? "http://localhost:3000";
const MODEL = "claude-sonnet-4-6";
const MAX_PRIOR_BEATS_IN_CONTEXT = 4;
const OUTPUT_PATH = path.join(PROJECT_ROOT, "public", "demo-data.json");

// ---------------------------------------------------------------------------
// API key — read from env first, fall back to .env.local so the script works
// the same way the dev server does.
// ---------------------------------------------------------------------------
function readKey(name) {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    const raw = readFileSync(path.join(PROJECT_ROOT, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      if (line.slice(0, eq).trim() !== name) continue;
      const value = line.slice(eq + 1).trim();
      if (value.length > 0) return value;
    }
  } catch {
    // .env.local doesn't exist — fall through.
  }
  return undefined;
}

const anthropic = new Anthropic({ apiKey: readKey("ANTHROPIC_API_KEY") });

// ---------------------------------------------------------------------------
// System prompt for the transcript generator. Distinct from SAMPLE_GENERATOR_SYSTEM
// in src/lib/prompts.ts because that one targets standalone "try a sample" memos;
// this one needs to maintain continuity across a multi-memo arc and bind to a
// specific customer + beat.
// ---------------------------------------------------------------------------
const TRANSCRIPT_SYSTEM = `You write realistic dictated voice-memo transcripts for a fictional B2B salesperson named ${PERSONA.name}, a ${PERSONA.role} at ${PERSONA.vendor}.

About the product: ${PERSONA.vendor_product}

Voice characteristics:
- ${PERSONA.voice_notes}
- 60-180 words. The length of an actual dictated memo.
- First-person from ${PERSONA.name}'s perspective.
- Past tense for what happened in the conversation; future tense or relative terms ("tomorrow", "Friday", "next week") for next steps. Never use specific calendar dates.
- Memos are spontaneous and slightly messy. Do NOT produce a perfectly organized summary; produce something a real person would dictate while driving.

You will receive: the customer (company, industry, contacts), the deal arc type, this memo's position in that arc (the "beat" — what happened in this specific conversation), and summaries of prior memos in the arc for continuity.

Output ONLY the transcript text. No quotes around it, no preamble like "Here's the memo:", no commentary. Just the raw transcript.

Maintain continuity: if a prior memo mentioned a competitor, budget signal, or specific commitment, this memo can reference those naturally if the beat calls for it. But don't repeat the whole arc — focus on what happened today.`;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function backdate(weeksAgo) {
  const d = new Date(REFERENCE_NOW);
  d.setDate(d.getDate() - weeksAgo * 7);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Per-memo work
// ---------------------------------------------------------------------------
async function generateTranscript({ customer, beat, beatIndex, priorBeats }) {
  const contactsLine = customer.contacts
    .map((c) => `${c.name} (${c.role})${c.primary ? " — primary contact" : ""}`)
    .join(", ");

  const priorContext =
    priorBeats.length === 0
      ? "This is the first memo about this customer — no prior context."
      : "Prior memos in this arc (oldest first, for continuity):\n" +
        priorBeats
          .slice(-MAX_PRIOR_BEATS_IN_CONTEXT)
          .map((b, i) => `${i + 1}. ${b.event}`)
          .join("\n");

  const userMsg = `Customer: ${customer.company} (${customer.industry})
Contacts in this account: ${contactsLine}
Deal arc type: ${customer.arc_type}
This memo is number ${beatIndex + 1} of ${customer.beats.length} in the arc.

${priorContext}

Today's beat — what happened in this specific conversation that ${PERSONA.name} just walked out of:
${beat.event}

Write the voice memo ${PERSONA.name} would have dictated right after this conversation.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    temperature: 0.9,
    system: TRANSCRIPT_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("transcript generator returned no text block");
  let transcript = textBlock.text.trim();
  // Defensive: strip wrapping quotes if the model adds them despite instructions.
  if (
    (transcript.startsWith('"') && transcript.endsWith('"')) ||
    (transcript.startsWith("'") && transcript.endsWith("'"))
  ) {
    transcript = transcript.slice(1, -1).trim();
  }
  return transcript;
}

async function extract({ transcript, reference_now_iso }) {
  const r = await fetch(`${SALESCRIBE_URL}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, chat: [], reference_now_iso }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`/api/extract HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  if (!data.extraction) throw new Error("/api/extract returned no extraction field");
  return data.extraction;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!readKey("ANTHROPIC_API_KEY")) {
    console.error("ANTHROPIC_API_KEY not found in env or .env.local. Aborting.");
    process.exit(1);
  }

  // Smoke-test the extract endpoint before doing real work.
  try {
    const probe = await fetch(`${SALESCRIBE_URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (probe.status !== 400) {
      console.warn(
        `[warn] /api/extract probe returned ${probe.status} — expected 400 for empty body. Is the server actually running at ${SALESCRIBE_URL}?`,
      );
    }
  } catch (e) {
    console.error(`Couldn't reach ${SALESCRIBE_URL}/api/extract: ${e.message}`);
    console.error('Start the dev server with "npm run dev" or set SALESCRIBE_URL to a deployed instance.');
    process.exit(1);
  }

  const stats = rosterStats();
  console.log(
    `Generating ${stats.total} memos across ${stats.customers} customers.\nReference now: ${REFERENCE_NOW.toISOString()}\nExtract endpoint: ${SALESCRIBE_URL}/api/extract\n`,
  );

  const memos = [];
  let n = 0;
  const startTime = Date.now();

  for (const customer of CUSTOMERS) {
    const priorBeats = [];
    for (let i = 0; i < customer.beats.length; i++) {
      const beat = customer.beats[i];
      n++;
      const reference_now_iso = backdate(beat.weeks_ago);

      process.stdout.write(
        `[${String(n).padStart(2, "0")}/${stats.total}] ${customer.company} — beat ${i + 1}/${customer.beats.length} (${beat.weeks_ago}w ago)... `,
      );

      let transcript, extraction;
      try {
        transcript = await generateTranscript({ customer, beat, beatIndex: i, priorBeats });
        extraction = await extract({ transcript, reference_now_iso });
      } catch (e) {
        console.log(`\n  ERROR: ${e.message}`);
        throw e;
      }

      memos.push({
        id: `demo-${customer.id}-${String(i + 1).padStart(2, "0")}`,
        created_iso: reference_now_iso,
        transcript,
        extraction,
        chat: [],
        is_demo: true,
      });
      priorBeats.push(beat);

      const transcriptPreview = transcript.replace(/\s+/g, " ").slice(0, 60);
      console.log(`ok (${transcript.length}ch): "${transcriptPreview}…"`);
    }
  }

  // Sort newest-first so the JSON's natural order matches how MemoHistory renders.
  memos.sort((a, b) => b.created_iso.localeCompare(a.created_iso));

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        persona: PERSONA,
        generated_at: new Date().toISOString(),
        reference_now: REFERENCE_NOW.toISOString(),
        memo_count: memos.length,
        customer_count: CUSTOMERS.length,
        memos,
      },
      null,
      2,
    ),
  );

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nWrote ${memos.length} memos to ${path.relative(PROJECT_ROOT, OUTPUT_PATH)} in ${elapsedSeconds}s.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
