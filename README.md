# Salescribe

**Voice memos → structured sales notes, with proactive follow-up coaching.**

A traveling B2B salesperson dictates a memo between meetings. Salescribe transcribes it, extracts calendar events / reminders / contacts / deal context, then asks one short follow-up question to fill the most important missing piece — like a sales coach riding shotgun.

> Submitted for: Generative AI class, Weeks 1–2 (theme: prompting & grounding).

## Live demo

Deployed at: **(URL will be added after Vercel deploy)**

## How it works

```
audio blob ─▶ /api/transcribe (Whisper)
              │
              └─▶ transcript ─▶ /api/extract (Claude Sonnet 4.6 + tool_use)
                                │
                                └─▶ extraction JSON ─▶ /api/followup (Claude Sonnet 4.6 + tool_use)
                                                       │
                                                       ├─▶ next coaching question  ─▶ user replies ─▶ loop
                                                       └─▶ done=true
```

Two separate system prompts power the app:

- **`EXTRACTOR_SYSTEM`** — schema-driven, low-creativity, hard rule "never invent facts." Returns structured JSON via Anthropic's `tool_use`.
- **`COACH_SYSTEM`** — warm and conversational. Grounded against a *completeness checklist* (WHO / WHAT / WHY NOW / BUDGET / DECISION / COMPETITION / OBJECTIONS / NEXT STEP / TIMELINE) and asked to pick the single most valuable gap.

Both live in [`src/lib/prompts.ts`](src/lib/prompts.ts).

## Running locally

```bash
git clone https://github.com/justinswork/salescribe.git
cd salescribe
npm install
cp .env.local.example .env.local
# add your ANTHROPIC_API_KEY and OPENAI_API_KEY
npm run dev
```

Open <http://localhost:3000>.

## Evaluation

A small held-out set of synthetic memos lives in [`evals/cases.mjs`](evals/cases.mjs). Each case asserts specific behaviors — not full equality, since extraction wording varies — like "company should contain 'Northwind'" or "no invented dates from a vague memo."

```bash
npm run dev            # in one terminal
npm run eval           # in another
```

Set `SALESCRIBE_URL=https://your-deploy.example.com` to eval the deployed version instead of localhost.

### What the eval set probes

| Case | What it stresses |
|------|------------------|
| `01-canonical-discovery-call` | Full-stack extraction: deal fields, contacts, budget, competitor, dated next-step |
| `02-personal-reminder-no-deal` | Refuses to fabricate a deal when none exists |
| `03-calendar-event-only` | Relative date math, attendee parsing, location capture |
| `04-self-correction` | Honors mid-sentence corrections ("Tuesday — actually Wednesday") |
| `05-vague-memo-no-fabrication` | Anti-hallucination: vague memo must produce mostly empty fields |

## Build log

### Concept

The interesting problem is *not* transcription — Whisper + a chat model would give you that in 30 lines. The interesting problem is **gap-finding**: a hurried salesperson dictating from the parking lot will skip the budget signal or forget to name the decision-maker. A generic chatbot won't notice. A purpose-built coach with a model of what a "complete" sales note looks like can.

That's what makes the *follow-up* layer the centerpiece. The extraction is supporting infrastructure.

### Prompt design decisions

**Separate system prompts for separate jobs.** A single system prompt that says "extract data AND chat with the user" performed worse in early tests — extractions got chatty (preambles, hedging) and the chat got rigid. Splitting into two prompts with different goals, tones, and tool schemas cleaned both behaviors up.

**Structured output via `tool_use`, not freeform JSON.** Early version asked the model to "respond with only a JSON object." It occasionally wrapped output in ```` ```json ```` fences. Switching to Anthropic's `tool_use` with `tool_choice: { type: "tool", name: "submit_extraction" }` made the schema a hard contract. No more parsing failures.

**`reference_now_iso` as injected grounding.** First version asked the model to "assume today is the current date." It frequently used training-cutoff dates or generic placeholders. Injecting an ISO 8601 timestamp into the user message lets the model do honest relative-date math and respect timezone offsets.

**The completeness checklist is the grounding for the coach.** Rather than hard-coding follow-up rules ("if budget is null, ask 'what's the budget?'"), the system prompt names what a healthy sales note contains and lets the model pick the most valuable gap given context. This handles cases like "don't ask about budget on a first discovery call" gracefully where a rules engine would over-ask.

**3-question cap, enforced in code.** The prompt says "after at most 3 follow-up questions, set done=true," but I also enforce the cap server-side in `/api/followup`. Belt-and-suspenders: the model is consistent enough about this, but a runaway question loop is the kind of failure mode that would be annoying live, so it's worth the redundancy.

### Iterations against the eval set

- **v1 (no `reference_now_iso`):** Failed `03-calendar-event-only` and `04-self-correction` because the model anchored to its training cutoff for "tomorrow." Fix: inject the current ISO timestamp.
- **v1 (no anti-fabrication rule):** Failed `05-vague-memo-no-fabrication` — the model invented a company name from "had a good call." Fix: explicit "NEVER invent facts" rule, plus the schema permits null on every field.
- **v1 coach prompt:** Asked multi-part questions and praised the user ("Great memo! Quick thing — what's the budget? Also who's the decision-maker?"). Fix: explicit rules "one question, max 20 words" and "Never start with 'Great memo!' or similar filler."

### What I'd do next

- **Calendar export.** Right now extracted events live in the UI. Adding `.ics` download or a Google Calendar OAuth link would close the loop.
- **Speaker-side voice replies.** The follow-up is text-only; the demo asks you to type. A voice reply mode would be a more honest demo of the use case.
- **Memo history.** No persistence right now. Adding a sidebar of past memos (even just `localStorage`) would make repeat use feel real.
- **Vertical drift.** "Sales coach" is a strong demo because it's specific, but the same pattern works for therapist intake notes, doctor visit recaps, parent-teacher conference notes, anything where a structured memo benefits from a domain checklist.

### Where it breaks

- **Long memos (>2-3 minutes).** Whisper is fine, but the extraction prompt isn't optimized for long transcripts and the coach occasionally asks about something already mentioned deep in the text.
- **Heavy proper-noun memos.** Whisper transcribes "Karen Holloway" reliably; obscure company names sometimes get mangled and the extraction inherits the mangling. Live correction in the transcript view would help.
- **Mid-sentence topic switches.** "Met with Karen — oh actually let me also remind myself to grab milk" can confuse the deal/reminder boundary.

## Stack

- **Next.js 16** (App Router, Route Handlers)
- **OpenAI Whisper** (`whisper-1`) for transcription
- **Anthropic Claude Sonnet 4.6** (`claude-sonnet-4-6`) for extraction and follow-up
- **Tailwind v4** for UI
- **Vercel** for hosting

## Code structure

```
src/
├── app/
│   ├── api/
│   │   ├── transcribe/route.ts   # Whisper
│   │   ├── extract/route.ts      # Claude extractor + tool_use
│   │   └── followup/route.ts     # Claude coach + tool_use
│   ├── layout.tsx
│   └── page.tsx                  # main UI + state machine
├── components/
│   ├── Recorder.tsx              # MediaRecorder client component
│   └── ExtractionView.tsx        # renders the structured fields
└── lib/
    ├── clients.ts                # SDK clients + model IDs
    ├── prompts.ts                # both system prompts + completeness checklist
    └── schema.ts                 # JSON Schemas + mirrored TS types
evals/
├── cases.mjs                     # eval set
└── run.mjs                       # eval runner
```
