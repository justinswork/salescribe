"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Public Firebase config. Misleadingly named — none of these are secrets.
// Security comes from Firebase Auth + Firestore security rules, not from
// keeping these values private. They identify the project for the client SDK.
const firebaseConfig = {
  apiKey: "AIzaSyA2GTt7OryaHOYx_-IOShaFQDfq-zOdeT4",
  authDomain: "salescribe-2532a.firebaseapp.com",
  projectId: "salescribe-2532a",
  storageBucket: "salescribe-2532a.firebasestorage.app",
  messagingSenderId: "632214597362",
  appId: "1:632214597362:web:7c85e45c95ff3c20bf2a6b",
};

// getApps()/getApp() guards against double-init under Next.js HMR.
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
