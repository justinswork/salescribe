import { NextRequest } from "next/server";
import { MODELS } from "@/lib/clients";
import { authorize } from "@/lib/auth";
import { openaiFor } from "@/lib/ai";
import { getUserOrgId } from "@/lib/org-keys";
import { whisperPromptFor } from "@/lib/org-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const principal = await authorize(req);
  if (principal instanceof Response) return principal;

  const openai = await openaiFor(principal);
  if (openai instanceof Response) return openai;

  try {
    const formData = await req.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return Response.json({ error: "Missing audio file in form field 'audio'." }, { status: 400 });
    }

    // Bias Whisper toward the org's proper nouns (product names, teammates,
    // known companies) so domain terms are spelled correctly.
    let prompt: string | undefined;
    if (principal.kind === "user") {
      const orgId = await getUserOrgId(principal.uid);
      if (orgId) prompt = await whisperPromptFor(orgId);
    }

    const result = await openai.audio.transcriptions.create({
      file: audio,
      model: MODELS.whisper,
      response_format: "json",
      prompt,
    });

    return Response.json({ transcript: result.text });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e && typeof e === "object" && "status" in e && typeof e.status === "number" ? e.status : 500;
    console.error("[transcribe] failed:", message, e);
    return Response.json({ error: message, source: "transcribe" }, { status });
  }
}
