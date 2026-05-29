"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";
import { Breadcrumb } from "@/components/Breadcrumb";

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type SynthesisDetail = {
  id: string;
  project_id: string;
  markdown_output: string;
  themes_json: any;
  transcript_ids: string[];
  model_used: string;
  created_at: string;
};

type NotionDb = { id: string; title: string };

export default function SynthesisDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [synth, setSynth] = useState<SynthesisDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notionConnected, setNotionConnected] = useState(false);
  const [databases, setDatabases] = useState<NotionDb[]>([]);
  const [selectedDb, setSelectedDb] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushUrl, setPushUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          window.location.href = "/login";
          return;
        }
        const res = await fetch(`${API_URL}/syntheses/${id}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as SynthesisDetail;
        setSynth(data);

        // Cheap connection check first; only hit Notion's API if connected.
        // Wrapped separately so a Notion-side outage doesn't block the
        // markdown render — the user can still read the synthesis.
        try {
          const connRes = await fetch(`${API_URL}/notion/connection`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (connRes.ok) {
            const conn = (await connRes.json()) as { connected: boolean };
            if (conn.connected) {
              setNotionConnected(true);
              const dbRes = await fetch(`${API_URL}/notion/databases`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
              });
              if (dbRes.ok) {
                const dbData = (await dbRes.json()) as NotionDb[];
                setDatabases(dbData);
                if (dbData.length > 0) setSelectedDb(dbData[0].id);
              }
            }
          }
        } catch {
          /* Notion check failed — degrade gracefully, hide push UI */
        }
      } catch {
        /* synthesis fetch failed — leave null so "not found" state shows */
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const copyMarkdown = async () => {
    if (!synth) return;
    await navigator.clipboard.writeText(synth.markdown_output);
  };

  const pushToNotion = async () => {
    if (!synth || !selectedDb) return;
    setPushing(true);
    setPushError(null);
    setPushUrl(null);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`${API_URL}/notion/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ synthesis_id: synth.id, database_id: selectedDb }),
    });
    setPushing(false);
    if (!res.ok) {
      const text = await res.text();
      let detail = text || "Push failed";
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        /* keep raw text */
      }
      setPushError(detail);
      return;
    }
    const data = (await res.json()) as { notion_page_url: string };
    setPushUrl(data.notion_page_url);
  };

  if (loading) {
    return (
      <main className="page">
        <div className="space-y-4">
          <div className="skeleton h-6 w-24 rounded-md" />
          <div className="skeleton h-10 w-72 rounded-md" />
          <div className="skeleton h-96 rounded-2xl" />
        </div>
      </main>
    );
  }

  if (!synth) {
    return (
      <main className="page text-center">
        <p className="text-sm text-neutral-500">Synthesis not found.</p>
        <Link
          href="/projects"
          className="mt-3 inline-block text-sm text-brand-700 underline"
        >
          Back to projects
        </Link>
      </main>
    );
  }

  return (
    <main className="page">
      <Breadcrumb
        items={[
          { label: "Workspace", href: "/" },
          { label: "Projects", href: "/projects" },
          { label: "Synthesis" },
        ]}
      />

      <header className="mb-8">
        <p className="eyebrow">Synthesis</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Interview Synthesis
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          {new Date(synth.created_at).toLocaleString()} ·{" "}
          {synth.transcript_ids?.length ?? 0} transcript
          {(synth.transcript_ids?.length ?? 0) === 1 ? "" : "s"} ·{" "}
          <span className="font-mono">
            {synth.model_used ?? "claude-sonnet-4-6"}
          </span>
        </p>
      </header>

      {/* Action bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={copyMarkdown}
          className="btn-secondary text-xs"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          Copy markdown
        </button>

        {notionConnected && databases.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
              className="input max-w-[12rem] py-1.5 text-xs"
            >
              {databases.map((db) => (
                <option key={db.id} value={db.id}>
                  {db.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={pushToNotion}
              disabled={pushing || !selectedDb}
              className="btn-primary text-xs"
            >
              {pushing ? "Pushing…" : "Push to Notion"}
            </button>
          </div>
        )}
      </div>

      {pushError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 animate-fade-in">
          {pushError}
        </p>
      )}
      {pushUrl && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 animate-fade-in">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-green-600 text-xs text-white">
            ✓
          </span>
          Pushed to Notion.{" "}
          <a
            href={pushUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline"
          >
            Open in Notion ↗
          </a>
        </div>
      )}

      <article className="card p-8">
        <div className="prose prose-neutral prose-brand max-w-none">
          {!synth.markdown_output ? (
            <p className="text-sm text-neutral-500">
              No synthesis content was stored for this record.
            </p>
          ) : looksLikeJson(synth.markdown_output) ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Synthesis result could not be rendered.</p>
              <p className="mt-1 text-xs">
                The stored content appears to be in an unexpected format.
                Please contact support or re-run the synthesis.
              </p>
            </div>
          ) : (
            <ReactMarkdown>{synth.markdown_output}</ReactMarkdown>
          )}
        </div>
      </article>
    </main>
  );
}
