"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type NotionStatus =
  | { connected: false }
  | { connected: true; workspace_id?: string; workspace_name?: string };

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [notion, setNotion] = useState<NotionStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

        // Cheap connection-status check — single DB read, no Notion API call.
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
            // Backend unreachable — leave notion state as disconnected
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
      <header className="mb-8">
        <p className="eyebrow">Account</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <section className="card p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Account
        </h2>
        <div className="mt-3 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-zinc-900 text-sm font-semibold text-white">
            {user?.email?.[0]?.toUpperCase() ?? "?"}
          </span>
          <p className="text-sm text-neutral-800">
            {user?.email ?? "Unknown"}
          </p>
        </div>
      </section>

      <section className="card mt-4 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Integrations
        </h2>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-neutral-200 bg-white font-bold text-neutral-700">
              N
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-neutral-900">Notion</p>
                {notion.connected && (
                  <span className="pill bg-green-50 text-green-700 ring-green-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Connected
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-neutral-500">
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
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 animate-fade-in">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
