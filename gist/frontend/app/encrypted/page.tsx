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
    try {
      const plaintext = await decryptStringWithPassword(selected, password);
      setDecrypted(JSON.parse(plaintext) as DecryptedSynthesis);
    } catch {
      setError("Password did not unlock this private save.");
    } finally {
      setPassword("");
      setOpening(false);
    }
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
        <p className="eyebrow">Browser-encrypted storage</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight">
          Private saves
        </h1>
        <p className="mt-2 text-base leading-relaxed text-neutral-600">
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
          <p className="mt-1 text-sm text-neutral-600">
            Run a synthesis, then save it privately with a password.
          </p>
        </section>
      ) : (
        <section className="report-shell fade-panel grid lg:grid-cols-[300px_1fr]">
          <ul className="space-y-1 border-b border-neutral-200 bg-neutral-50 p-3 lg:border-b-0 lg:border-r">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button
                  type="button"
                  onClick={() => selectArtifact(artifact)}
                  className={`w-full rounded-lg p-4 text-left transition-colors ${
                    selected?.id === artifact.id
                      ? "bg-brand-950 text-white"
                      : "bg-white text-neutral-900 hover:bg-brand-50"
                  }`}
                >
                  <p className="text-sm font-semibold">
                    {artifact.title || "Private synthesis"}
                  </p>
                  <p
                    className={`mt-1 text-xs ${
                      selected?.id === artifact.id
                        ? "text-brand-200"
                        : "text-neutral-500"
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
                <p className="mt-1 text-xs leading-relaxed text-neutral-600">
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
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-neutral-900">
                    {selected?.title || "Private synthesis"}
                  </p>
                  <button
                    type="button"
                    onClick={() => { setDecrypted(null); setSelected(null); }}
                    aria-label="Close report"
                    className="grid h-7 w-7 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
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
