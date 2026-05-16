"use client";

import { useAuth } from "@/lib/AuthContext";
import ThemeToggle from "./ThemeToggle";

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.259h2.908c1.702-1.566 2.685-3.875 2.685-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.26c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default function SignInScreen() {
  const { signIn, authError } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="max-w-sm w-full mx-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 mb-1">
          Salescribe
          <span
            className="ml-2 align-middle text-xs font-mono font-normal text-zinc-400 dark:text-zinc-500"
            title={`commit ${process.env.NEXT_PUBLIC_GIT_SHA}`}
          >
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </span>
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
          Voice memos → structured sales notes.
          <br />
          Sign in to start dictating.
        </p>
        <button
          type="button"
          onClick={signIn}
          className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 px-4 py-2.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center justify-center gap-3"
        >
          <GoogleG />
          Sign in with Google
        </button>
        {authError && (
          <p className="mt-4 text-xs text-red-600 dark:text-red-400 break-words">{authError}</p>
        )}
      </div>
    </div>
  );
}
