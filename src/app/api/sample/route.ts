import { NextRequest } from "next/server";
import { getAnthropic, MODELS } from "@/lib/clients";
import { authorize } from "@/lib/auth";
import { recordUsage } from "@/lib/ratelimit";
import { SAMPLE_GENERATOR_SYSTEM } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const principal = await authorize(req);
  if (principal instanceof Response) return principal;

  try {
    const response = await getAnthropic().messages.create({
      model: MODELS.extractor,
      max_tokens: 600,
      temperature: 1,
      system: SAMPLE_GENERATOR_SYSTEM,
      messages: [
        {
          role: "user",
          content:
            "Generate one realistic voice-memo transcript now. Output the transcript text only — no quotes, no preamble, no commentary.",
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
    );
    if (!textBlock) {
      throw new Error("Model returned no text content.");
    }

    // Defensive cleanup: strip wrapping quotes if the model adds them despite
    // being told not to. trim() handles leading/trailing whitespace.
    let transcript = textBlock.text.trim();
    if (
      (transcript.startsWith('"') && transcript.endsWith('"')) ||
      (transcript.startsWith("'") && transcript.endsWith("'"))
    ) {
      transcript = transcript.slice(1, -1).trim();
    }

    if (principal.kind === "user") {
      void recordUsage(
        principal.uid,
        (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
      );
    }

    return Response.json({ transcript });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status =
      e && typeof e === "object" && "status" in e && typeof e.status === "number"
        ? e.status
        : 500;
    console.error("[sample] failed:", message, e);
    return Response.json({ error: message, source: "sample" }, { status });
  }
}
