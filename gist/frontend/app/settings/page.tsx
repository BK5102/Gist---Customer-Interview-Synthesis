"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Breadcrumb } from "@/components/Breadcrumb";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type NotionStatus =
  | { connected: false }
  | { connected: true; workspace_id?: string; workspace_name?: string };

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [notion, setNotion] = useState<NotionStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarSaved, setAvatarSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setUser(user);
        if (!user) {
          window.location.href = "/login";
          return;
        }
        if (user.user_metadata?.avatar_url) {
          setAvatarUrl(user.user_metadata.avatar_url);
        }

        // Cheap connection-status check: one DB read and no Notion API call.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          try {
            const res = await fetch(`${API_URL}/notion/connection`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (res.ok) {
              setNotion((await res.json()) as NotionStatus);
            }
          } catch {
            // Leave Notion disconnected when the backend is unreachable.
            // so the user sees the "Connect Notion" CTA instead of a
            // red banner.
          }
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);
    setAvatarSaved(false);

    if (!file.type.startsWith("image/")) {
      setAvatarError("Please select an image file.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("Image must be under 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    setAvatarUploading(true);
    try {
      const supabase = createClient();
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error("Not authenticated");

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(currentUser.id, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(currentUser.id);

      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });

      setAvatarUrl(publicUrl);
      setAvatarPreview(null);
      setAvatarSaved(true);
      setTimeout(() => setAvatarSaved(false), 3000);
    } catch (err: any) {
      setAvatarError(err.message ?? "Upload failed. Check that the avatars storage bucket exists in Supabase.");
      setAvatarPreview(null);
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const connectNotion = async () => {
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setBusy(false);
      return;
    }
    const res = await fetch(`${API_URL}/notion/auth`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      let detail = "Failed to start Notion connection";
      try {
        const parsed = await res.json();
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        /* keep default */
      }
      setError(detail);
      setBusy(false);
      return;
    }
    // Backend returns one of two shapes:
    //   { mode: "oauth", auth_url }      → redirect to Notion consent screen
    //   { mode: "internal", connected }  → connection saved server-side already
    const body = (await res.json()) as
      | { mode: "oauth"; auth_url: string }
      | {
          mode: "internal";
          connected: true;
          workspace_name: string | null;
        };
    if (body.mode === "oauth") {
      window.location.href = body.auth_url;
      return;
    }
    setNotion({
      connected: true,
      workspace_name: body.workspace_name ?? undefined,
    });
    setBusy(false);
  };

  const disconnectNotion = async () => {
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setBusy(false);
      return;
    }
    await fetch(`${API_URL}/notion/connection`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setNotion({ connected: false });
    setBusy(false);
  };

  if (loading) {
    return (
      <main className="page">
        <div className="space-y-4">
          <div className="skeleton h-8 w-40 rounded-md" />
          <div className="skeleton h-24 rounded-xl" />
          <div className="skeleton h-32 rounded-xl" />
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <Breadcrumb
        items={[
          { label: "Workspace", href: "/" },
          { label: "Settings" },
        ]}
      />
      <header className="motion-section mb-5">
        <p className="eyebrow">Account</p>
        <h1 className="page-title mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <section className="card motion-card p-6">
        <h2 className="eyebrow">Profile</h2>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              aria-label="Change profile photo"
              className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-neutral-200 transition-all duration-200 hover:border-brand-700 dark:border-neutral-700"
            >
              {(avatarPreview ?? avatarUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarPreview ?? avatarUrl!}
                  alt="Profile photo"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="grid h-full w-full place-items-center bg-brand-950 text-2xl font-semibold text-white">
                  {user?.email?.[0]?.toUpperCase() ?? "?"}
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
            >
              {avatarUploading ? "Uploading…" : "Change photo"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleAvatarChange}
            />
          </div>

          {/* User info */}
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Email</p>
            <p className="mt-1 text-base font-medium text-neutral-900 dark:text-neutral-100">
              {user?.email ?? "Unknown"}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Member since</p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {user?.created_at
                ? new Date(user.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                : "—"}
            </p>
          </div>
        </div>

        {avatarSaved && (
          <p className="mt-3 text-sm font-medium text-brand-700 dark:text-brand-400">
            Profile photo updated.
          </p>
        )}
        {avatarError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
            {avatarError}
          </p>
        )}
        <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
          JPG, PNG, or WebP · Max 2 MB.
        </p>
      </section>

      <section className="card motion-card mt-4 p-6">
        <h2 className="eyebrow">Security &amp; Privacy</h2>
        <p className="mt-1 text-base text-neutral-500 dark:text-neutral-300">
          How Gist handles your transcripts, synthesis output, and account data.
        </p>
        <Link
          href="/security"
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:border-brand-700 hover:bg-brand-50 hover:text-brand-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-brand-600 dark:hover:bg-brand-950/30 dark:hover:text-brand-300"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          View security disclosure
          <svg className="h-3.5 w-3.5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </Link>
      </section>

      <section className="card motion-card mt-4 p-6">
        <h2 className="eyebrow">Integrations</h2>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="state-visual h-12 w-12 text-sm font-bold text-neutral-700 dark:text-neutral-300">
              N
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Notion</p>
                {notion.connected && (
                  <span className="pill bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-700 dark:bg-brand-400" />
                    Connected
                  </span>
                )}
              </div>
              <p className="mt-1 text-base text-neutral-500 dark:text-neutral-300">
                {notion.connected
                  ? notion.workspace_name
                    ? `Workspace: "${notion.workspace_name}" · Push syntheses directly.`
                    : "Connected. Push syntheses directly to a Notion database."
                  : "Connect your Notion workspace to push syntheses with one click."}
              </p>
            </div>
          </div>
          {notion.connected ? (
            <button
              type="button"
              onClick={disconnectNotion}
              disabled={busy}
              className="btn-secondary"
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : (
            <button
              type="button"
              onClick={connectNotion}
              disabled={busy}
              className="btn-primary"
            >
              {busy ? "Connecting…" : "Connect Notion"}
            </button>
          )}
        </div>
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 animate-fade-in dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
