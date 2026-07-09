"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import ThemeToggle from "./ThemeToggle";

// Holding screen for signed-in email/password users whose address isn't
// confirmed yet. AuthGuard renders this instead of the app until
// emailVerified flips true. Google/Microsoft users never see it — their
// email is already verified by the provider.
export default function VerifyEmailScreen() {
  const { user, resendVerification, refreshUser, signOut, authError } = useAuth();

  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState("");

  async function handleCheck() {
    setNotice("");
    setChecking(true);
    try {
      const verified = await refreshUser();
      // On success, AuthGuard re-renders into the app automatically.
      if (!verified) {
        setNotice("Not confirmed yet — click the link in your email, then try again.");
      }
    } finally {
      setChecking(false);
    }
  }

  async function handleResend() {
    setNotice("");
    setResending(true);
    try {
      const ok = await resendVerification();
      if (ok) setNotice("Sent — check your inbox (and spam folder).");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="max-w-sm w-full mx-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 mb-2">
          Confirm your email
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          We sent a confirmation link to
          {user?.email ? (
            <>
              {" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{user.email}</span>.
            </>
          ) : (
            " your email address."
          )}
          <br />
          Click it, then come back and continue.
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleCheck}
            disabled={checking}
            className="w-full rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {checking ? "Checking…" : "I've confirmed — continue"}
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 px-4 py-2.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            {resending ? "Sending…" : "Resend email"}
          </button>
        </div>

        <button
          type="button"
          onClick={signOut}
          className="mt-4 text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          Sign out / use a different account
        </button>

        {notice && (
          <p className="mt-4 text-xs text-zinc-600 dark:text-zinc-400 break-words">{notice}</p>
        )}
        {authError && (
          <p className="mt-4 text-xs text-red-600 dark:text-red-400 break-words">{authError}</p>
        )}
      </div>
    </div>
  );
}
