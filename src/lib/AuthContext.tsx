"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut as fbSignOut,
  User,
} from "firebase/auth";
import { getAuthInstance, googleProvider, microsoftProvider } from "./firebase";
import { ensureOrg, type OrgContext } from "./org";

export type ProviderId = "google" | "microsoft";

type AuthState = {
  user: User | null;
  loading: boolean;
  // Whether the signed-in user's email is confirmed. Always true for Google /
  // Microsoft users; gates access for email/password users until they verify.
  emailVerified: boolean;
  // The signed-in user's organization (team). Null until resolved; the app
  // waits on this before loading memos, since every memo path is org-scoped.
  org: OrgContext | null;
  orgLoading: boolean;
  signIn: (provider?: ProviderId) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  // Returns true on success, false on failure (authError is set on failure).
  resetPassword: (email: string) => Promise<boolean>;
  resendVerification: () => Promise<boolean>;
  // Re-fetches the user from Firebase and returns the fresh emailVerified value.
  refreshUser: () => Promise<boolean>;
  signOut: () => Promise<void>;
  authError: string | null;
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  emailVerified: false,
  org: null,
  orgLoading: false,
  signIn: async () => {},
  signInWithEmail: async () => {},
  signUpWithEmail: async () => {},
  resetPassword: async () => false,
  resendVerification: async () => false,
  refreshUser: async () => false,
  signOut: async () => {},
  authError: null,
});

// Map Firebase Auth error codes to plain-language copy. Returns "" for the
// benign popup-closed case so callers know to stay silent. Falls back to the
// raw message for anything unmapped.
function friendlyAuthMessage(e: unknown): string {
  const code =
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code: unknown }).code)
      : "";
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists — try signing in instead.";
    case "auth/weak-password":
      return "Please choose a password with at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/account-exists-with-different-credential":
      return "This email is already registered with a different sign-in method. Please use the button you used the first time.";
    default:
      return e instanceof Error ? e.message : String(e);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [org, setOrg] = useState<OrgContext | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(getAuthInstance(), (u) => {
      setUser(u);
      setEmailVerified(u?.emailVerified ?? false);
      // Clear org membership on sign-out; the effect below re-resolves it when
      // a verified user is present.
      if (!u) setOrg(null);
      setLoading(false);
    });
  }, []);

  // Resolve (and lazily create) the user's org once their email is verified.
  // Runs on sign-in and whenever verification flips true. Every memo path is
  // org-scoped, so the app gates on `org` being populated. The work is wrapped
  // in an async task so no state is set synchronously during the effect.
  useEffect(() => {
    if (!user || !emailVerified) return;
    let cancelled = false;
    (async () => {
      setOrgLoading(true);
      try {
        const resolved = await ensureOrg(user);
        if (!cancelled) setOrg(resolved);
      } catch (e) {
        if (!cancelled) setAuthError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setOrgLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, emailVerified]);

  async function signIn(providerId: ProviderId = "google") {
    setAuthError(null);
    const provider = providerId === "microsoft" ? microsoftProvider : googleProvider;
    try {
      await signInWithPopup(getAuthInstance(), provider);
    } catch (e) {
      const message = friendlyAuthMessage(e);
      if (message) setAuthError(message);
    }
  }

  async function signInWithEmail(email: string, password: string) {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(getAuthInstance(), email, password);
    } catch (e) {
      const message = friendlyAuthMessage(e);
      if (message) setAuthError(message);
    }
  }

  async function signUpWithEmail(email: string, password: string) {
    setAuthError(null);
    try {
      const cred = await createUserWithEmailAndPassword(getAuthInstance(), email, password);
      // Fire the confirmation email immediately. AuthGuard holds the new user
      // on the verify screen until they click the link.
      try {
        await sendEmailVerification(cred.user);
      } catch (e) {
        // Non-fatal: the account exists and they can resend from the verify
        // screen. Surface it so they know to use "resend" if the inbox is empty.
        const message = friendlyAuthMessage(e);
        if (message) setAuthError(message);
      }
    } catch (e) {
      const message = friendlyAuthMessage(e);
      if (message) setAuthError(message);
    }
  }

  async function resetPassword(email: string): Promise<boolean> {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(getAuthInstance(), email);
      return true;
    } catch (e) {
      const message = friendlyAuthMessage(e);
      if (message) setAuthError(message);
      return false;
    }
  }

  async function resendVerification(): Promise<boolean> {
    setAuthError(null);
    const current = getAuthInstance().currentUser;
    if (!current) return false;
    try {
      await sendEmailVerification(current);
      return true;
    } catch (e) {
      const message = friendlyAuthMessage(e);
      if (message) setAuthError(message);
      return false;
    }
  }

  async function refreshUser(): Promise<boolean> {
    const current = getAuthInstance().currentUser;
    if (!current) return false;
    await current.reload();
    const fresh = getAuthInstance().currentUser;
    const verified = fresh?.emailVerified ?? false;
    setUser(fresh);
    setEmailVerified(verified);
    return verified;
  }

  async function signOut() {
    await fbSignOut(getAuthInstance());
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        emailVerified,
        org,
        orgLoading,
        signIn,
        signInWithEmail,
        signUpWithEmail,
        resetPassword,
        resendVerification,
        refreshUser,
        signOut,
        authError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
