"use client";

import { getAuthInstance } from "./firebase";

// Client-side fetch wrapper that attaches the signed-in user's Firebase ID
// token as a bearer credential. Every call to a protected /api/* route should
// go through this instead of raw fetch(). If there's no signed-in user (or the
// token can't be minted), the request goes out unauthenticated and the server
// decides whether to allow it (local dev) or reject it with 401 (production).
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  try {
    const user = getAuthInstance().currentUser;
    if (user) {
      const token = await user.getIdToken();
      headers.set("Authorization", `Bearer ${token}`);
    }
  } catch {
    // Token retrieval failed — send without it rather than blocking the UI.
  }
  return fetch(input, { ...init, headers });
}

// Turn a non-OK API response into a user-facing message. Reads the JSON error
// body once (so only call this when you're about to bail on the response) and
// gives friendly copy for the auth/throttle statuses this app now returns.
export async function apiError(res: Response, fallback: string): Promise<string> {
  let detail = "";
  try {
    const body = await res.json();
    if (body?.error) detail = String(body.error);
  } catch {
    // No/invalid JSON body — fall back to the generic message.
  }
  if (res.status === 401) return detail || "Please sign in again to continue.";
  if (res.status === 429) {
    return detail || "You're going a little fast — give it a moment and try again.";
  }
  return `${fallback} (${res.status})${detail ? `: ${detail}` : ""}`;
}
