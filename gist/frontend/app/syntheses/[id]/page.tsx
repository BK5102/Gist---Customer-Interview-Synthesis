"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";

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
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = (await res.json()) as SynthesisDetail;
      setSynth(data);

      // Cheap connection check first; only hit Notion's API if connected.
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

      setLoading(false);
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
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-neutral-500">Loading synthesis…</p>
      </main>
    );
  }

  if (!synth) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-neutral-500">Synthesis not found.</p>
        <Link href="/projects" className="mt-2 inline-block text-sm underline">
          Back to projects
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/projects/${synth.project_id}`}
          className="text-xs text-neutral-500 underline"
        >
          ← Project
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Synthesis
        </h1>
        <p className="text-xs text-neutral-500">
          {new Date(synth.created_at).toLocaleString()}
        </p>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          {synth.transcript_ids?.length ?? 0} transcript
          {(synth.transcript_ids?.length ?? 0) === 1 ? "" : "s"} ·{" "}
          {synth.model_used ?? "claude-sonnet-4-6"}
        </p>
        <button
          type="button"
          onClick={copyMarkdown}
          className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          Copy markdown
        </button>
      </div>

      {notionConnected && (
        <div className="mb-4 rounded-md border border-neutral-200 bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
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
              className="rounded-md bg-neutral-900 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {pushing ? "Pushing…" : "Push to Notion"}
            </button>
          </div>
          {pushError && (
            <p className="mt-2 text-xs text-red-700">{pushError}</p>
          )}
          {pushUrl && (
            <p className="mt-2 text-xs text-green-700">
              Pushed!{" "}
              <a
                href={pushUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open in Notion
              </a>
            </p>
          )}
        </div>
      )}

      <article className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm prose prose-neutral max-w-none prose-headings:font-semibold prose-h1:text-2xl prose-h2:mt-8 prose-h2:border-t prose-h2:border-neutral-200 prose-h2:pt-6 prose-h3:mt-6 prose-blockquote:border-l-neutral-300 prose-blockquote:text-neutral-600">
        <ReactMarkdown>{synth.markdown_output}</ReactMarkdown>
      </article>
    </main>
  );
}
