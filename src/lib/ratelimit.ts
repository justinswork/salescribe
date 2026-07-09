import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "./firebase-admin";

// Per-user request throttling, backed by Firestore so counters are shared
// across Cloud Run instances (an in-memory Map would reset on every cold start
// and wouldn't be consistent across the autoscaled fleet). Each user gets one
// `usage/{uid}` document holding two rolling windows plus token accounting.
//
// These are deliberately roomy for a real salesperson — a single memo is a
// handful of calls — and tight enough that a runaway loop or a leaked token
// can't quietly burn a month of API credit. Tune here.
export const RATE_LIMITS = {
  perMinute: 20,
  perDay: 200,
} as const;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type RateResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number; reason: string };

type UsageDoc = {
  minuteStart?: number;
  minuteCount?: number;
  dayStart?: number;
  dayCount?: number;
  tokensToday?: number;
  tokensTotal?: number;
};

// Atomically bump the caller's request counters and decide whether this
// request is allowed. Fails OPEN: if the store is unreachable we allow the
// request rather than take the whole app down over a throttling hiccup (the
// input-size caps in src/lib/limits.ts still bound per-request cost).
export async function checkRateLimit(uid: string): Promise<RateResult> {
  const now = Date.now();
  try {
    const ref = getAdminDb().collection("usage").doc(uid);
    return await getAdminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d: UsageDoc = snap.exists ? (snap.data() as UsageDoc) : {};

      let minuteStart = d.minuteStart ?? now;
      let minuteCount = d.minuteCount ?? 0;
      let dayStart = d.dayStart ?? now;
      let dayCount = d.dayCount ?? 0;

      if (now - minuteStart >= MINUTE_MS) {
        minuteStart = now;
        minuteCount = 0;
      }
      let resetTokensToday = false;
      if (now - dayStart >= DAY_MS) {
        dayStart = now;
        dayCount = 0;
        resetTokensToday = true;
      }

      if (minuteCount >= RATE_LIMITS.perMinute) {
        return {
          ok: false,
          retryAfterSec: Math.max(1, Math.ceil((minuteStart + MINUTE_MS - now) / 1000)),
          reason: "Too many requests this minute. Please slow down.",
        };
      }
      if (dayCount >= RATE_LIMITS.perDay) {
        return {
          ok: false,
          retryAfterSec: Math.max(1, Math.ceil((dayStart + DAY_MS - now) / 1000)),
          reason: "Daily usage limit reached. Try again tomorrow.",
        };
      }

      const update: UsageDoc = {
        minuteStart,
        minuteCount: minuteCount + 1,
        dayStart,
        dayCount: dayCount + 1,
      };
      if (resetTokensToday) update.tokensToday = 0;
      tx.set(ref, update, { merge: true });
      return { ok: true };
    });
  } catch (e) {
    console.error("[ratelimit] check failed, allowing request:", e);
    return { ok: true };
  }
}

// Best-effort token accounting for cost observability. Called after a model
// response returns; never blocks or fails the request.
export async function recordUsage(uid: string, tokens: number): Promise<void> {
  if (!tokens || tokens < 0) return;
  try {
    await getAdminDb()
      .collection("usage")
      .doc(uid)
      .set(
        {
          tokensToday: FieldValue.increment(tokens),
          tokensTotal: FieldValue.increment(tokens),
        },
        { merge: true },
      );
  } catch (e) {
    console.error("[ratelimit] token accounting failed:", e);
  }
}
