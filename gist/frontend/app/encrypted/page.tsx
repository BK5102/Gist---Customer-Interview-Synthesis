"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  decryptStringWithLocalKey,
  decryptStringWithRecoverySecret,
  type EncryptedArtifactRecord,
} from "@/lib/encryption";
import { createClient } from "@/lib/supabase/client";

type EncryptedArtifact = EncryptedArtifactRecord & {
  id: string;
  artifact_type: string;
  project_id: string | null;
  created_at: string;
};

type DecryptedSynthesis = {
  type: string;
  saved_at: string;
  project_id: string | null;
  markdown: string;
  stats?: {
    cluster_count?: number;
    participant_count?: number;
    themes_extracted?: number;
    themes_dropped?: number;
  };
};

export default function EncryptedSavesPage() {
  const [artifacts, setArtifacts] = useState<EncryptedArtifact[]>([]);
  const [selected, setSelected] = useState<EncryptedArtifact | null>(null);
  const [recoverySecret, setRecoverySecret] = useState("");
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

      const { data, error: loadError } = await supabase
        .from("encrypted_artifacts")
        .select(
          [
            "id",
            "artifact_type",
            "project_id",
            "ciphertext",
            "iv",
            "encrypted_data_key",
            "data_key_iv",
            "key_salt",
            "key_kdf",
            "key_iterations",
            "key_algorithm",
            "key_version",
            "created_at",
          ].join(","),
        )
        .eq("artifact_type", "synthesis")
        .order("created_at", { ascending: false });

      if (loadError) {
        setError(loadError.message);
      } else {
        setArtifacts((data ?? []) as unknown as EncryptedArtifact[]);
      }
      setLoading(false);
    };

    loadArtifacts();
  }, []);

  const openArtifact = async (artifact: EncryptedArtifact) => {
    setSelected(artifact);
    setError(null);
    setDecrypted(null);
    setOpening(true);
    try {
      const plaintext = await decryptStringWithLocalKey(artifact);
      setDecrypted(JSON.parse(plaintext) as DecryptedSynthesis);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Enter the recovery secret to open this save.",
      );
    } finally {
      setOpening(false);
    }
  };

  const restoreAndOpen = async () => {
    if (!selected || !recoverySecret.trim()) return;
    setError(null);
    setOpening(true);
    try {
      const plaintext = await decryptStringWithRecoverySecret(
        selected,
        recoverySecret,
      );
      setDecrypted(JSON.parse(plaintext) as DecryptedSynthesis);
      setRecoverySecret("");
    } catch {
      setError("Recovery secret did not unlock this encrypted save.");
    } finally {
      setOpening(false);
    }
  };

  if (loading) {
    return (
      <main className="page">
        <p className="text-sm text-neutral-500">Loading encrypted saves...</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="mb-8">
        <span className="eyebrow">Private storage</span>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Encrypted saves
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Saved reports are decrypted in this browser. Gist stores ciphertext
          and encrypted data keys only.
        </p>
      </header>

      {artifacts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-brand-300 bg-brand-gradient-soft p-10 text-center">
          <h2 className="text-lg font-semibold text-neutral-900">
            No encrypted saves yet
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Run a synthesis, then use Save encrypted.
          </p>
        </section>
      ) : (
        <section className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <ul className="space-y-2">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button
                  type="button"
                  onClick={() => openArtifact(artifact)}
                  className={`card card-hover w-full p-4 text-left ${
                    selected?.id === artifact.id ? "ring-2 ring-brand-300" : ""
                  }`}
                >
                  <p className="text-sm font-semibold text-neutral-900">
                    Synthesis
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
                Choose an encrypted save to open it.
              </p>
            )}

            {selected && !decrypted && (
              <div>
                <p className="text-sm font-semibold text-neutral-900">
                  {opening ? "Opening..." : "Recovery may be required"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                  If this browser already has the private key, the save opens
                  automatically. Otherwise, enter the recovery secret.
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    value={recoverySecret}
                    onChange={(e) => setRecoverySecret(e.target.value)}
                    placeholder="Recovery secret"
                    className="input flex-1"
                  />
                  <button
                    type="button"
                    onClick={restoreAndOpen}
                    disabled={opening || !recoverySecret.trim()}
                    className="btn-primary"
                  >
                    Restore
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
