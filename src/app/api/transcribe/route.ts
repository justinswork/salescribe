import { NextRequest } from "next/server";
import { openai, MODELS } from "@/lib/clients";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const audio = formData.get("audio");

  if (!(audio instanceof File)) {
    return Response.json({ error: "Missing audio file in form field 'audio'." }, { status: 400 });
  }

  const result = await openai.audio.transcriptions.create({
    file: audio,
    model: MODELS.whisper,
    response_format: "json",
  });

  return Response.json({ transcript: result.text });
}
