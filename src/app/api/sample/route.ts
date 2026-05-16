import { NextRequest } from "next/server";
import { getAnthropic, MODELS } from "@/lib/clients";
import { SAMPLE_GENERATOR_SYSTEM } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(_req: NextRequest) {
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
