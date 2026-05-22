"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { encryptStringWithLocalKey } from "@/lib/encryption";
import { createClient } from "@/lib/supabase/client";

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="card card-hover p-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 text-lg text-brand-700">
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-600">{body}</p>
    </div>
  );
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MAX_TEXT_BYTES = 2 * 1024 * 1024; // keep in sync with backend
const MAX_AUDIO_BYTES = 200 * 1024 * 1024; // backend chunks anything >25 MB
const MAX_FILES = 20;
const TEXT_EXTS = [".txt"];
const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".mp4", ".webm", ".mpeg", ".mpga"];
const ALLOWED_EXTS = [...TEXT_EXTS, ...AUDIO_EXTS];

const extOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};
const isAudio = (name: string) => AUDIO_EXTS.includes(extOf(name));

// Rough heuristic: compressed audio ≈ 1 MB per minute at 128 kbps.
// Transcription ≈ 1 min wall-clock per 5 min of audio (API + overhead).
function estimateMinutes(name: string, bytes: number): number {
  if (!isAudio(name)) return 0;
  const mb = bytes / (1024 * 1024);
  const audioMinutes = mb; // 1 MB ≈ 1 min at 128kbps
  return Math.max(1, Math.round(audioMinutes / 5));
}

function totalEstimateMinutes(files: File[]): number {
  return files.reduce((sum, f) => sum + estimateMinutes(f.name, f.size), 0);
}

type SynthesizeResponse = {
  markdown: string;
  cluster_count: number;
  participant_count: number;
  themes_extracted: number;
  themes_dropped: number;
  // Set only when the backend is explicitly configured to persist plaintext
  // syntheses. Production keeps that off until client-side encrypted storage
  // exists.
  project_id?: string | null;
  synthesis_id?: string | null;
};

type FileProgressItem = {
  filename: string;
  participant_id: string;
  status: "pending" | "transcribing" | "extracting" | "extracted" | "error";
};

type JobStatus = {
  job_id: string;
  status:
    | "queued"
    | "transcribing"
    | "extracting"
    | "clustering"
    | "insights"
    | "done"
    | "error";
  current: number | null;
  total: number | null;
  file_progress: FileProgressItem[] | null;
  result: SynthesizeResponse | null;
  error: string | null;
};

const POLL_MS = 2000;

const stageLabel = (job: JobStatus): string => {
  const fraction =
    job.current != null && job.total != null
      ? ` ${job.current}/${job.total}`
      : "";
  switch (job.status) {
    case "queued":
      return "Queued…";
    case "transcribing":
      return `Transcribing audio${fraction}…`;
    case "extracting":
      return `Extracting themes${fraction}…`;
    case "clustering":
      return "Clustering themes across interviews…";
    case "insights":
      return "Generating founder takeaways…";
    case "done":
      return "Done";
    case "error":
      return "Error";
  }
};

const FileStatusBadge = ({ status }: { status: FileProgressItem["status"] }) => {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
          Pending
        </span>
      );
    case "transcribing":
      return (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
          Transcribing…
        </span>
      );
    case "extracting":
      return (
        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
          Extracting…
        </span>
      );
    case "extracted":
      return (
        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
          Done
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
          Error
        </span>
      );
  }
};

const stemOf = (name: string) => {
  const ext = extOf(name);
  return ext ? name.slice(0, -ext.length) : name;
};

export default function Home() {
  // Optional ?project=<uuid> identifies the project context. Production does
  // not persist plaintext synthesis output by default.
  const searchParams = useSearchParams();
  const projectId = searchParams?.get("project") ?? null;

  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SynthesizeResponse | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSavingEncrypted, setIsSavingEncrypted] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth state on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthLoading(false);
    });
  }, []);

  // Cmd/Ctrl+Enter submits when files are picked + nothing is in flight.
  // Lives at document level so a blurred input doesn't swallow it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      if (isLoading || files.length === 0) return;
      e.preventDefault();
      submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, files.length, labels, projectId]);

  // Cancel any outstanding poll on unmount so we don't leak timers across
  // hot-reloads in dev.
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const pollJob = async (jobId: string) => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`${API_URL}/jobs/${jobId}`, { headers });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Backend returned ${res.status}`);
      }
      const next = (await res.json()) as JobStatus;
      setJob(next);

      if (next.status === "done" && next.result) {
        setResult(next.result);
        setIsLoading(false);
        // If plaintext persistence is explicitly enabled, jump to the detail
        // page. Otherwise stay here so sensitive output is only shown in the
        // active browser session.
        if (next.result.synthesis_id) {
          window.location.href = `/syntheses/${next.result.synthesis_id}`;
        }
        return;
      }
      if (next.status === "error") {
        setError(next.error || "Pipeline failed");
        setIsLoading(false);
        return;
      }
      pollTimer.current = setTimeout(() => pollJob(jobId), POLL_MS);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Polling failed";
      setError(message);
      setIsLoading(false);
    }
  };

  const validateAndSetFiles = (picked: File[]) => {
    setError(null);
    if (picked.length === 0) return;

    const badType = picked.find((f) => !ALLOWED_EXTS.includes(extOf(f.name)));
    if (badType) {
      setError(
        `Unsupported file type: ${badType.name} (allowed: ${ALLOWED_EXTS.join(", ")}).`,
      );
      return;
    }

    const tooBig = picked.find((f) => {
      const cap = isAudio(f.name) ? MAX_AUDIO_BYTES : MAX_TEXT_BYTES;
      return f.size > cap;
    });
    if (tooBig) {
      const cap = isAudio(tooBig.name) ? MAX_AUDIO_BYTES : MAX_TEXT_BYTES;
      setError(
        `${tooBig.name} is larger than ${(cap / 1024 / 1024).toFixed(0)} MB.`,
      );
      return;
    }

    if (picked.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files per request.`);
      return;
    }

    const stems = picked.map((f) => stemOf(f.name));
    if (new Set(stems).size !== stems.length) {
      setError(
        "Duplicate filenames detected. Each transcript stem must be unique (e.g. P1.txt, P2.txt).",
      );
      return;
    }

    setFiles(picked);
    setLabels(picked.map(() => ""));
    setResult(null);
  };

  const pickFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    validateAndSetFiles(Array.from(incoming));
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isLoading) return;
    const dropped = Array.from(e.dataTransfer.files);
    validateAndSetFiles(dropped);
  };

  const removeFile = (idx: number) => {
    const nextFiles = files.filter((_, i) => i !== idx);
    const nextLabels = labels.filter((_, i) => i !== idx);
    setFiles(nextFiles);
    setLabels(nextLabels);
    if (nextFiles.length === 0) {
      setResult(null);
    }
  };

  const setLabelAt = (idx: number, value: string) => {
    setLabels((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  // Resolved participant id for file i: label if non-empty, else filename stem.
  const resolvedId = (idx: number) =>
    (labels[idx] ?? "").trim() || stemOf(files[idx]?.name ?? "");

  const submit = async () => {
    if (files.length === 0) {
      setError("Pick at least one .txt transcript first.");
      return;
    }

    // Resolved ids must be unique (labels override stems, but only if set).
    const ids = files.map((_, i) => resolvedId(i));
    if (new Set(ids).size !== ids.length) {
      setError(
        "Two participants resolve to the same id. Edit the labels so each is unique.",
      );
      return;
    }

    setError(null);
    setResult(null);
    setSaveStatus(null);
    setSaveError(null);
    setJob(null);
    setIsLoading(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("Please log in to synthesize.");
      setIsLoading(false);
      return;
    }

    const body = new FormData();
    files.forEach((f, i) => {
      body.append("files", f);
      // Send label per file in the same order. Empty string → backend
      // falls back to the filename stem.
      body.append("labels", labels[i] ?? "");
    });
    if (projectId) {
      // Project context only. The backend will not persist plaintext output
      // unless STORE_PLAINTEXT_SYNTHESES is explicitly enabled.
      body.append("project_id", projectId);
    }

    try {
      const res = await fetch(`${API_URL}/synthesize`, {
        method: "POST",
        body,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        const text = await res.text();
        let detail = text;
        try {
          const parsed = JSON.parse(text);
          detail =
            typeof parsed.detail === "string"
              ? parsed.detail
              : JSON.stringify(parsed.detail);
        } catch {
          /* non-JSON body, keep raw text */
        }
        throw new Error(detail || `Backend returned ${res.status}`);
      }

      // Backend returns 202 + {job_id}. We poll /jobs/{id} for progress.
      const { job_id } = (await res.json()) as {
        job_id: string;
        status: string;
      };
      setJob({
        job_id,
        status: "queued",
        current: null,
        total: null,
        file_progress: null,
        result: null,
        error: null,
      });
      pollJob(job_id);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unknown error calling backend";
      setError(message);
      setIsLoading(false);
    }
  };

  const copyMarkdown = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.markdown);
  };

  const saveEncrypted = async () => {
    if (!result) return;
    setSaveStatus(null);
    setSaveError(null);

    setIsSavingEncrypted(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error("Please log in before saving encrypted output.");
      }

      const plaintext = JSON.stringify({
        type: "gist.synthesis.v1",
        saved_at: new Date().toISOString(),
        project_id: result.project_id ?? projectId,
        markdown: result.markdown,
        stats: {
          cluster_count: result.cluster_count,
          participant_count: result.participant_count,
          themes_extracted: result.themes_extracted,
          themes_dropped: result.themes_dropped,
        },
      });
      const encrypted = await encryptStringWithLocalKey(plaintext);
      const { error: insertError } = await supabase
        .from("encrypted_artifacts")
        .insert({
          user_id: user.id,
          project_id: result.project_id ?? projectId,
          artifact_type: "synthesis",
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          salt: encrypted.salt,
          kdf: encrypted.kdf,
          iterations: encrypted.iterations,
          algorithm: encrypted.algorithm,
        });

      if (insertError) throw insertError;
      setSaveStatus(
        "Encrypted synthesis saved with this browser's private key.",
      );
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Encrypted save failed.");
    } finally {
      setIsSavingEncrypted(false);
    }
  };

  const audioFiles = files.filter((f) => isAudio(f.name));
  const estMinutes = totalEstimateMinutes(files);
  const hasAudio = audioFiles.length > 0;

  if (authLoading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-neutral-500">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <div className="relative overflow-hidden">
        {/* Soft radial gradient backdrop */}
        <div
          className="pointer-events-none absolute inset-0 bg-hero-radial"
          aria-hidden="true"
        />
        {/* Decorative floating orbs */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 h-72 w-72
                     rounded-full bg-brand-300/30 blur-3xl animate-float"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-72 -left-24 h-80 w-80
                     rounded-full bg-accent-400/20 blur-3xl animate-float"
          style={{ animationDelay: "1.5s" }}
        />

        <main className="page-wide relative">
          {/* Hero */}
          <section className="py-16 text-center sm:py-24">
            <div className="animate-fade-in-up">
              <span className="pill bg-brand-50 text-brand-700 ring-brand-200">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                Now with audio + Notion push
              </span>
            </div>

            <h1
              className="mt-6 text-5xl font-bold tracking-tight text-neutral-900 sm:text-6xl
                         animate-fade-in-up"
              style={{ animationDelay: "0.1s", animationFillMode: "backwards" }}
            >
              Turn interviews into{" "}
              <span
                className="bg-gradient-to-r from-brand-700 via-brand-500 via-accent-500 to-brand-700
                           bg-[length:200%_auto] bg-clip-text text-transparent
                           animate-gradient-pan"
              >
                insight
              </span>
            </h1>

            <p
              className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600 sm:text-xl
                         animate-fade-in-up"
              style={{ animationDelay: "0.2s", animationFillMode: "backwards" }}
            >
              Drop your customer-interview transcripts or audio. Get themed
              synthesis with traceable quotes — so you know exactly what to
              build next.
            </p>

            <div
              className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4
                         animate-fade-in-up"
              style={{ animationDelay: "0.3s", animationFillMode: "backwards" }}
            >
              <Link href="/signup" className="btn-primary px-6 py-3 text-base">
                Get started — free
                <svg
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
              <Link href="/login" className="btn-secondary px-6 py-3 text-base">
                Log in
              </Link>
            </div>

            <p
              className="mt-6 text-xs text-neutral-400 animate-fade-in-up"
              style={{ animationDelay: "0.4s", animationFillMode: "backwards" }}
            >
              No fake testimonials · No logos · Just a tool that works
            </p>
          </section>

          {/* Feature pills row */}
          <section
            className="mx-auto mt-8 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3
                       animate-fade-in-up"
            style={{ animationDelay: "0.5s", animationFillMode: "backwards" }}
          >
            <FeatureCard
              icon="⌁"
              title="Audio + text"
              body="Drop .mp3/.m4a/.wav up to 200 MB or paste a transcript. Whisper handles the rest."
            />
            <FeatureCard
              icon="◇"
              title="Verbatim quotes"
              body="Every theme is anchored to a real quote. Hallucinated paraphrases are dropped automatically."
            />
            <FeatureCard
              icon="↗"
              title="Push to Notion"
              body="One click sends the synthesis straight to a database in your workspace."
            />
          </section>

          {/* How-it-works strip */}
          <section className="mt-24">
            <div className="mx-auto max-w-3xl text-center">
              <span className="eyebrow">How it works</span>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                Four steps, ninety seconds
              </h2>
            </div>
            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-4">
              {[
                ["1", "Upload", "Drop transcripts or audio files"],
                ["2", "Transcribe", "Whisper turns audio into text"],
                ["3", "Synthesize", "Themes + insights, with quotes"],
                ["4", "Share", "Copy markdown or push to Notion"],
              ].map(([n, title, body], i) => (
                <div
                  key={n}
                  className="card card-hover p-5 animate-fade-in-up"
                  style={{
                    animationDelay: `${0.6 + i * 0.1}s`,
                    animationFillMode: "backwards",
                  }}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-white shadow-soft">
                    {n}
                  </div>
                  <h3 className="mt-4 font-semibold text-neutral-900">
                    {title}
                  </h3>
                  <p className="mt-1 text-sm text-neutral-600">{body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* CTA footer */}
          <section className="mt-24 pb-16 text-center">
            <div className="mx-auto max-w-2xl rounded-2xl bg-brand-gradient-soft p-10 ring-1 ring-brand-200">
              <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">
                Ready to stop reading transcripts?
              </h2>
              <p className="mt-2 text-neutral-600">
                Set up takes about a minute. Your first synthesis is free.
              </p>
              <Link
                href="/signup"
                className="btn-primary mt-6 px-6 py-3 text-base"
              >
                Create your account
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <main className="page">
      <header className="mb-8">
        <span className="eyebrow">Upload</span>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          New synthesis
        </h1>
        <p className="mt-1 text-neutral-600">
          Drop transcripts or audio. Get themed synthesis with traceable
          quotes.
        </p>
      </header>

      <section className="card p-6">
        {/* Drag-and-drop zone */}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`
            flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center
            transition-all duration-300 ease-out-expo
            ${
              isDragging
                ? "border-brand-500 bg-brand-50 scale-[1.01] shadow-glow"
                : "border-neutral-300 bg-neutral-50/50 hover:border-brand-300 hover:bg-brand-50/30"
            }
            ${isLoading ? "opacity-50" : ""}
          `}
        >
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand-gradient text-white shadow-soft animate-float">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"
              />
            </svg>
          </div>
          <p className="mt-4 text-base font-semibold text-neutral-800">
            {isDragging
              ? "Drop to upload"
              : "Drag & drop, or browse"}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            .txt, .mp3, .wav, .m4a, .mp4, .webm · up to {MAX_FILES} files · 200 MB each
          </p>
          <label className="btn-secondary mt-4 cursor-pointer text-xs">
            Browse files
            <input
              type="file"
              multiple
              accept={[
                ".txt",
                "text/plain",
                ...AUDIO_EXTS,
                "audio/*",
                "video/mp4",
                "video/webm",
              ].join(",")}
              onChange={(e) => pickFiles(e.target.files)}
              disabled={isLoading}
              className="hidden"
            />
          </label>
        </div>

        {files.length > 0 && (
          <div className="mt-6 space-y-3">
            <p className="eyebrow">Files ({files.length})</p>
            <ul className="space-y-2">
              {files.map((f, i) => {
                const fp = job?.file_progress?.find(
                  (p) => p.participant_id === resolvedId(i),
                );
                return (
                  <li
                    key={f.name + i}
                    className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-700 transition-all duration-200 hover:border-brand-200 hover:shadow-soft sm:flex-row sm:items-center sm:gap-3 animate-fade-in"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate font-medium">
                        {f.name}
                        <span className="ml-2 tabular-nums text-neutral-400">
                          {(f.size / 1024).toFixed(1)} KB
                        </span>
                      </span>
                      {fp && <FileStatusBadge status={fp.status} />}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={labels[i] ?? ""}
                        onChange={(e) => setLabelAt(i, e.target.value)}
                        disabled={isLoading}
                        placeholder={stemOf(f.name)}
                        className="input w-full py-1.5 text-xs sm:w-56"
                      />
                      {!isLoading && (
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="rounded-md px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-700"
                          title="Remove file"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {hasAudio && (
              <p className="rounded-lg bg-brand-50/50 px-3 py-2 text-xs text-brand-800">
                Estimated time: ~{estMinutes} min
                {estMinutes === 1 ? "" : "s"} for {audioFiles.length} audio
                file
                {audioFiles.length === 1 ? "" : "s"} (
                {(
                  audioFiles.reduce((s, f) => s + f.size, 0) /
                  1024 /
                  1024
                ).toFixed(1)}{" "}
                MB total). Text files are near-instant.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={isLoading || files.length === 0}
            className="btn-primary"
          >
            {isLoading ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeOpacity="0.25"
                    strokeWidth="3"
                  />
                  <path
                    d="M12 2a10 10 0 0110 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                Synthesizing…
              </>
            ) : (
              "Synthesize"
            )}
          </button>
          {files.length > 0 && !isLoading && (
            <span className="text-xs text-neutral-400">
              <kbd className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-neutral-600">
                ⌘
              </kbd>
              <span className="mx-1">+</span>
              <kbd className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-neutral-600">
                Enter
              </kbd>
            </span>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 animate-fade-in">
            {error}
          </p>
        )}
      </section>

      {isLoading && job && (
        <div className="card mt-6 p-6 animate-fade-in">
          <p className="text-sm font-semibold text-neutral-900">
            {stageLabel(job)}
          </p>
          <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            {(
              ["transcribing", "extracting", "clustering", "insights"] as const
            ).map((stage) => {
              const order = [
                "queued",
                "transcribing",
                "extracting",
                "clustering",
                "insights",
                "done",
              ];
              const reached = order.indexOf(job.status) >= order.indexOf(stage);
              const active = job.status === stage;
              return (
                <li
                  key={stage}
                  className={`flex items-center gap-1.5 transition-colors ${
                    active
                      ? "font-semibold text-brand-700"
                      : reached
                        ? "text-neutral-700"
                        : "text-neutral-400"
                  }`}
                >
                  <span
                    className={`grid h-4 w-4 place-items-center rounded-full text-[8px] transition-all ${
                      active
                        ? "bg-brand-gradient text-white shadow-glow"
                        : reached
                          ? "bg-brand-200 text-brand-700"
                          : "bg-neutral-200 text-neutral-400"
                    }`}
                  >
                    {reached ? "✓" : "○"}
                  </span>
                  {stage}
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-xs text-neutral-400">
            Polling /jobs/{job.job_id.slice(0, 8)} every {POLL_MS / 1000}s · Audio
            adds ~1 min per 5 min of recording.
          </p>
        </div>
      )}

      {result && !result.synthesis_id && (
        <section className="card mt-6 p-6 animate-fade-in">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="eyebrow">
              {result.participant_count} participants ·{" "}
              {result.cluster_count} clusters · {result.themes_extracted} themes
              {result.themes_dropped > 0
                ? ` (${result.themes_dropped} dropped)`
                : ""}
            </p>
            <button
              type="button"
              onClick={copyMarkdown}
              className="btn-secondary text-xs"
            >
              Copy markdown
            </button>
          </div>
          <article className="prose prose-neutral prose-brand max-w-none">
            <ReactMarkdown>{result.markdown}</ReactMarkdown>
          </article>

          <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50/40 p-4">
            <p className="text-sm font-semibold text-neutral-900">
              Save encrypted
            </p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">
              The report is encrypted with a private key generated and stored
              in this browser. Gist stores ciphertext only. If browser storage
              is cleared or you switch devices, this saved report cannot be
              recovered until export/import is added.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveEncrypted}
                disabled={isSavingEncrypted}
                className="btn-primary text-xs"
              >
                {isSavingEncrypted ? "Encrypting..." : "Save encrypted"}
              </button>
              {saveStatus && (
                <span className="text-xs text-green-700">{saveStatus}</span>
              )}
              {saveError && (
                <span className="text-xs text-red-700">{saveError}</span>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
