"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import AuthGuard from "@/components/AuthGuard";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/lib/AuthContext";
import { getDbInstance } from "@/lib/firebase";
import { joinViaInvite } from "@/lib/org";

export default function JoinPage() {
  return (
    <AuthGuard>
      <JoinPageContent />
    </AuthGuard>
  );
}

function JoinPageContent() {
  const { user, org, reloadOrg } = useAuth();
  const router = useRouter();
  const orgId = useSearchParams().get("org") ?? "";

  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  const alreadyMember = org?.id === orgId;

  // Look up the org's name to show in the invitation. A pending invitee is
  // allowed to read the org doc (rules), so this works before they join.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!orgId) {
        if (!cancelled) {
          setError("This invite link is missing its organization.");
          setLoading(false);
        }
        return;
      }
      try {
        const snap = await getDoc(doc(getDbInstance(), "orgs", orgId));
        if (cancelled) return;
        if (snap.exists()) setOrgName((snap.data().name as string) ?? orgId);
        else setError("That organization no longer exists.");
      } catch {
        if (!cancelled) setError("This invite isn't valid for your account, or it was revoked.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  async function handleJoin() {
    if (!user || !orgId) return;
    setJoining(true);
    setError("");
    try {
      await joinViaInvite(user, orgId);
      await reloadOrg();
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJoining(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="max-w-sm w-full mx-6 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-8 text-center">
        {loading ? (
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Loading invitation…</div>
        ) : alreadyMember ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 mb-2">
              You&apos;re already on this team
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
              You&apos;re a member of {org?.name}.
            </p>
            <Link
              href="/"
              className="inline-block rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2.5 text-sm font-medium"
            >
              Go to Salescribe
            </Link>
          </>
        ) : error ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 mb-2">
              Invitation problem
            </h1>
            <p className="text-sm text-red-600 dark:text-red-400 mb-6 break-words">{error}</p>
            <Link
              href="/"
              className="text-sm text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Go to Salescribe
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 mb-2">
              Join {orgName}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
              You&apos;ve been invited to join {orgName} on Salescribe as{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{user?.email}</span>. You&apos;ll
              share memos with the team.
            </p>
            <button
              type="button"
              onClick={handleJoin}
              disabled={joining}
              className="w-full rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {joining ? "Joining…" : `Join ${orgName}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
