"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth as fbGetAuth, GoogleAuthProvider, OAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

// Firebase Web SDK config. NEXT_PUBLIC_* values get baked into the client
// bundle at build time. They're public by design — security comes from
// Firebase Auth + Firestore rules. Sourced from .env.local in dev and from
// apphosting.yaml in production.
function getConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

// Lazy singletons. Initializing Firebase eagerly at module load means
// `next build` blows up during static page evaluation when env vars
// aren't injected (same pattern as our Anthropic/OpenAI clients).
// Deferring to first use keeps the build environment safe while making
// the runtime cost a single one-time init.
let _app: FirebaseApp | undefined;
let _auth: Auth | undefined;
let _db: Firestore | undefined;
let _storage: FirebaseStorage | undefined;

function getApp(): FirebaseApp {
  if (_app) return _app;
  _app = getApps().length === 0 ? initializeApp(getConfig()) : getApps()[0];
  return _app;
}

export function getAuthInstance(): Auth {
  if (!_auth) _auth = fbGetAuth(getApp());
  return _auth;
}

export function getDbInstance(): Firestore {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

export function getStorageInstance(): FirebaseStorage {
  if (!_storage) _storage = getStorage(getApp());
  return _storage;
}

// Provider construction doesn't touch config — safe to export as a const.
export const googleProvider = new GoogleAuthProvider();

// Microsoft (Entra ID) sign-in. `tenant: "organizations"` routes auth through
// the work/school authority, so any company's Microsoft 365 account can sign
// in but personal consumer accounts (@outlook.com / @hotmail.com) cannot.
// `prompt: "select_account"` always shows the account picker instead of
// silently reusing whichever Microsoft session the browser already has.
// (To lock this to a single company later, swap "organizations" for that
// tenant's Directory ID and set the Azure app registration to single-tenant.)
export const microsoftProvider = new OAuthProvider("microsoft.com");
microsoftProvider.setCustomParameters({
  tenant: "organizations",
  prompt: "select_account",
});
