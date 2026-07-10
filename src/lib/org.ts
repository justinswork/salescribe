"use client";

// Resolves a signed-in user to their organization and ensures the org +
// membership documents exist. An org is derived deterministically from the
// user's email: a real company domain maps to a shared org whose id IS the
// domain; a webmail/personal address gets a private single-member org. This
// keeps "one org per user" automatic and lets Firestore rules authorize
// membership from the verified email claim alone — no server round-trip.

import { doc, getDoc, setDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { getDbInstance } from "./firebase";
import type { Org, OrgMember, OrgRole } from "./schema";

// Consumer/webmail domains that must never collapse into one shared org.
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

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim() || null;
}

// The org a user belongs to, computed from their email. Company domain →
// shared org keyed by the domain; personal/webmail → per-user private org.
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
  // "vibrationresearch.com" → "Vibrationresearch" — a sensible default an
  // admin can rename later.
  const label = domain.split(".")[0] || domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Idempotently ensure the user has an org + membership, returning the resolved
// context. Safe to call on every verified sign-in. Requires a verified email
// (Firestore rules reject the writes otherwise).
export async function ensureOrg(user: User): Promise<OrgContext> {
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
      // Raced with a teammate creating the same org — that's fine, they win
      // the create and we fall through to joining as a member.
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

  return { id: orgId, name, role, personal };
}
