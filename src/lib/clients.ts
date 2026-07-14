import "server-only";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AzureMapsConfig } from "./azure-maps";

// Read a key from process.env, falling back to .env.local on disk if the env var
// is missing OR explicitly empty. The fallback only matters for local dev under
// agent harnesses (like Claude Code) that scrub certain env vars in subprocesses;
// in production the env var is set by the platform and the fallback short-circuits.
function readKey(name: string): string | undefined {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      if (line.slice(0, eq).trim() !== name) continue;
      const value = line.slice(eq + 1).trim();
      if (value.length > 0) return value;
    }
  } catch {
    // .env.local doesn't exist (e.g. production) — fall through.
  }
  return undefined;
}

// Lazy singletons. We construct the SDK clients on first use rather than at module
// load so they don't throw during Next.js's "collect page data" step at build time,
// where no API keys are available (Firebase App Hosting injects secrets at runtime,
// not at build time).
let _anthropic: Anthropic | undefined;
let _openai: OpenAI | undefined;

export function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = readKey("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

export function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = readKey("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

// Azure Maps (Entra) credentials from the environment (.env.local / platform
// env). The fallback for local dev + service callers, the same way getAnthropic()
// backstops bring-your-own-key orgs. Returns undefined unless all four are set.
export function azureMapsCredsFromEnv(): AzureMapsConfig | undefined {
  const tenantId = readKey("AZURE_MAPS_TENANT_ID");
  const clientId = readKey("AZURE_MAPS_CLIENT_ID");
  const clientSecret = readKey("AZURE_MAPS_CLIENT_SECRET");
  const mapsClientId = readKey("AZURE_MAPS_ACCOUNT_CLIENT_ID");
  if (tenantId && clientId && clientSecret && mapsClientId) {
    return { tenantId, clientId, clientSecret, mapsClientId };
  }
  return undefined;
}

// Per-call clients built from a caller-supplied key (used for bring-your-own-key
// orgs). Not cached — each org's key gets its own client.
export function newAnthropic(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

export function newOpenAI(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

export const MODELS = {
  extractor: "claude-sonnet-4-6",
  coach: "claude-sonnet-4-6",
  whisper: "whisper-1",
} as const;
