"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import {
  decryptStringWithPassword,
  type PasswordEncryptedArtifactRecord,
} from "@/lib/encryption";
import { createClient } from "@/lib/supabase/client";

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
    <main className="page">
      <header className="mb-8">
        <span className="eyebrow">Private storage</span>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Private saves
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Saved reports are decrypted in this browser with the password you
          chose. Gist never stores that password.
        </p>
      </header>

      {artifacts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-brand-300 bg-brand-gradient-soft p-10 text-center">
          <h2 className="text-lg font-semibold text-neutral-900">
            No private saves yet
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Run a synthesis, then save it privately with a password.
          </p>
        </section>
      ) : (
        <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <ul className="space-y-2">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button
                  type="button"
                  onClick={() => selectArtifact(artifact)}
                  className={`card card-hover w-full p-4 text-left ${
                    selected?.id === artifact.id ? "ring-2 ring-brand-300" : ""
                  }`}
                >
                  <p className="text-sm font-semibold text-neutral-900">
                    {artifact.title || "Private synthesis"}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {new Date(artifact.created_at).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="card p-6">
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
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {error}
              </p>
            )}

            {decrypted && (
              <article className="prose prose-neutral prose-brand mt-2 max-w-none">
                <ReactMarkdown>{decrypted.markdown}</ReactMarkdown>
              </article>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
