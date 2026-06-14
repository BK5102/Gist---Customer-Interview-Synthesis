"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import {
  decryptStringWithPassword,
  type PasswordEncryptedArtifactRecord,
} from "@/lib/encryption";
import { createClient } from "@/lib/supabase/client";
import { Breadcrumb } from "@/components/Breadcrumb";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type NotionDb = { id: string; title: string };

type EncryptedArtifact = PasswordEncryptedArtifactRecord & {
  id: string;
  artifact_type: string;
  project_id: string | null;
  title: string | null;
  created_at: string;
};

type DecryptedSynthesis = {
  type: string;
  saved_at: string;
  project_id: string | null;
  title?: string;
  markdown: string;
  stats?: {
    cluster_count?: number;
    participant_count?: number;
    themes_extracted?: number;
    themes_dropped?: number;
  };
};

export default function EncryptedSavesPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams?.get("project") ?? null;
  const [artifacts, setArtifacts] = useState<EncryptedArtifact[]>([]);
  const [selected, setSelected] = useState<EncryptedArtifact | null>(null);
  const [password, setPassword] = useState("");
  const [decrypted, setDecrypted] = useState<DecryptedSynthesis | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notionConnected, setNotionConnected] = useState(false);
  const [databases, setDatabases] = useState<NotionDb[]>([]);
  const [selectedDb, setSelectedDb] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushUrl, setPushUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadArtifacts = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }

      let query = supabase
        .from("encrypted_artifacts")
        .select(
          [
            "id",
            "artifact_type",
            "project_id",
            "title",
            "ciphertext",
            "iv",
            "salt",
            "kdf",
            "iterations",
            "algorithm",
            "created_at",
          ].join(","),
        )
        .eq("artifact_type", "synthesis");

      if (projectId) {
        query = query.eq("project_id", projectId);
      }

      const { data, error: loadError } = await query.order("created_at", {
        ascending: false,
      });

      if (loadError) {
        setError(loadError.message);
      } else {
        setArtifacts((data ?? []) as unknown as EncryptedArtifact[]);
      }
      setLoading(false);
    };

    loadArtifacts();
  }, [projectId]);

  const selectArtifact = (artifact: EncryptedArtifact) => {
    setSelected(artifact);
    setError(null);
    setPassword("");
    setDecrypted(null);
  };

  const openArtifact = async () => {
    if (!selected || !password) return;
    setError(null);
    setOpening(true);
    setPushError(null);
    setPushUrl(null);
    try {
      const plaintext = await decryptStringWithPassword(selected, password);
      setDecrypted(JSON.parse(plaintext) as DecryptedSynthesis);

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        try {
          const connRes = await fetch(`${API_URL}/notion/connection`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (connRes.ok) {
            const conn = await connRes.json() as { connected: boolean };
            if (conn.connected) {
              setNotionConnected(true);
              const dbRes = await fetch(`${API_URL}/notion/databases`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
              });
              if (dbRes.ok) {
                const dbs = await dbRes.json() as NotionDb[];
                setDatabases(dbs);
                if (dbs.length > 0) setSelectedDb(dbs[0].id);
              }
            }
          }
        } catch {
          // Notion check failed — push UI stays hidden
        }
      }
    } catch {
      setError("Password did not unlock this private save.");
    } finally {
      setPassword("");
      setOpening(false);
    }
  };

  const pushToNotion = async () => {
    if (!decrypted || !selectedDb) return;
    setPushing(true);
    setPushError(null);
    setPushUrl(null);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const title = decrypted.title || selected?.title || "Interview Synthesis";
    const res = await fetch(`${API_URL}/notion/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ markdown: decrypted.markdown, title, database_id: selectedDb }),
    });
    setPushing(false);
    if (!res.ok) {
      const text = await res.text();
      let detail = text || "Push failed";
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch { /* keep raw */ }
      setPushError(detail);
      return;
    }
    const data = await res.json() as { notion_page_url: string };
    setPushUrl(data.notion_page_url);
  };

  if (loading) {
    return (
      <main className="page">
        <p className="text-sm text-neutral-500">Loading private saves...</p>
      </main>
    );
  }

  return (
    <main className="page-wide">
      <Breadcrumb
        items={[
          { label: "Workspace", href: "/" },
          { label: "Private Saves" },
        ]}
      />
      <header className="motion-section mb-5">
        <h1 className="page-title text-4xl font-semibold tracking-tight">
          Private saves
        </h1>
        <p className="mt-2 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
          Saved reports are decrypted in this browser with the password you
          chose. Gist never stores that password.
        </p>
      </header>

      {artifacts.length === 0 ? (
        <section className="fade-panel rounded-xl border border-dashed border-neutral-300 bg-white/65 p-10 text-center">
          <div className="state-visual">
            <span className="text-xl font-semibold">L</span>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900">
            No private saves yet
          </h2>
          <p className="mt-1 text-base text-neutral-600 dark:text-neutral-300">
            Run a synthesis, then save it privately with a password.
          </p>
        </section>
      ) : (
        <section className="report-shell fade-panel grid lg:grid-cols-[300px_1fr]">
          <ul className="space-y-1 border-b border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900 lg:border-b-0 lg:border-r">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button
                  type="button"
                  onClick={() => selectArtifact(artifact)}
                  className={`w-full rounded-lg p-4 text-left transition-colors ${
                    selected?.id === artifact.id
                      ? "bg-brand-950 text-white dark:bg-brand-700"
                      : "bg-white text-neutral-900 hover:bg-brand-50 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-brand-950/40"
                  }`}
                >
                  <p className="text-sm font-semibold">
                    {artifact.title || "Private synthesis"}
                  </p>
                  <p
                    className={`mt-1 text-xs ${
                      selected?.id === artifact.id
                        ? "text-brand-200"
                        : "text-neutral-500 dark:text-neutral-300"
                    }`}
                  >
                    {new Date(artifact.created_at).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="min-w-0 p-6 sm:p-8">
            {!selected && (
              <p className="text-sm text-neutral-500">
                Choose a private save to open it.
              </p>
            )}

            {selected && !decrypted && (
              <div>
                <p className="text-sm font-semibold text-neutral-900">
                  Enter password
                </p>
                <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
                  Use the password you chose when saving this report.
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") openArtifact();
                    }}
                    placeholder="Private password"
                    className="input flex-1"
                  />
                  <button
                    type="button"
                    onClick={openArtifact}
                    disabled={opening || !password}
                    className="btn-primary"
                  >
                    {opening ? "Opening..." : "Open"}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-950">
                {error}
              </p>
            )}

            {decrypted && (
              <div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {selected?.title || "Private synthesis"}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {notionConnected && databases.length > 0 && (
                      <>
                        <select
                          value={selectedDb}
                          onChange={(e) => setSelectedDb(e.target.value)}
                          className="input h-9 max-w-[12rem] py-1 text-sm"
                        >
                          {databases.map((db) => (
                            <option key={db.id} value={db.id}>{db.title}</option>
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
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => { setDecrypted(null); setSelected(null); setPushUrl(null); setPushError(null); }}
                      aria-label="Close report"
                      className="grid h-7 w-7 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                {pushError && (
                  <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{pushError}</p>
                )}
                {pushUrl && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-700 text-xs text-white">&#10003;</span>
                    Pushed to Notion.{" "}
                    <a href={pushUrl} target="_blank" rel="noreferrer" className="font-medium underline">Open in Notion</a>
                  </div>
                )}
                <article className="prose prose-neutral prose-brand max-w-none">
                  <ReactMarkdown>{decrypted.markdown}</ReactMarkdown>
                </article>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
