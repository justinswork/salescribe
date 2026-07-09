import "server-only";
import { getApps, initializeApp, applicationDefault, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Server-side Firebase Admin SDK. Used to verify Firebase Auth ID tokens on the
// API routes and to back the per-user rate limiter with Firestore.
//
// Credentials come from Application Default Credentials (ADC): on Firebase App
// Hosting / Cloud Run the runtime service account is discovered automatically —
// no key file, no secret to set. Locally there are no ADC, so init throws; the
// auth layer only reaches for the Admin SDK when auth is actually enforced
// (production), so local dev never triggers this path. See src/lib/auth.ts.
//
// Lazy singleton for the same reason as the Anthropic/OpenAI clients: we must
// not initialize at module load or `next build`'s page-data collection would
// try (and fail) to resolve credentials.
let _app: App | undefined;

function getAdminApp(): App {
  if (_app) return _app;
  const existing = getApps();
  _app = existing.length
    ? existing[0]
    : initializeApp({
        credential: applicationDefault(),
        // Explicit projectId helps ID-token audience validation resolve even
        // when the metadata server is slow to report it. Falls back to the
        // public web-config project id, which is the same project.
        projectId:
          process.env.GOOGLE_CLOUD_PROJECT ||
          process.env.GCLOUD_PROJECT ||
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
  return _app;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}
