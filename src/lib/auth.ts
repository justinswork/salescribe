import "server-only";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { getAdminAuth } from "./firebase-admin";
import { checkRateLimit } from "./ratelimit";

// Authentication + throttling gate for the /api/* routes.
//
// Every route calls authorize(req) as its first step. There are three ways to
// pass:
//   1. A Firebase Auth ID token (a real signed-in user). Verified server-side
//      with the Admin SDK — this is the production path.
//   2. A shared service token (SALESCRIBE_SERVICE_TOKEN). Used by the eval
//      harness and any server-to-server caller. Works in every environment.
//   3. Local-dev bypass. When auth is not enforced (no cloud runtime, no
//      explicit opt-in) we treat the caller as a local developer so
//      `npm run dev` and evals work without a Firebase session.
//
// Enforcement is automatic in production: Firebase App Hosting / Cloud Run set
// the K_SERVICE env var at runtime, which flips enforcement on. Set
// SALESCRIBE_ENFORCE_AUTH=1 to force it on (e.g. to test the gate locally) or
// =0 to force it off.

export type Principal = {
  uid: string;
  kind: "user" | "service" | "dev";
};

function authEnforced(): boolean {
  const flag = process.env.SALESCRIBE_ENFORCE_AUTH;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return Boolean(process.env.K_SERVICE);
}

function bearerToken(req: NextRequest): string {
  const header = req.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function unauthorized(message: string): Response {
  return Response.json({ error: message }, { status: 401 });
}

function tooManyRequests(reason: string, retryAfterSec: number): Response {
  return Response.json(
    { error: reason },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

// Verify the caller. Returns the authenticated Principal, or a Response
// (401) that the route should return immediately.
export async function requireAuth(req: NextRequest): Promise<Principal | Response> {
  const token = bearerToken(req);

  // Service-token path first — works regardless of environment.
  const serviceToken = process.env.SALESCRIBE_SERVICE_TOKEN;
  if (serviceToken && token && timingSafeEqual(token, serviceToken)) {
    return { uid: "service", kind: "service" };
  }

  if (!authEnforced()) {
    return { uid: "local-dev", kind: "dev" };
  }

  if (!token) return unauthorized("Sign in to continue.");
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return { uid: decoded.uid, kind: "user" };
  } catch {
    return unauthorized("Your session has expired. Please sign in again.");
  }
}

// The single gate every route uses: authenticate, then throttle real users.
// Service and local-dev callers skip the rate limiter (the eval harness fires
// many requests in a burst; local dev has no Firestore to count against).
export async function authorize(req: NextRequest): Promise<Principal | Response> {
  const principal = await requireAuth(req);
  if (principal instanceof Response) return principal;

  if (principal.kind === "user") {
    const rl = await checkRateLimit(principal.uid);
    if (!rl.ok) return tooManyRequests(rl.reason, rl.retryAfterSec);
  }
  return principal;
}
