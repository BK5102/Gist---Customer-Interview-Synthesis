"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { encryptStringWithPassword } from "@/lib/encryption";
import { createClient } from "@/lib/supabase/client";
import { PASSWORD_RULES, isValidPassword, validatePassword } from "@/lib/password";
import { Breadcrumb } from "@/components/Breadcrumb";

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

// Returns true when the string is parseable JSON (object or array) rather than
// markdown. Catches the edge case where the backend accidentally surfaces a
// raw JSON payload in the markdown field.
function looksLikeJson(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function SignedInHome() {
  return (
    <main className="page-wide">
      <header className="mb-8">
        <p className="eyebrow">Workspace</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Your workspace
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
          All synthesis work happens inside a project. Create a project, upload
          interviews, and save the report with a password you choose.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Link href="/projects" className="card card-hover p-5">
          <p className="text-sm font-semibold text-neutral-900">Projects</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            Create a project and run syntheses within it. Each project keeps
            one research round in one place.
          </p>
        </Link>
        <Link href="/encrypted" className="card card-hover p-5">
          <p className="text-sm font-semibold text-neutral-900">
            Private saves
          </p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            Return to a saved report. Decrypt it with the password you set
            when you saved it.
          </p>
        </Link>
      </section>

      <section className="mt-8 rounded-xl border border-neutral-200 bg-neutral-50 p-6">
        <h2 className="text-sm font-semibold text-neutral-900">How it works</h2>
        <div className="mt-4 grid gap-3 text-xs text-neutral-700 sm:grid-cols-3">
          <div>
            <p className="font-semibold text-neutral-900">1. Create a project</p>
            <p className="mt-1 leading-relaxed">
              Group interviews by research round, customer segment, or topic.
            </p>
          </div>
          <div>
            <p className="font-semibold text-neutral-900">2. Run a synthesis</p>
            <p className="mt-1 leading-relaxed">
              Upload transcripts or audio within the project and keep the tab
              open while it runs.
            </p>
          </div>
          <div>
            <p className="font-semibold text-neutral-900">3. Save privately</p>
            <p className="mt-1 leading-relaxed">
              Encrypt the report with a password you choose. It's not stored
              anywhere — only you can open it.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  // Optional ?project=<uuid> identifies the project context. Production does
  // not persist plaintext synthesis output by default.
  const searchParams = useSearchParams();
  const projectId = searchParams?.get("project") ?? null;
  const uploadMode = searchParams?.get("upload") === "1";
  const landingMode = searchParams?.get("landing") === "1";

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
  const [privateSaveTitle, setPrivateSaveTitle] = useState("");
  const [privateSavePassword, setPrivateSavePassword] = useState("");
  const [privateSavePasswordConfirm, setPrivateSavePasswordConfirm] =
    useState("");
  const [isSavingEncrypted, setIsSavingEncrypted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
        let detail = `Backend returned ${res.status}`;
        try {
          const parsed = JSON.parse(text);
          detail =
            typeof parsed.detail === "string"
              ? parsed.detail
              : Array.isArray(parsed.detail)
                ? parsed.detail.map((d: any) => d.msg ?? JSON.stringify(d)).join("; ")
                : text || detail;
        } catch {
          if (text) detail = text;
        }
        throw new Error(detail);
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
    setPrivateSaveTitle("");
    setPrivateSavePassword("");
    setPrivateSavePasswordConfirm("");
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

    const password = privateSavePassword;
    const title =
      privateSaveTitle.trim() ||
      `Synthesis - ${new Date().toLocaleDateString()}`;
    const pwError = validatePassword(password);
    if (pwError) { setSaveError(pwError); return; }
    if (password !== privateSavePasswordConfirm) {
      setSaveError("Passwords do not match.");
      return;
    }

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
        title,
        markdown: result.markdown,
        stats: {
          cluster_count: result.cluster_count,
          participant_count: result.participant_count,
          themes_extracted: result.themes_extracted,
          themes_dropped: result.themes_dropped,
        },
      });
      const encrypted = await encryptStringWithPassword(plaintext, password);
      const { error: insertError } = await supabase
        .from("encrypted_artifacts")
        .insert({
          user_id: user.id,
          project_id: result.project_id ?? projectId,
          artifact_type: "synthesis",
          title,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          salt: encrypted.salt,
          kdf: encrypted.kdf,
          iterations: encrypted.iterations,
          algorithm: encrypted.algorithm,
        });

      if (insertError) throw insertError;
      setPrivateSavePassword("");
      setPrivateSavePasswordConfirm("");
      setSaveStatus("Private synthesis saved. Use your password to open it.");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Encrypted save failed.");
    } finally {
      setPrivateSavePassword("");
      setPrivateSavePasswordConfirm("");
      setIsSavingEncrypted(false);
    }
  };

  const audioFiles = files.filter((f) => isAudio(f.name));
  const estMinutes = totalEstimateMinutes(files);
  const hasAudio = audioFiles.length > 0;

  const strength = (
    !privateSavePassword
      ? 0
      : PASSWORD_RULES.filter((r) => r.test(privateSavePassword)).length
  ) as 0 | 1 | 2 | 3 | 4;

  if (authLoading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-neutral-500">Loading…</p>
      </main>
    );
  }

  /* ── Landing page (signed out, or signed in with ?landing=1) ── */

  if (!user || landingMode) {
    return (
      <main className="page-wide">
        {/* Hero — left-aligned, no decorative elements */}
        <section className="py-16 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl">
            Read ten interviews at once.{" "}
            <span className="text-brand-700">Every finding traced to who said it.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-neutral-600">
            Upload transcripts or drop audio files. Gist clusters themes across
            all your interviews and pulls direct quotes — not rewrites. A second
            pass checks every quote against the source before it reaches you.
          </p>

          <p className="mt-4 text-sm font-medium text-neutral-500">
            For founders and product researchers who run their own interviews.
            Not designed for enterprise teams with dedicated research ops.
          </p>

          <div className="mt-8 flex gap-3">
            <Link
              href={user ? "/" : "/signup"}
              className="btn-primary px-6 py-3"
            >
              {user ? "Open workspace" : "Get started"}
            </Link>
            <Link
              href={user ? "/projects" : "/login"}
              className="btn-secondary px-6 py-3"
            >
              {user ? "Go to projects" : "Log in"}
            </Link>
          </div>
        </section>

        {/* Value propositions — asymmetric: lead card spans 2 cols */}
        <section className="border-t border-neutral-200 pt-16">
          <p className="eyebrow">What it does</p>
          <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 sm:grid-cols-3">
            <div className="bg-white p-6 sm:col-span-2">
              <h3 className="text-sm font-semibold text-neutral-900">
                Every quote checked against the transcript
              </h3>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-neutral-600">
                After generating themes, Gist runs a second pass that checks
                each quote against the original text verbatim. Quotes that don't
                appear in the source are dropped, not rewritten. You get fewer
                quotes, but the ones you see are real.
              </p>
            </div>
            <div className="bg-white p-6">
              <h3 className="text-sm font-semibold text-neutral-900">
                Reports encrypted in your browser
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                The report is encrypted here before it's stored. The password
                never leaves your device — Gist can't access your saves.
              </p>
            </div>
            <div className="bg-white p-6">
              <h3 className="text-sm font-semibold text-neutral-900">
                Audio files and text transcripts
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Accepts .mp3, .wav, .m4a, and .mp4 up to 200 MB. Audio is
                transcribed via Whisper, then goes through the same pipeline as
                a text file.
              </p>
            </div>
            <div className="bg-white p-6 sm:col-span-2">
              <h3 className="text-sm font-semibold text-neutral-900">
                Send the report to Notion
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                Pick a database from your Notion workspace and Gist writes the
                synthesis there as a new page. The connection uses OAuth — no
                API keys to copy and paste.
              </p>
            </div>
          </div>
        </section>

        {/* How it works — compact numbered list, not cards */}
        <section className="mt-16 border-t border-neutral-200 pt-16">
          <p className="eyebrow">How it works</p>
          <div className="mt-8 grid gap-6 sm:grid-cols-4">
            {(
              [
                ["1", "Upload", "Add your .txt, .mp3, or .wav files — up to 20 at once"],
                ["2", "Transcribe", "Audio is transcribed via Whisper before synthesis runs"],
                ["3", "Synthesize", "Themes are clustered across all participants, each anchored to a direct quote"],
                ["4", "Export", "Copy the report as markdown or send it to a Notion database"],
              ] as const
            ).map(([n, title, body]) => (
              <div key={n} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-white">
                  {n}
                </span>
                <div>
                  <p className="text-sm font-semibold text-neutral-900">
                    {title}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Minimal CTA — only shown to signed-out visitors */}
        {!user && (
          <section className="mt-16 border-t border-neutral-200 py-16">
            <p className="text-neutral-600">
              Works with transcripts you already have, audio files you haven't
              had time to review, or both.
            </p>
            <Link href="/signup" className="btn-primary mt-4 px-6 py-3">
              Create an account
            </Link>
          </section>
        )}
      </main>
    );
  }

  /* ── Signed-in workspace hub ── */

  if (!projectId && files.length === 0 && !isLoading && !result) {
    return <SignedInHome />;
  }

  /* ── Upload + synthesis UI ── */

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
        <h1 className="text-2xl font-semibold tracking-tight">
          New synthesis
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Add one or more transcripts or audio files. Gist clusters themes
          across all of them and pulls a verbatim quote from each.
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
            transition-colors duration-150
            ${
              isDragging
                ? "border-brand-700 bg-brand-50"
                : "border-neutral-300 bg-neutral-50/50 hover:border-neutral-400"
            }
            ${isLoading ? "opacity-50" : ""}
          `}
        >
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-zinc-900 text-white">
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
                    className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-700 sm:flex-row sm:items-center sm:gap-3"
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
              <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
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
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 animate-spin text-brand-700"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeOpacity="0.2"
                strokeWidth="3"
              />
              <path
                d="M12 2a10 10 0 0110 10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <p className="text-sm font-semibold text-neutral-900">
              {stageLabel(job)}
            </p>
          </div>

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
                      ? "font-semibold text-brand-800"
                      : reached
                        ? "text-neutral-700"
                        : "text-neutral-400"
                  }`}
                >
                  <span
                    className={`grid h-4 w-4 place-items-center rounded-full text-[8px] transition-colors ${
                      active
                        ? "bg-zinc-900 text-white"
                        : reached
                          ? "bg-neutral-300 text-neutral-700"
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

          <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
            <p className="text-xs font-semibold text-neutral-800">
              You can switch to another tab — just don't close this one.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              The synthesis runs in the background. Results will load here
              automatically when it's done. Text files usually finish in under
              a minute; audio takes roughly 1 minute of processing per 5
              minutes of recording.
            </p>
          </div>
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
            {!result.markdown ? (
              <p className="text-sm text-neutral-500">
                No synthesis content was returned. Please try again.
              </p>
            ) : looksLikeJson(result.markdown) ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-medium">Synthesis result could not be rendered.</p>
                <p className="mt-1 text-xs">
                  The server returned an unexpected response format. Try
                  re-running the synthesis — this is usually a one-off issue.
                </p>
              </div>
            ) : (
              <ReactMarkdown>{result.markdown}</ReactMarkdown>
            )}
          </article>

          <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm font-semibold text-neutral-900">
              Save privately
            </p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">
              The report is encrypted in your browser before being stored. The
              password stays on your device — Gist never sees it.
            </p>
            <div className="mt-3 grid gap-3">
              <input
                type="text"
                value={privateSaveTitle}
                onChange={(e) => setPrivateSaveTitle(e.target.value)}
                placeholder="Title — e.g. Pricing interviews, May 2026"
                className="input"
              />
              <div className="grid gap-3">
                {/* Private password */}
                <div>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={privateSavePassword}
                      onChange={(e) => setPrivateSavePassword(e.target.value)}
                      placeholder="Private password"
                      className="input pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                    >
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>

                  {privateSavePassword && (
                    <>
                      <div className="mt-2 flex gap-1">
                        {[1, 2, 3, 4].map((seg) => (
                          <div
                            key={seg}
                            className={`h-1 flex-1 rounded-full transition-colors duration-150 ${
                              seg <= strength
                                ? (["", "bg-red-400", "bg-orange-400", "bg-yellow-400", "bg-green-500"] as const)[strength]
                                : "bg-neutral-200"
                            }`}
                          />
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">
                        {(["", "Weak", "Fair", "Good", "Strong"] as const)[strength]}
                      </p>
                      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                        {PASSWORD_RULES.map((rule) => {
                          const ok = rule.test(privateSavePassword);
                          return (
                            <li
                              key={rule.label}
                              className={`flex items-center gap-1.5 text-xs transition-colors duration-100 ${ok ? "text-green-600" : "text-neutral-400"}`}
                            >
                              <span className="shrink-0 font-medium">{ok ? "✓" : "✗"}</span>
                              {rule.label}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={privateSavePasswordConfirm}
                      onChange={(e) => setPrivateSavePasswordConfirm(e.target.value)}
                      placeholder="Confirm password"
                      className="input pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      tabIndex={-1}
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                    >
                      {showConfirmPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>

                  {privateSavePasswordConfirm && (
                    <p className={`mt-1.5 text-xs font-medium ${
                      privateSavePassword === privateSavePasswordConfirm
                        ? "text-green-600"
                        : "text-red-500"
                    }`}>
                      {privateSavePassword === privateSavePasswordConfirm
                        ? "Passwords match ✓"
                        : "Passwords don't match ✗"}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveEncrypted}
                disabled={
                  isSavingEncrypted ||
                  !isValidPassword(privateSavePassword) ||
                  privateSavePassword !== privateSavePasswordConfirm
                }
                className="btn-primary text-xs"
              >
                {isSavingEncrypted ? "Encrypting..." : "Save privately"}
              </button>
              <Link href="/projects" className="btn-secondary text-xs">
                Do not save
              </Link>
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
