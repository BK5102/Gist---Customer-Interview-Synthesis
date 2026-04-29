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
        const res = await fetch(`${API_URL}/notion/connection`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          setNotion((await res.json()) as NotionStatus);
        }
      }
      setLoading(false);
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
      let detail = "Failed to start Notion OAuth";
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
    const { auth_url } = (await res.json()) as { auth_url: string };
    window.location.href = auth_url;
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
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-neutral-500">Loading settings…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Account
        </h2>
        <p className="mt-2 text-sm text-neutral-700">
          {user?.email ?? "Unknown"}
        </p>
      </section>

      <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Integrations
        </h2>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-900">Notion</p>
            <p className="text-xs text-neutral-500">
              {notion.connected
                ? notion.workspace_name
                  ? `Connected to "${notion.workspace_name}". Push syntheses directly.`
                  : "Connected. Push syntheses directly to a Notion database."
                : "Connect your Notion workspace to push syntheses."}
            </p>
          </div>
          {notion.connected ? (
            <button
              type="button"
              onClick={disconnectNotion}
              disabled={busy}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : (
            <button
              type="button"
              onClick={connectNotion}
              disabled={busy}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {busy ? "Connecting…" : "Connect Notion"}
            </button>
          )}
        </div>
        {error && (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
