"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useTheme, type Theme } from "@/components/ThemeProvider";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type NotionStatus =
  | { connected: false }
  | { connected: true; workspace_id?: string; workspace_name?: string };

const THEME_OPTIONS: { value: Theme; label: string; icon: string; description: string }[] = [
  { value: "light", label: "Light", icon: "☀", description: "Always light" },
  { value: "dark",  label: "Dark",  icon: "◑", description: "Always dark"  },
  { value: "system",label: "System",icon: "⊙", description: "Match device" },
];

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [notion, setNotion] = useState<NotionStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();

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
        <h2 className="eyebrow">Account</h2>
        <div className="mt-3 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-950 text-sm font-semibold text-white">
            {user?.email?.[0]?.toUpperCase() ?? "?"}
          </span>
          <p className="text-sm text-neutral-800 dark:text-neutral-200">
            {user?.email ?? "Unknown"}
          </p>
        </div>
      </section>

      <section className="card motion-card mt-4 p-6">
        <h2 className="eyebrow">Appearance</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
          Choose how Gist looks on this device. Your preference is saved locally.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-medium transition-all duration-150
                  ${active
                    ? "border-brand-700 bg-brand-50 text-brand-900 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-300"
                    : "border-neutral-200 text-neutral-600 hover:border-brand-400 hover:bg-brand-50/50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-brand-700 dark:hover:bg-brand-950/20"
                  }`}
              >
                <span className="text-xl leading-none">{opt.icon}</span>
                <span>{opt.label}</span>
                <span className="text-[10px] text-neutral-400 dark:text-neutral-300">{opt.description}</span>
              </button>
            );
          })}
        </div>
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
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
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
