import { NextRequest } from "next/server";
import { getAnthropic, MODELS } from "@/lib/clients";
import { EXTRACTOR_SYSTEM } from "@/lib/prompts";
import { extractionToolSchema, type Extraction, type ChatMessage } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = {
  transcript: string;
  chat?: ChatMessage[];
  reference_now_iso?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const { transcript, chat = [], reference_now_iso } = body;

  if (!transcript || typeof transcript !== "string") {
    return Response.json({ error: "Missing transcript." }, { status: 400 });
  }

  const now = reference_now_iso ?? new Date().toISOString();

  // The dialogue addendum lets follow-up replies enrich the same extraction without
  // forcing the model to re-process a stitched-together transcript that doesn't
  // resemble natural speech.
  const dialogueAddendum =
    chat.length > 0
      ? "\n\nFollow-up dialogue (treat as additional information from the salesperson):\n" +
        chat.map((m) => `${m.role === "assistant" ? "Coach" : "Salesperson"}: ${m.content}`).join("\n")
      : "";

  const userContent = `reference_now_iso: ${now}

Transcript:
${transcript}${dialogueAddendum}`;

  const response = await getAnthropic().messages.create({
    model: MODELS.extractor,
    max_tokens: 2048,
    system: EXTRACTOR_SYSTEM,
    tools: [extractionToolSchema],
    tool_choice: { type: "tool", name: extractionToolSchema.name },
    messages: [{ role: "user", content: userContent }],
  });

  const toolBlock = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );

  if (!toolBlock) {
    return Response.json(
      { error: "Model did not return a tool_use block.", raw: response.content },
      { status: 502 },
    );
  }

  const extraction = toolBlock.input as Extraction;
  return Response.json({ extraction });
}
