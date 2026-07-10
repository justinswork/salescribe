import "server-only";
import { getAdminDb } from "./firebase-admin";

// Per-org API keys (bring-your-own-key), stored at orgs/{orgId}/private/keys.
// That path is server-only: Firestore rules deny all client access, and only
// the Admin SDK (which bypasses rules) reads/writes it here. Keys are never
// sent back to the client — the UI only ever learns whether they're set.
//
// Note: this stores raw keys in Firestore (encrypted at rest by Google, and
// unreadable by clients). A production-grade version would additionally
// envelope-encrypt them with a KMS key.

export type OrgKeys = { anthropic?: string; openai?: string };

function keysRef(orgId: string) {
  return getAdminDb().collection("orgs").doc(orgId).collection("private").doc("keys");
}

// The org a user belongs to, from their profile doc (authoritative even for
// invited off-domain users). Null if they have no profile yet.
export async function getUserOrgId(uid: string): Promise<string | null> {
  const snap = await getAdminDb().collection("users").doc(uid).get();
  return snap.exists ? ((snap.data()?.orgId as string) ?? null) : null;
}

export async function isOrgAdmin(orgId: string, uid: string): Promise<boolean> {
  const snap = await getAdminDb().collection("orgs").doc(orgId).collection("members").doc(uid).get();
  return snap.exists && snap.data()?.role === "admin";
}

export async function getOrgKeys(orgId: string): Promise<OrgKeys> {
  const snap = await keysRef(orgId).get();
  if (!snap.exists) return {};
  const d = snap.data() ?? {};
  return { anthropic: d.anthropic as string | undefined, openai: d.openai as string | undefined };
}

// Set/replace keys. Only the provided keys are written (merge), so an admin can
// update one without clearing the other. An empty string clears a key.
export async function setOrgKeys(orgId: string, keys: OrgKeys, byUid: string): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: Date.now(), updatedBy: byUid };
  if (keys.anthropic !== undefined) patch.anthropic = keys.anthropic.trim() || null;
  if (keys.openai !== undefined) patch.openai = keys.openai.trim() || null;
  await keysRef(orgId).set(patch, { merge: true });
}

export async function orgKeyStatus(orgId: string): Promise<{ hasAnthropic: boolean; hasOpenai: boolean }> {
  const keys = await getOrgKeys(orgId);
  return { hasAnthropic: Boolean(keys.anthropic), hasOpenai: Boolean(keys.openai) };
}
