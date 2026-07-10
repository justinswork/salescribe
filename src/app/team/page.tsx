"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import Avatar from "@/components/Avatar";
import { useAuth } from "@/lib/AuthContext";
import { authedFetch, apiError } from "@/lib/api";
import {
  listMembers,
  listInvites,
  createInvite,
  revokeInvite,
  setMemberRole,
  removeMember,
  renameOrg,
} from "@/lib/org";
import type { Invite, OrgMember } from "@/lib/schema";

type KeyStatus = { hasAnthropic: boolean; hasOpenai: boolean };

export default function TeamPage() {
  return (
    <AuthGuard>
      <TeamPageContent />
    </AuthGuard>
  );
}

function TeamPageContent() {
  const { user, org, reloadOrg } = useAuth();
  const isAdmin = org?.role === "admin";

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [nameDraft, setNameDraft] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [joinLink, setJoinLink] = useState("");
  const [copied, setCopied] = useState(false);

  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);
  const [keyNotice, setKeyNotice] = useState("");

  async function refresh() {
    if (!org) return;
    try {
      const [m, i] = await Promise.all([listMembers(org.id), listInvites(org.id)]);
      setMembers(m);
      setInvites(i);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!org) return;
    void (async () => {
      setNameDraft(org.name);
      await refresh();
      if (org.role === "admin") {
        try {
          const r = await authedFetch("/api/org/keys");
          if (r.ok) setKeyStatus((await r.json()) as KeyStatus);
        } catch {
          // status is best-effort; the section still renders with inputs
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  function handleSaveKeys() {
    void (async () => {
      setSavingKeys(true);
      setKeyNotice("");
      setError("");
      try {
        const body: { anthropic?: string; openai?: string } = {};
        if (anthropicKey.trim()) body.anthropic = anthropicKey.trim();
        if (openaiKey.trim()) body.openai = openaiKey.trim();
        if (Object.keys(body).length === 0) {
          setKeyNotice("Enter a key to save.");
          return;
        }
        const r = await authedFetch("/api/org/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(await apiError(r, "Saving keys failed"));
        setKeyStatus((await r.json()) as KeyStatus);
        setAnthropicKey("");
        setOpenaiKey("");
        setKeyNotice("Saved.");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingKeys(false);
      }
    })();
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleRename() {
    if (!org || !nameDraft.trim() || nameDraft.trim() === org.name) return;
    void withBusy(async () => {
      await renameOrg(org.id, nameDraft.trim());
      await reloadOrg();
    });
  }

  function handleInvite() {
    if (!org || !user || !inviteEmail.trim()) return;
    void withBusy(async () => {
      await createInvite(org.id, inviteEmail.trim(), user);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setJoinLink(`${origin}/join?org=${encodeURIComponent(org.id)}`);
      setInviteEmail("");
      setCopied(false);
      await refresh();
    });
  }

  function handleRevoke(email: string) {
    if (!org) return;
    void withBusy(async () => {
      await revokeInvite(org.id, email);
      await refresh();
    });
  }

  function handleRole(uid: string, role: "admin" | "member") {
    if (!org) return;
    void withBusy(async () => {
      await setMemberRole(org.id, uid, role);
      await refresh();
    });
  }

  function handleRemove(m: OrgMember) {
    if (!org) return;
    if (!confirm(`Remove ${m.displayName} from the team? Their memos stay, but they lose access.`)) return;
    void withBusy(async () => {
      await removeMember(org.id, m.uid);
      await refresh();
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinLink);
      setCopied(true);
    } catch {
      // clipboard blocked — the link is visible for manual copy
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-3xl px-6 py-5 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-baseline rounded text-left hover:opacity-80"
            aria-label="Go to home"
          >
            <span className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Salescribe
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Team</h1>
          <Link
            href="/"
            className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ← Back to home
          </Link>
        </div>

        {error && (
          <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {/* Org name */}
        <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
            Organization
          </h2>
          {isAdmin ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="flex-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={handleRename}
                disabled={busy || !nameDraft.trim() || nameDraft.trim() === org?.name}
                className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Rename
              </button>
            </div>
          ) : (
            <div className="text-sm text-zinc-900 dark:text-zinc-100">{org?.name}</div>
          )}
        </section>

        {/* Members */}
        <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
            Members
            <span className="ml-2 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-normal text-zinc-700 dark:text-zinc-300">
              {members.length}
            </span>
          </h2>
          {loading ? (
            <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">Loading…</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {members.map((m) => {
                const isSelf = m.uid === user?.uid;
                return (
                  <li key={m.uid} className="flex items-center gap-3 py-1">
                    <Avatar
                      size={34}
                      name={m.displayName}
                      seed={m.uid}
                      label={isSelf ? "You" : m.displayName}
                      photoURL={m.photoURL ?? (isSelf ? user?.photoURL : undefined)}
                      color={m.avatarColor}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-900 dark:text-zinc-100 truncate">
                        {m.displayName}
                        {isSelf && <span className="text-zinc-400 dark:text-zinc-500"> (you)</span>}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{m.email}</div>
                    </div>
                    {isAdmin && !isSelf ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={m.role}
                          onChange={(e) => handleRole(m.uid, e.target.value as "admin" | "member")}
                          disabled={busy}
                          className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-900 dark:text-zinc-100"
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemove(m)}
                          disabled={busy}
                          className="text-xs text-zinc-400 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                        {m.role}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Invites (admins only) */}
        {isAdmin && (
          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
              Invite a teammate
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
              Anyone with a <span className="font-mono">@{org?.id}</span> email joins automatically. Use an
              invite for someone on a different email domain.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@partner.com"
                className="flex-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
              />
              <button
                type="button"
                onClick={handleInvite}
                disabled={busy || !inviteEmail.trim()}
                className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Invite
              </button>
            </div>

            {joinLink && (
              <div className="mt-3 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3">
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                  Send this link to the invited teammate — only the invited email can accept it:
                </div>
                <div className="flex gap-2 items-center">
                  <code className="flex-1 min-w-0 truncate text-xs text-zinc-700 dark:text-zinc-300">{joinLink}</code>
                  <button
                    type="button"
                    onClick={copyLink}
                    className="shrink-0 rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            {invites.length > 0 && (
              <ul className="mt-4 flex flex-col gap-2">
                {invites.map((inv) => (
                  <li key={inv.email} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-zinc-700 dark:text-zinc-300">{inv.email}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                        pending
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRevoke(inv.email)}
                        disabled={busy}
                        className="text-xs text-zinc-400 hover:text-red-600"
                      >
                        Revoke
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* API keys (admins only) */}
        {isAdmin && (
          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
              API keys
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
              Your organization supplies its own keys. <span className="font-medium">Anthropic is required</span> —
              it powers extraction, coaching, and briefings. <span className="font-medium">OpenAI is optional</span>:
              it enables high-accuracy Whisper transcription; without it, recording uses your browser&apos;s built-in
              speech recognition. Keys are stored securely and never shown again — leave a field blank to keep the
              current one.
            </p>
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Anthropic API key</span>
                  <KeyBadge state={keyStatus?.hasAnthropic} />
                </div>
                <input
                  type="password"
                  autoComplete="off"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder={keyStatus?.hasAnthropic ? "configured — enter a new key to replace" : "sk-ant-…"}
                  className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">OpenAI API key</span>
                  <KeyBadge state={keyStatus?.hasOpenai} optional />
                </div>
                <input
                  type="password"
                  autoComplete="off"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder={keyStatus?.hasOpenai ? "configured — enter a new key to replace" : "sk-…"}
                  className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveKeys}
                  disabled={savingKeys}
                  className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {savingKeys ? "Saving…" : "Save keys"}
                </button>
                {keyNotice && <span className="text-sm text-green-700 dark:text-green-400">{keyNotice}</span>}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function KeyBadge({ state, optional }: { state: boolean | undefined; optional?: boolean }) {
  if (state === undefined) return null;
  if (state) {
    return (
      <span className="rounded-full bg-green-100 dark:bg-green-950/40 px-2 py-0.5 text-[10px] font-semibold text-green-800 dark:text-green-300 uppercase tracking-wide">
        Configured
      </span>
    );
  }
  // Not set: neutral "Optional" for OpenAI, amber "Required" for Anthropic.
  return optional ? (
    <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
      Optional — not set
    </span>
  ) : (
    <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
      Required — not set
    </span>
  );
}
