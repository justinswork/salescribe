// Extraction schema — the contract between the LLM, the API routes, and the UI.
// Defined as a JSON Schema (for the Anthropic tool_use parameter) and mirrored as a
// TypeScript type so the rest of the app gets compile-time checks for free.

export const extractionToolSchema = {
  name: "submit_extraction",
  description:
    "Submit the structured extraction from a salesperson's voice memo. Always call this exactly once.",
  input_schema: {
    type: "object" as "object",
    properties: {
      summary: {
        type: "string",
        description:
          "1-2 sentence factual summary of what happened. Past tense. No editorializing.",
      },
      calendar_events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            start_iso: {
              type: "string",
              description:
                "ISO 8601 timestamp with timezone offset (e.g. 2026-05-16T15:00:00-04:00). Resolved against reference_now_iso.",
            },
            end_iso: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            attendees: { type: "array", items: { type: "string" } },
            notes: { type: ["string", "null"] },
          },
          required: ["title", "start_iso", "end_iso", "location", "attendees", "notes"],
        },
      },
      reminders: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            due_iso: { type: ["string", "null"] },
          },
          required: ["text", "due_iso"],
        },
      },
      contacts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: ["string", "null"] },
            company: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
          },
          required: ["name", "role", "company", "notes"],
        },
      },
      deal: {
        type: ["object", "null"],
        description:
          "Set to null if the memo contains no sales-deal content (e.g., a personal reminder).",
        properties: {
          company: { type: ["string", "null"] },
          prospect_name: { type: ["string", "null"] },
          stated_problem: { type: ["string", "null"] },
          budget_signals: { type: ["string", "null"] },
          decision_makers: { type: ["string", "null"] },
          objections: { type: ["string", "null"] },
          competitors: { type: ["string", "null"] },
          next_step: { type: ["string", "null"] },
          next_step_due_iso: { type: ["string", "null"] },
        },
        required: [
          "company",
          "prospect_name",
          "stated_problem",
          "budget_signals",
          "decision_makers",
          "objections",
          "competitors",
          "next_step",
          "next_step_due_iso",
        ],
      },
    },
    required: ["summary", "calendar_events", "reminders", "contacts", "deal"],
  },
};

export const followupToolSchema = {
  name: "submit_followup",
  description:
    "Submit the next coaching question, or signal that no further questions are needed.",
  input_schema: {
    type: "object" as "object",
    properties: {
      done: {
        type: "boolean",
        description:
          "True when the note is reasonably complete or after 3 follow-ups already asked.",
      },
      question: {
        type: "string",
        description:
          "The next question to ask the salesperson. Empty string when done=true.",
      },
      reasoning_internal: {
        type: "string",
        description:
          "1-sentence rationale: which gap from the checklist this targets and why this one now. For debugging — not shown to the user.",
      },
    },
    required: ["done", "question", "reasoning_internal"],
  },
};

export type Extraction = {
  summary: string;
  calendar_events: Array<{
    title: string;
    start_iso: string;
    end_iso: string | null;
    location: string | null;
    attendees: string[];
    notes: string | null;
  }>;
  reminders: Array<{ text: string; due_iso: string | null }>;
  contacts: Array<{
    name: string;
    role: string | null;
    company: string | null;
    notes: string | null;
  }>;
  deal: {
    company: string | null;
    prospect_name: string | null;
    stated_problem: string | null;
    budget_signals: string | null;
    decision_makers: string | null;
    objections: string | null;
    competitors: string | null;
    next_step: string | null;
    next_step_due_iso: string | null;
  } | null;
};

export type FollowupResult = {
  done: boolean;
  question: string;
  reasoning_internal: string;
};

export type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};
