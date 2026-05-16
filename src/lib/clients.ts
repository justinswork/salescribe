import "server-only";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

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

export const anthropic = new Anthropic({ apiKey: readKey("ANTHROPIC_API_KEY") });
export const openai = new OpenAI({ apiKey: readKey("OPENAI_API_KEY") });

export const MODELS = {
  extractor: "claude-sonnet-4-6",
  coach: "claude-sonnet-4-6",
  whisper: "whisper-1",
} as const;
