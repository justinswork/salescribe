"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import Avatar, { AVATAR_COLORS } from "@/components/Avatar";
import { useAuth } from "@/lib/AuthContext";
import { updateUserProfile } from "@/lib/org";
import { uploadAvatar } from "@/lib/storage";

export default function ProfilePage() {
  return (
    <AuthGuard>
      <ProfilePageContent />
    </AuthGuard>
  );
}

function ProfilePageContent() {
  const { user, profile, reloadOrg, refreshUser } = useAuth();

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [photoURL, setPhotoURL] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  function onPhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("That image is over 5 MB — pick a smaller one.");
      return;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    void (async () => {
      setUploadingPhoto(true);
      setError("");
      try {
        const url = await uploadAvatar(user.uid, file, ext);
        setPhotoURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploadingPhoto(false);
      }
    })();
  }

  // Seed the form from the loaded profile / auth once.
  useEffect(() => {
    if (ready) return;
    void (async () => {
      setName(profile?.displayName || user?.displayName || "");
      setTitle(profile?.title || "");
      setPhotoURL(profile?.photoURL || user?.photoURL || "");
      setColor(profile?.avatarColor ?? null);
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, user]);

  function handleSave() {
    if (!user || !name.trim()) return;
    void (async () => {
      setSaving(true);
      setError("");
      setNotice("");
      try {
        await updateUserProfile(user, {
          displayName: name,
          title,
          avatarColor: color,
          photoURL,
        });
        await refreshUser();
        await reloadOrg();
        setNotice("Profile saved.");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-2xl px-6 py-5 flex items-center justify-between">
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

      <main className="mx-auto max-w-2xl px-6 py-8 flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Your profile
          </h1>
          <Link
            href="/"
            className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ← Back to home
          </Link>
        </div>

        <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 flex flex-col gap-5">
          {/* Preview */}
          <div className="flex items-center gap-4">
            <Avatar
              size={64}
              name={name || user?.email || "You"}
              seed={user?.uid}
              photoURL={photoURL || undefined}
              color={color}
            />
            <div className="min-w-0">
              <div className="text-lg font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {name || "Your name"}
              </div>
              {title && <div className="text-sm text-zinc-500 dark:text-zinc-400 truncate">{title}</div>}
              <div className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{user?.email}</div>
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Display name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Title / role</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Account Executive"
              className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Photo (optional)</span>
            <div className="flex items-center gap-3">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPhotoPick}
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="rounded border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
              >
                {uploadingPhoto ? "Uploading…" : photoURL ? "Change photo" : "Upload photo"}
              </button>
              {photoURL && (
                <button
                  type="button"
                  onClick={() => setPhotoURL("")}
                  className="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Remove
                </button>
              )}
            </div>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
              Upload an image (max 5 MB). A photo takes priority over the color below.
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Avatar color</span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setColor(null)}
                className={`h-8 rounded-full px-3 text-xs ${
                  color === null
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                }`}
              >
                Auto
              </button>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Use ${c}`}
                  style={{ backgroundColor: c }}
                  className={`h-8 w-8 rounded-full ${
                    color === c ? "ring-2 ring-offset-2 ring-zinc-900 dark:ring-zinc-100 dark:ring-offset-zinc-950" : ""
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !ready || !name.trim()}
              className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
            {notice && <span className="text-sm text-green-700 dark:text-green-400">{notice}</span>}
            {error && <span className="text-sm text-red-600 dark:text-red-400 break-words">{error}</span>}
          </div>
        </section>
      </main>
    </div>
  );
}
