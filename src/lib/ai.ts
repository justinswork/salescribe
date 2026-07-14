import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { getAnthropic, getOpenAI, newAnthropic, newOpenAI, azureMapsCredsFromEnv } from "./clients";
import { getOrgKeys, getUserOrgId } from "./org-keys";
import type { AzureMapsConfig } from "./azure-maps";
import type { Principal } from "./auth";

// Resolve the AI client to use for a request. Real signed-in users use their
// org's own key (bring-your-own-key, required per org). The eval harness
// (service token) and local dev fall back to the app's env key so those keep
// working. Returns a 400 Response when a user's org hasn't configured the
// needed key — the route returns it directly.

function needsKey(provider: "Anthropic" | "OpenAI" | "Azure Maps"): Response {
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

// Resolve the Azure Maps (Entra) credentials for a request. Real users use their
// org's configured credentials; the eval harness and local dev fall back to the
// AZURE_MAPS_* env vars. Returns a 400 Response when they're missing/incomplete,
// which the route returns directly.
export async function azureMapsCredsFor(p: Principal): Promise<AzureMapsConfig | Response> {
  if (p.kind !== "user") {
    const env = azureMapsCredsFromEnv();
    if (!env) {
      return Response.json(
        {
          error:
            "Azure Maps isn't configured. Set AZURE_MAPS_TENANT_ID, AZURE_MAPS_CLIENT_ID, " +
            "AZURE_MAPS_CLIENT_SECRET, and AZURE_MAPS_ACCOUNT_CLIENT_ID in the environment.",
          code: "geocoding_key_missing",
        },
        { status: 400 },
      );
    }
    return env;
  }
  const orgId = await getUserOrgId(p.uid);
  const keys = orgId ? await getOrgKeys(orgId) : {};
  const am = keys.azureMaps;
  if (!am?.tenantId || !am?.clientId || !am?.clientSecret || !am?.mapsClientId) {
    return needsKey("Azure Maps");
  }
  return {
    tenantId: am.tenantId,
    clientId: am.clientId,
    clientSecret: am.clientSecret,
    mapsClientId: am.mapsClientId,
  };
}
