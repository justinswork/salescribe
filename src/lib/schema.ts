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
      question_type: {
        type: "string",
        enum: ["gap", "history", "none"],
        description:
          "gap = filling a completeness-checklist item; history = referencing a past memo about this prospect; none = done=true.",
      },
      reasoning_internal: {
        type: "string",
        description:
          "1-sentence rationale: which gap or which past-memo signal drove this question, and why this is the most valuable thing to ask now. For debugging — not shown to the user.",
      },
    },
    required: ["done", "question", "question_type", "reasoning_internal"],
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
  question_type: "gap" | "history" | "none";
  reasoning_internal: string;
};

export type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

// -------------------------------------------------------------------------
// Pre-meeting briefing schema (used by /api/brief).
//
// The briefer reads multiple past memos for the same prospect and produces a
// structured Brief: state of the deal, key moments in the arc, open items,
// talking points, outstanding commitments by owner, and risk flags. Schema-
// bound output via Anthropic tool_use, same containment-by-schema pattern
// the extractor and coach use.
// -------------------------------------------------------------------------

export const briefToolSchema = {
  name: "submit_brief",
  description:
    "Submit the structured pre-meeting briefing for a prospect, synthesized across all the past memos provided. Call this exactly once.",
  input_schema: {
    type: "object" as "object",
    properties: {
      deal_status_summary: {
        type: "string",
        description:
          "1-2 paragraph narrative of where the deal currently stands. Past tense for what happened; present tense for current state. No projections.",
      },
      deal_arc: {
        type: "array",
        description:
          "Key moments in chronological order. Skip routine check-ins — only the moments that mattered (first contact, key stakeholder added, objection raised, commitment made, status change).",
        items: {
          type: "object",
          properties: {
            date_iso: { type: "string", description: "ISO 8601 date of the memo this moment came from." },
            event: { type: "string", description: "One sentence describing what happened or changed." },
          },
          required: ["date_iso", "event"],
        },
      },
      open_questions: {
        type: "array",
        items: { type: "string" },
        description:
          "Things the salesperson should clarify or ask in the upcoming meeting. Concrete, answerable. Skip if nothing genuinely open.",
      },
      talking_points: {
        type: "array",
        items: { type: "string" },
        description:
          "Things worth bringing up — unresolved objections to address, competitor positioning, value props that resonated, decision-maker dynamics to reinforce.",
      },
      outstanding_next_steps: {
        type: "array",
        description:
          "Concrete commitments made in past memos that haven't visibly been completed (no later memo confirms them done). Tag who owns each.",
        items: {
          type: "object",
          properties: {
            owner: {
              type: "string",
              enum: ["salesperson", "prospect", "unclear"],
            },
            action: { type: "string" },
            due_iso: { type: ["string", "null"] },
          },
          required: ["owner", "action", "due_iso"],
        },
      },
      risks: {
        type: "array",
        description:
          "Signals worth flagging — long silences, competitor gains, budget shrinkage, contradictions across memos, decision-maker uncertainty, deals that look stuck.",
        items: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["low", "medium", "high"] },
            description: { type: "string" },
          },
          required: ["level", "description"],
        },
      },
    },
    required: [
      "deal_status_summary",
      "deal_arc",
      "open_questions",
      "talking_points",
      "outstanding_next_steps",
      "risks",
    ],
  },
};

export type Brief = {
  deal_status_summary: string;
  deal_arc: Array<{ date_iso: string; event: string }>;
  open_questions: string[];
  talking_points: string[];
  outstanding_next_steps: Array<{
    owner: "salesperson" | "prospect" | "unclear";
    action: string;
    due_iso: string | null;
  }>;
  risks: Array<{
    level: "low" | "medium" | "high";
    description: string;
  }>;
};

export type MemoVisibility = "shared" | "private";

// A single field's before/after within an edit (rendered as a diff).
export type MemoChange = { field: string; from: string; to: string };

// One entry in a memo's edit history.
export type MemoRevision = {
  at: string;
  byUid: string;
  byName: string;
  action: "created" | "edited";
  // Field-level changes for an "edited" revision (empty/absent for "created").
  changes?: MemoChange[];
};

export type Memo = {
  id: string;
  created_iso: string;
  transcript: string;
  extraction: Extraction;
  chat: ChatMessage[];
  // User-facing, per-org sequential number (memo #1, #2, …), assigned at
  // creation from an org counter. Optional so pre-numbering memos still load.
  seq?: number;
  // Append-only edit log: who created/edited the memo and when.
  revisions?: MemoRevision[];
  // Team accounts: who recorded the memo, and whether the rest of the org can
  // see it. Optional so pre-team memos still typecheck; readers should treat a
  // missing visibility as "shared" and a missing authorUid as unknown.
  authorUid?: string;
  authorName?: string;
  visibility?: MemoVisibility;
  // Flag set by the demo-data loader so a "Clear demo data" action can find
  // every fictional memo and delete just those, leaving real ones alone.
  is_demo?: boolean;
};

// -------------------------------------------------------------------------
// Organizations (team accounts). A memo lives under orgs/{orgId}/memos and is
// visible to every member of that org unless marked private. See src/lib/org.ts
// for how a user resolves to an org, and firestore.rules for enforcement.
// -------------------------------------------------------------------------

export type OrgRole = "admin" | "member";

export type Org = {
  id: string;
  name: string;
  // The email domain this org owns (e.g. "vibrationresearch.com"). null for a
  // personal org backing a single webmail user.
  domain: string | null;
  personal: boolean;
  createdBy: string;
  created_iso: string;
};

export type OrgMember = {
  uid: string;
  email: string;
  displayName: string;
  role: OrgRole;
  joined_iso: string;
  // Mirrored from the user's profile so the roster can render their avatar
  // without reading every member's private profile doc.
  avatarColor?: string;
  photoURL?: string;
};

// A pending invite for an off-domain teammate. Doc id is the invited email
// (lowercased). Consumed via a join link; membership is gated on the invitee's
// verified email matching. Invited users join as "member"; an admin can
// promote them afterward.
export type Invite = {
  email: string;
  invitedBy: string;
  invitedByName: string;
  created_iso: string;
};

// Per-user pointer to the one org a user belongs to. Needed once membership is
// no longer purely domain-derived (an invited off-domain user's org differs
// from their email domain), so we remember it across sign-ins. Stored at
// users/{uid}, readable/writable only by that user.
export type UserProfile = {
  uid: string;
  orgId: string;
  role: OrgRole;
  email: string;
  displayName: string;
  // User-editable profile fields (see the profile page). avatarColor is one of
  // the identity palette hexes, or unset to use the auto (hashed) color.
  title?: string;
  avatarColor?: string;
  photoURL?: string;
};
