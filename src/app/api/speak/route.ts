import { NextRequest } from "next/server";
import { getOpenAI, MODELS } from "@/lib/clients";
import { LIMITS } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = { text?: string; voice?: string };

// Allow-list of OpenAI TTS voice IDs. Anything outside this list falls back
// to the default. Keeps the route honest if the client ever sends garbage.
const VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

type OpenAIVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

export async function POST(req: NextRequest) {
  try {
    const { text, voice } = (await req.json()) as Body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return Response.json({ error: "Missing text." }, { status: 400 });
    }
    if (text.length > LIMITS.speakChars) {
      return Response.json(
        { error: `Text exceeds ${LIMITS.speakChars} character limit.` },
        { status: 413 },
      );
    }

    const selectedVoice: OpenAIVoice = voice && VOICES.has(voice) ? (voice as OpenAIVoice) : "nova";

    const audio = await getOpenAI().audio.speech.create({
      model: MODELS.tts,
      voice: selectedVoice,
      input: text,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await audio.arrayBuffer());
    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status =
      e && typeof e === "object" && "status" in e && typeof e.status === "number"
        ? e.status
        : 500;
    console.error("[speak] failed:", message, e);
    return Response.json({ error: message, source: "speak" }, { status });
  }
}
