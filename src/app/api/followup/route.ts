import { NextRequest } from "next/server";
import { getAnthropic, MODELS } from "@/lib/clients";
import { COACH_SYSTEM } from "@/lib/prompts";
import { followupToolSchema, type Extraction, type ChatMessage, type FollowupResult, type Memo } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = {
  transcript: string;
  extraction: Extraction;
  chat: ChatMessage[];
  related_past_memos?: Memo[];
};

const MAX_FOLLOWUPS = 3;

// Trim a past memo to just the fields useful for grounding, so we don't blow the
// context window on long transcripts that won't help the coach decide what to ask.
function compactMemo(m: Memo): object {
  return {
    date: m.created_iso,
    summary: m.extraction.summary,
    deal: m.extraction.deal,
    contacts: m.extraction.contacts,
    open_reminders: m.extraction.reminders,
  };
}

export async function POST(req: NextRequest) {
  const { transcript, extraction, chat, related_past_memos = [] } = (await req.json()) as Body;

  if (!transcript || !extraction) {
    return Response.json({ error: "Missing transcript or extraction." }, { status: 400 });
  }

  const askedSoFar = chat.filter((m) => m.role === "assistant").length;
  if (askedSoFar >= MAX_FOLLOWUPS) {
    const result: FollowupResult = {
      done: true,
      question: "",
      question_type: "none",
      reasoning_internal: "Hit the 3-question cap; stopping to respect the salesperson's time.",
    };
    return Response.json({ result });
  }

  const dialogue =
    chat.length > 0
      ? chat
          .map((m) => `${m.role === "assistant" ? "You (Coach)" : "Salesperson"}: ${m.content}`)
          .join("\n")
      : "(no dialogue yet)";

  const pastBlock =
    related_past_memos.length > 0
      ? `\n\nRelated past memos for this prospect/company (most recent first):
${JSON.stringify(related_past_memos.map(compactMemo), null, 2)}`
      : "";

  const userContent = `Original transcript:
${transcript}

Extracted fields (JSON):
${JSON.stringify(extraction, null, 2)}

Dialogue so far:
${dialogue}${pastBlock}

Decide: is the note reasonably complete? If yes, set done=true. If no, choose question_type and ask the single most valuable follow-up.`;

  const response = await getAnthropic().messages.create({
    model: MODELS.coach,
    max_tokens: 512,
    system: COACH_SYSTEM,
    tools: [followupToolSchema],
    tool_choice: { type: "tool", name: followupToolSchema.name },
    messages: [{ role: "user", content: userContent }],
  });

  const toolBlock = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );

  if (!toolBlock) {
    return Response.json(
      { error: "Model did not return a tool_use block." },
      { status: 502 },
    );
  }

  return Response.json({ result: toolBlock.input as FollowupResult });
}
