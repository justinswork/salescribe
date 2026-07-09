"use client";

import { useAuth } from "@/lib/AuthContext";
import SignInScreen from "./SignInScreen";
import VerifyEmailScreen from "./VerifyEmailScreen";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, emailVerified, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</div>
      </div>
    );
  }

  if (!user) return <SignInScreen />;
  if (!emailVerified) return <VerifyEmailScreen />;
  return <>{children}</>;
}
