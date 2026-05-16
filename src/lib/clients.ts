import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const MODELS = {
  extractor: "claude-sonnet-4-6",
  coach: "claude-sonnet-4-6",
  whisper: "whisper-1",
} as const;
