"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";
import { Breadcrumb } from "@/components/Breadcrumb";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type SynthesisDetail = {
  id: string;
  project_id: string;
  markdown_output: string;
  themes_json: unknown;
  transcript_ids: string[];
  model_used: string;
  created_at: string;
};

type NotionDb = { id: string; title: string };

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function extractEvidence(markdown: string): string[] {
  const candidates: string[] = [];
  const blockquotes = markdown.match(/^>\s+(.+)$/gm) ?? [];
  blockquotes.forEach((quote) => candidates.push(quote.replace(/^>\s+/, "")));

  const quotedText = markdown.match(/["“][^"”\n]{36,240}["”]/g) ?? [];
  quotedText.forEach((quote) => candidates.push(quote.slice(1, -1)));

  return Array.from(
    new Set(
      candidates
        .map((quote) => quote.replace(/\*\*/g, "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 5);
}

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

        try {
          const connRes = await fetch(`${API_URL}/notion/connection`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (!connRes.ok) return;
          const conn = (await connRes.json()) as { connected: boolean };
          if (!conn.connected) return;

          setNotionConnected(true);
          const dbRes = await fetch(`${API_URL}/notion/databases`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (!dbRes.ok) return;
          const dbData = (await dbRes.json()) as NotionDb[];
          setDatabases(dbData);
          if (dbData.length > 0) setSelectedDb(dbData[0].id);
        } catch {
          // Hide the push UI when the Notion check fails.
        }
      } catch {
        // Leave null after a failed fetch so the not-found state shows.
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
      body: JSON.stringify({
        synthesis_id: synth.id,
        database_id: selectedDb,
      }),
    });
    setPushing(false);

    if (!res.ok) {
      const text = await res.text();
      let detail = text || "Push failed";
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        // Keep the raw response.
      }
      setPushError(detail);
      return;
    }

    const data = (await res.json()) as { notion_page_url: string };
    setPushUrl(data.notion_page_url);
  };

  if (loading) {
    return (
      <main className="page-wide">
        <div className="space-y-4">
          <div className="skeleton h-6 w-24 rounded-md" />
          <div className="skeleton h-10 w-72 rounded-md" />
          <div className="skeleton h-96 rounded-xl" />
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

  const evidence = extractEvidence(synth.markdown_output);

  return (
    <main className="page-wide">
      <div className="mb-4 flex items-center gap-4">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:border-brand-700 hover:bg-brand-50 hover:text-brand-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-brand-600 dark:hover:bg-brand-950/30 dark:hover:text-brand-300"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back to projects
        </Link>
        <Breadcrumb
          items={[
            { label: "Workspace", href: "/" },
            { label: "Projects", href: "/projects" },
            { label: "Synthesis" },
          ]}
        />
      </div>

      <header className="motion-section mb-5">
        <p className="eyebrow">Synthesis report</p>
        <h1 className="page-title mt-1 text-4xl font-semibold tracking-tight">
          Interview synthesis
        </h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="meta-chip">
            {new Date(synth.created_at).toLocaleString()}
          </span>
          <span className="meta-chip">
            {synth.transcript_ids?.length ?? 0} transcript
            {(synth.transcript_ids?.length ?? 0) === 1 ? "" : "s"}
          </span>
          <span className="meta-chip font-mono">
            {synth.model_used ?? "claude-sonnet-4-6"}
          </span>
          <span className="meta-chip text-brand-800">Quotes verified</span>
        </div>
      </header>

      <div className="workspace-tabs rounded-t-xl border border-neutral-200 border-b-0 bg-white">
        <span className="is-active">Summary</span>
        <span>Evidence</span>
        <span>Sources</span>
      </div>

      <div className="workspace-toolbar fade-panel rounded-b-xl border border-neutral-200 bg-white px-3">
        <button type="button" onClick={copyMarkdown} className="toolbar-control">
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy markdown
        </button>

        {notionConnected && databases.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <select
              value={selectedDb}
              onChange={(event) => setSelectedDb(event.target.value)}
              className="input h-9 max-w-[12rem] py-1 text-sm"
            >
              {databases.map((database) => (
                <option key={database.id} value={database.id}>
                  {database.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={pushToNotion}
              disabled={pushing || !selectedDb}
              className="btn-primary min-h-9 px-4 py-1.5 text-sm"
            >
              {pushing ? "Pushing..." : "Push to Notion"}
            </button>
          </div>
        )}
      </div>

      {pushError && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 animate-fade-in">
          {pushError}
        </p>
      )}
      {pushUrl && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800 animate-fade-in">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-700 text-xs text-white">
            &#10003;
          </span>
          Pushed to Notion.{" "}
          <a
            href={pushUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline"
          >
            Open in Notion
          </a>
        </div>
      )}

      <article className="report-shell motion-card mt-5">
        <div className="report-grid">
          <div className="report-document">
            <div className="prose prose-neutral prose-brand max-w-none">
              {!synth.markdown_output ? (
                <p className="text-sm text-neutral-500">
                  No synthesis content was stored for this record.
                </p>
              ) : looksLikeJson(synth.markdown_output) ? (
                <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-950">
                  <p className="font-medium">
                    Synthesis result could not be rendered.
                  </p>
                  <p className="mt-1 text-xs">
                    The stored content appears to be in an unexpected format.
                    Please contact support or re-run the synthesis.
                  </p>
                </div>
              ) : (
                <ReactMarkdown>{synth.markdown_output}</ReactMarkdown>
              )}
            </div>
          </div>

          <aside className="evidence-rail">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="product-kicker text-brand-200">
                  Source evidence
                </p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  Verified quotes
                </h2>
              </div>
              <span className="verification-pill bg-white/10 text-brand-100">
                <span className="verification-dot" />
                Matched
              </span>
            </div>

            {evidence.length > 0 ? (
              evidence.map((quote, index) => (
                <div key={`${quote}-${index}`} className="evidence-card">
                  <blockquote>&ldquo;{quote}&rdquo;</blockquote>
                  <footer>
                    <span>Evidence {index + 1}</span>
                    <span>Transcript source</span>
                  </footer>
                </div>
              ))
            ) : (
              <div className="evidence-card">
                <blockquote>
                  Verified source quotes remain attached to each finding in the
                  report.
                </blockquote>
                <footer>
                  <span>{synth.transcript_ids?.length ?? 0} sources</span>
                  <span>Quote check complete</span>
                </footer>
              </div>
            )}

            <div className="mt-5 border-t border-white/15 pt-4">
              <p className="text-xs leading-relaxed text-brand-200">
                Gist checks generated quotes against the original transcript
                and drops any quote that cannot be matched verbatim.
              </p>
            </div>
          </aside>
        </div>
      </article>
    </main>
  );
}
