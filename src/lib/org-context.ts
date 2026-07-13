import "server-only";
import { getAdminDb } from "./firebase-admin";
import type { OrgGlossary } from "./schema";

// Server-side org grounding for the AI routes: builds the Whisper transcription
// prompt and the extractor's company-context block from the org's glossary +
// member roster. All reads go through the Admin SDK.

async function glossary(orgId: string): Promise<OrgGlossary> {
  const snap = await getAdminDb().doc(`orgs/${orgId}/config/glossary`).get();
  const d = snap.exists ? (snap.data() ?? {}) : {};
  return { terms: (d.terms as string[]) ?? [], teamNames: (d.teamNames as string[]) ?? [] };
}

async function memberNames(orgId: string): Promise<string[]> {
  const snap = await getAdminDb().collection(`orgs/${orgId}/members`).get();
  return snap.docs.map((d) => (d.data().displayName as string) || "").filter(Boolean);
}

async function orgName(orgId: string): Promise<string> {
  const snap = await getAdminDb().doc(`orgs/${orgId}`).get();
  return (snap.exists ? (snap.data()?.name as string) : "") || orgId;
}

function uniq(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)));
}

// A comma-separated vocabulary hint for Whisper's `prompt` (biases spelling of
// proper nouns). Capped well under Whisper's ~224-token prompt limit.
export async function whisperPromptFor(orgId: string): Promise<string | undefined> {
  const [g, members] = await Promise.all([glossary(orgId), memberNames(orgId)]);
  const words = uniq([...g.terms, ...g.teamNames, ...members]);
  if (words.length === 0) return undefined;
  return words.join(", ").slice(0, 800);
}

// A grounding block injected into the extractor: our company, our people (so
// they aren't filed as prospect contacts), and our known terms (spell exactly).
export async function extractionContextFor(orgId: string): Promise<string | null> {
  const [name, g, members] = await Promise.all([orgName(orgId), glossary(orgId), memberNames(orgId)]);
  const team = uniq([...members, ...g.teamNames]);
  const lines = [`Our company is "${name}".`];
  if (team.length) {
    lines.push(
      `People on our own team (do NOT record them as prospect contacts): ${team.join(", ")}.`,
    );
  }
  if (g.terms.length) {
    lines.push(`Our products / known names (use these exact spellings): ${g.terms.join(", ")}.`);
  }
  return lines.length > 1 ? lines.join(" ") : null;
}
