"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null);
  const [notionConnected, setNotionConnected] = useState(false);
  const [loading, setLoading] = useState(true);

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

      // Check Notion connection status
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        const res = await fetch(`${API_URL}/notion/databases`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        setNotionConnected(res.ok);
      }
      setLoading(false);
    };
    init();
  }, []);

  const connectNotion = async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`${API_URL}/notion/auth`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      alert("Failed to start Notion OAuth");
      return;
    }
    const { auth_url } = (await res.json()) as { auth_url: string };
    window.location.href = auth_url;
  };

  const disconnectNotion = async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`${API_URL}/notion/connection`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setNotionConnected(false);
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
              {notionConnected
                ? "Connected. Push syntheses directly to a Notion database."
                : "Connect your Notion workspace to push syntheses."}
            </p>
          </div>
          {notionConnected ? (
            <button
              type="button"
              onClick={disconnectNotion}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={connectNotion}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Connect Notion
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
