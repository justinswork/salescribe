import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { getAnthropic, getOpenAI, newAnthropic, newOpenAI } from "./clients";
import { getOrgKeys, getUserOrgId } from "./org-keys";
import type { Principal } from "./auth";

// Resolve the AI client to use for a request. Real signed-in users use their
// org's own key (bring-your-own-key, required per org). The eval harness
// (service token) and local dev fall back to the app's env key so those keep
// working. Returns a 400 Response when a user's org hasn't configured the
// needed key — the route returns it directly.

function needsKey(provider: "Anthropic" | "OpenAI"): Response {
  return Response.json(
    {
      error: `Your organization hasn't set its ${provider} API key yet. An admin can add it under Team settings.`,
      code: "org_key_missing",
    },
    { status: 400 },
  );
}

export async function anthropicFor(p: Principal): Promise<Anthropic | Response> {
  if (p.kind !== "user") return getAnthropic();
  const orgId = await getUserOrgId(p.uid);
  const keys = orgId ? await getOrgKeys(orgId) : {};
  if (!keys.anthropic) return needsKey("Anthropic");
  return newAnthropic(keys.anthropic);
}

export async function openaiFor(p: Principal): Promise<OpenAI | Response> {
  if (p.kind !== "user") return getOpenAI();
  const orgId = await getUserOrgId(p.uid);
  const keys = orgId ? await getOrgKeys(orgId) : {};
  if (!keys.openai) return needsKey("OpenAI");
  return newOpenAI(keys.openai);
}
