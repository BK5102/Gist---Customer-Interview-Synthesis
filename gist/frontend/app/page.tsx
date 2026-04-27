"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";

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
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SynthesizeResponse | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth state on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthLoading(false);
    });
  }, []);

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
      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-900">
          Turn interviews into insight
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-lg text-neutral-600">
          Upload customer interview transcripts or audio. Get a themed synthesis
          with traceable quotes — so you know exactly what to build next.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <a
            href="/signup"
            className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-neutral-700"
          >
            Get started
          </a>
          <a
            href="/login"
            className="rounded-md border border-neutral-300 px-5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Log in
          </a>
        </div>
        <p className="mt-6 text-xs text-neutral-400">
          No fake testimonials. No logos. Just a tool that works.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Gist</h1>
        <p className="mt-2 text-neutral-600">
          Drop customer-interview transcripts. Get themed synthesis with
          traceable quotes.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        {/* Drag-and-drop zone */}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`
            flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors
            ${isDragging ? "border-neutral-900 bg-neutral-50" : "border-neutral-300"}
            ${isLoading ? "opacity-50" : ""}
          `}
        >
          <p className="text-sm font-medium text-neutral-700">
            {isDragging
              ? "Drop files here"
              : "Drag & drop transcripts or audio here"}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            .txt, .mp3, .wav, .m4a, .mp4, .webm — up to {MAX_FILES} files
          </p>
          <label className="mt-3 inline-flex cursor-pointer items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50">
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
          <div className="mt-4 space-y-3">
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              Files ({files.length})
            </p>
            <ul className="space-y-2">
              {files.map((f, i) => {
                const fp = job?.file_progress?.find(
                  (p) => p.participant_id === resolvedId(i),
                );
                return (
                  <li
                    key={f.name + i}
                    className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate">
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
                        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none disabled:opacity-50 sm:w-64"
                      />
                      {!isLoading && (
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          title="Remove file"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {hasAudio && (
              <p className="text-xs text-neutral-500">
                Estimated time: ~{estMinutes} min
                {estMinutes === 1 ? "" : "s"} for{" "}
                {audioFiles.length} audio file
                {audioFiles.length === 1 ? "" : "s"} (
                {(audioFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)}{" "}
                MB total). Text files are near-instant.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={isLoading || files.length === 0}
          className="mt-6 inline-flex items-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Synthesizing…" : "Synthesize"}
        </button>

        {error && (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
      </section>

      {isLoading && job && (
        <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-neutral-700">
            {stageLabel(job)}
          </p>
          <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-500 sm:grid-cols-4">
            {(
              [
                "transcribing",
                "extracting",
                "clustering",
                "insights",
              ] as const
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
                  className={
                    active
                      ? "font-semibold text-neutral-900"
                      : reached
                        ? "text-neutral-700"
                        : "text-neutral-400"
                  }
                >
                  {reached ? "●" : "○"} {stage}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-neutral-400">
            Polling /jobs/{job.job_id.slice(0, 8)} every {POLL_MS / 1000}s.
            Audio adds ~1 min per 5 min of recording.
          </p>
        </div>
      )}

      {result && (
        <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              {result.participant_count} participants ·{" "}
              {result.cluster_count} clusters · {result.themes_extracted} themes
              {result.themes_dropped > 0
                ? ` (${result.themes_dropped} dropped)`
                : ""}
            </p>
            <button
              type="button"
              onClick={copyMarkdown}
              className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
            >
              Copy markdown
            </button>
          </div>
          <article className="prose prose-neutral max-w-none prose-headings:font-semibold prose-h1:text-2xl prose-h2:mt-8 prose-h2:border-t prose-h2:border-neutral-200 prose-h2:pt-6 prose-h3:mt-6 prose-blockquote:border-l-neutral-300 prose-blockquote:text-neutral-600">
            <ReactMarkdown>{result.markdown}</ReactMarkdown>
          </article>
        </section>
      )}
    </main>
  );
}
