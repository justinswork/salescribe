"use client";

// Resolves a signed-in user to their organization, creates the org/membership
// on first sign-in, and exposes the admin operations used by the team panel.
//
// A user's org is normally their email domain (company domain → shared org
// keyed by the domain; webmail → private personal org). Invites let an
// off-domain teammate join a specific org, so a user's org is no longer purely
// derivable from their email — we persist it in a users/{uid} profile and read
// that first. Firestore rules authorize every path from the verified email
// claim + membership docs; nothing here is trusted for access control.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { updateProfile, type User } from "firebase/auth";
import { getDbInstance } from "./firebase";
import type { Invite, Org, OrgGlossary, OrgMember, OrgRole, UserProfile } from "./schema";

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

export type OrgContext = {
  id: string;
  name: string;
  role: OrgRole;
  personal: boolean;
};

// The org id the current session resolved to. Memo paths depend on this, and it
// is NOT always the user's email domain (invited users), so storage reads it
// from here rather than recomputing. Set by resolveOrg / joinViaInvite.
let _currentOrgId: string | null = null;
export function currentOrgId(): string {
  if (!_currentOrgId) throw new Error("Org not resolved yet");
  return _currentOrgId;
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim() || null;
}

function emailKeyOf(user: User): string {
  return (user.email || "").trim().toLowerCase();
}

// The org a user's *email domain* maps to. Company domain → shared org keyed by
// the domain; personal/webmail → per-user private org.
export function orgIdForUser(user: User): {
  orgId: string;
  personal: boolean;
  domain: string | null;
} {
  const domain = user.email ? domainOf(user.email) : null;
  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return { orgId: `personal-${user.uid}`, personal: true, domain: null };
  }
  return { orgId: domain, personal: false, domain };
}

function orgNameFromDomain(domain: string): string {
  const label = domain.split(".")[0] || domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

async function writeProfile(user: User, ctx: OrgContext): Promise<void> {
  const profile: UserProfile = {
    uid: user.uid,
    orgId: ctx.id,
    role: ctx.role,
    email: user.email || "",
    displayName: user.displayName || user.email || "Teammate",
  };
  await setDoc(doc(getDbInstance(), "users", user.uid), profile);
}

// Create-or-join the user's domain/personal org, then persist their profile.
async function ensureDomainOrg(user: User): Promise<OrgContext> {
  const db = getDbInstance();
  const { orgId, personal, domain } = orgIdForUser(user);
  const orgRef = doc(db, "orgs", orgId);
  const memberRef = doc(db, "orgs", orgId, "members", user.uid);

  const [orgSnap, memberSnap] = await Promise.all([getDoc(orgRef), getDoc(memberRef)]);

  let iCreated = false;
  if (!orgSnap.exists()) {
    const org: Org = {
      id: orgId,
      name: personal
        ? user.displayName || user.email || "Personal workspace"
        : orgNameFromDomain(domain as string),
      domain: personal ? null : domain,
      personal,
      createdBy: user.uid,
      created_iso: new Date().toISOString(),
    };
    try {
      await setDoc(orgRef, org);
      iCreated = true;
    } catch {
      // Raced with a teammate creating the same org — fall through to join.
    }
  }

  const createdByMe = iCreated || orgSnap.data()?.createdBy === user.uid;
  const existingRole = memberSnap.exists()
    ? (memberSnap.data().role as OrgRole)
    : undefined;
  const role: OrgRole = existingRole ?? (createdByMe ? "admin" : "member");

  const member: OrgMember = {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || user.email || "Teammate",
    role,
    joined_iso: memberSnap.exists()
      ? (memberSnap.data().joined_iso as string)
      : new Date().toISOString(),
  };
  await setDoc(memberRef, member, { merge: true });

  const name = orgSnap.exists()
    ? (orgSnap.data().name as string)
    : personal
      ? member.displayName
      : orgNameFromDomain(domain as string);

  const ctx: OrgContext = { id: orgId, name, role, personal };
  await writeProfile(user, ctx);
  return ctx;
}

// Resolve the user's org: trust the profile pointer first (covers invited
// off-domain users), verifying the membership still exists; otherwise fall back
// to domain/personal resolution. Safe to call on every verified sign-in.
export async function resolveOrg(user: User): Promise<OrgContext> {
  const db = getDbInstance();
  const profileSnap = await getDoc(doc(db, "users", user.uid));

  if (profileSnap.exists()) {
    const orgId = profileSnap.data().orgId as string;
    const memberSnap = await getDoc(doc(db, "orgs", orgId, "members", user.uid));
    if (memberSnap.exists()) {
      const orgSnap = await getDoc(doc(db, "orgs", orgId));
      _currentOrgId = orgId;
      return {
        id: orgId,
        name: (orgSnap.data()?.name as string) ?? orgId,
        role: memberSnap.data().role as OrgRole,
        personal: (orgSnap.data()?.personal as boolean) ?? false,
      };
    }
    // Profile points at an org the user is no longer a member of (removed) —
    // fall through and re-resolve from their domain.
  }

  const ctx = await ensureDomainOrg(user);
  _currentOrgId = ctx.id;
  return ctx;
}

// Accept an invite to `orgId` (invitee opened the join link). Membership is
// gated by rules on the invitee's verified email matching a pending invite.
export async function joinViaInvite(user: User, orgId: string): Promise<OrgContext> {
  const db = getDbInstance();
  const emailKey = emailKeyOf(user);
  const inviteRef = doc(db, "orgs", orgId, "invites", emailKey);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) {
    throw new Error(
      "This invitation isn't valid for your account — it may be for a different email, or it was revoked.",
    );
  }

  const member: OrgMember = {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || user.email || "Teammate",
    role: "member",
    joined_iso: new Date().toISOString(),
  };
  await setDoc(doc(db, "orgs", orgId, "members", user.uid), member);

  const orgSnap = await getDoc(doc(db, "orgs", orgId));
  const ctx: OrgContext = {
    id: orgId,
    name: (orgSnap.data()?.name as string) ?? orgId,
    role: "member",
    personal: false,
  };
  await writeProfile(user, ctx);
  await deleteDoc(inviteRef);
  _currentOrgId = orgId;
  return ctx;
}

// ---- Admin operations (used by the /team panel; rules enforce admin) --------

export async function listMembers(orgId: string): Promise<OrgMember[]> {
  const snap = await getDocs(collection(getDbInstance(), "orgs", orgId, "members"));
  return snap.docs
    .map((d) => d.data() as OrgMember)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function listInvites(orgId: string): Promise<Invite[]> {
  const snap = await getDocs(collection(getDbInstance(), "orgs", orgId, "invites"));
  return snap.docs
    .map((d) => d.data() as Invite)
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function createInvite(orgId: string, email: string, inviter: User): Promise<void> {
  const key = email.trim().toLowerCase();
  const invite: Invite = {
    email: key,
    invitedBy: inviter.uid,
    invitedByName: inviter.displayName || inviter.email || "Admin",
    created_iso: new Date().toISOString(),
  };
  await setDoc(doc(getDbInstance(), "orgs", orgId, "invites", key), invite);
}

export async function revokeInvite(orgId: string, email: string): Promise<void> {
  await deleteDoc(doc(getDbInstance(), "orgs", orgId, "invites", email.trim().toLowerCase()));
}

export async function setMemberRole(orgId: string, uid: string, role: OrgRole): Promise<void> {
  await updateDoc(doc(getDbInstance(), "orgs", orgId, "members", uid), { role });
}

export async function removeMember(orgId: string, uid: string): Promise<void> {
  await deleteDoc(doc(getDbInstance(), "orgs", orgId, "members", uid));
}

export async function renameOrg(orgId: string, name: string): Promise<void> {
  await updateDoc(doc(getDbInstance(), "orgs", orgId), { name: name.trim() });
}

// ---- Glossary ---------------------------------------------------------------

const glossaryRef = (orgId: string) => doc(getDbInstance(), "orgs", orgId, "config", "glossary");

export async function getGlossary(orgId: string): Promise<OrgGlossary> {
  const snap = await getDoc(glossaryRef(orgId));
  const d = snap.exists() ? snap.data() : {};
  return { terms: (d.terms as string[]) ?? [], teamNames: (d.teamNames as string[]) ?? [] };
}

export async function setGlossary(orgId: string, g: OrgGlossary): Promise<void> {
  await setDoc(
    glossaryRef(orgId),
    { terms: g.terms, teamNames: g.teamNames, updatedAt: Date.now() },
    { merge: true },
  );
}

// ---- User profile -----------------------------------------------------------

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(getDbInstance(), "users", uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

// Save the user's editable profile. Writes in three places so the change shows
// up everywhere: Firebase Auth (name/photo the app already reads app-wide), the
// private profile doc (source of truth incl. title + avatar color), and the org
// member doc (so the team roster renders the new name/avatar).
export async function updateUserProfile(
  user: User,
  fields: { displayName: string; title?: string; avatarColor?: string | null; photoURL?: string | null },
): Promise<void> {
  const displayName = fields.displayName.trim() || user.email || "Teammate";
  const photoURL = fields.photoURL?.trim() ? fields.photoURL.trim() : null;
  const avatarColor = fields.avatarColor ?? null;
  const title = fields.title?.trim() ?? "";

  await updateProfile(user, { displayName, photoURL });

  const db = getDbInstance();
  await setDoc(
    doc(db, "users", user.uid),
    { displayName, title, avatarColor, photoURL },
    { merge: true },
  );
  await setDoc(
    doc(db, "orgs", currentOrgId(), "members", user.uid),
    { displayName, avatarColor, photoURL },
    { merge: true },
  );
}
