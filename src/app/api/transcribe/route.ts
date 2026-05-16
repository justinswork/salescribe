import { NextRequest } from "next/server";
import { getOpenAI, MODELS } from "@/lib/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return Response.json({ error: "Missing audio file in form field 'audio'." }, { status: 400 });
    }

    const result = await getOpenAI().audio.transcriptions.create({
      file: audio,
      model: MODELS.whisper,
      response_format: "json",
    });

    return Response.json({ transcript: result.text });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e && typeof e === "object" && "status" in e && typeof e.status === "number" ? e.status : 500;
    console.error("[transcribe] failed:", message, e);
    return Response.json({ error: message, source: "transcribe" }, { status });
  }
}
