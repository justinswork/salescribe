"use client";

import { useAuth } from "@/lib/AuthContext";
import SignInScreen from "./SignInScreen";
import VerifyEmailScreen from "./VerifyEmailScreen";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, emailVerified, org, loading, authError, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</div>
      </div>
    );
  }

  if (!user) return <SignInScreen />;
  if (!emailVerified) return <VerifyEmailScreen />;
  // Verified, but the org membership is still being resolved/created.
  if (!org) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-zinc-950 px-6 text-center">
        {authError ? (
          <>
            <div className="max-w-sm text-sm text-red-600 dark:text-red-400 break-words">
              Couldn&apos;t set up your workspace: {authError}
            </div>
            <button
              type="button"
              onClick={signOut}
              className="text-sm text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Sign out
            </button>
          </>
        ) : (
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Setting up your workspace…</div>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
