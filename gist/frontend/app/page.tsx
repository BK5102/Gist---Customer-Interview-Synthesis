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
const MAX_DOC_BYTES  = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024; // backend chunks anything >25 MB
const MAX_FILES = 20;
const TEXT_EXTS  = [".txt"];
const DOC_EXTS   = [".pdf", ".pptx", ".docx"];
const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".mp4", ".webm", ".mpeg", ".mpga"];
const ALLOWED_EXTS = [...TEXT_EXTS, ...DOC_EXTS, ...AUDIO_EXTS];

const extOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};
const isAudio = (name: string) => AUDIO_EXTS.includes(extOf(name));
const isDoc   = (name: string) => DOC_EXTS.includes(extOf(name));

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

type ExpertRecommendation = {
  role: string;
  perspective: string;
  insights: string[];
};

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
  expert_recommendations?: ExpertRecommendation[] | null;
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
    | "experts"
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
      return "Clustering themes across sources…";
    case "insights":
      return "Generating key takeaways…";
    case "experts":
      return "Identifying relevant experts…";
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
        <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">
          Transcribing…
        </span>
      );
    case "extracting":
      return (
        <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
          Extracting…
        </span>
      );
    case "extracted":
      return (
        <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">
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

function ProductDemo() {
  return (
    <div className="product-frame" aria-hidden="true">
      <div className="product-frame-bar">
        <span />
        <span />
        <span />
        <p>Case #2024-0847: witness statements</p>
      </div>
      <div className="product-frame-head">
        <div>
          <p className="product-kicker">Incident review</p>
          <h2>Timeline discrepancy: 4 witness accounts</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="meta-chip">4 interviews</span>
            <span className="meta-chip">11 themes</span>
            <span className="meta-chip">Verified quotes</span>
          </div>
        </div>
        <span className="verification-pill">
          <span className="verification-dot" />
          Verification complete
        </span>
      </div>
      <div className="workspace-tabs" role="presentation">
        <span className="is-active">Summary</span>
        <span>Contradictions</span>
        <span>Sources</span>
      </div>
      <div className="product-split">
        <div className="product-report">
          <p className="product-kicker">Contradiction flagged</p>
          <h3>Three witnesses align on timing. One account diverges by 40 minutes.</h3>
          <p>
            Four transcripts cross-referenced. One unresolved discrepancy
            surfaced for prosecutor review.
          </p>
          <div className="finding-list">
            <div>
              <span className="finding-index">01</span>
              <p>
                P1, P2, and P4 independently place the incident before 9:00 PM.
              </p>
            </div>
            <div>
              <span className="finding-index">02</span>
              <p>
                P3 describes the same sequence near 9:40 PM, inconsistent with
                all three other accounts.
              </p>
            </div>
          </div>
        </div>
        <aside className="product-evidence">
          <div className="flex items-center justify-between">
            <p className="product-kicker text-brand-100">Evidence</p>
            <span className="text-xs text-brand-200">4 witnesses</span>
          </div>
          <blockquote>
            "It was still light out. Couldn't have been past 8:45 when it
            happened."
          </blockquote>
          <div className="evidence-source">
            <span>P1</span>
            <div>
              <p>Witness interview</p>
              <small>Transcript matched verbatim</small>
            </div>
          </div>
          <div className="evidence-progress">
            <span />
          </div>
        </aside>
      </div>
    </div>
  );
}

function LandingFooter() {
  const signupLinks = ["Projects", "Private saves", "Settings"];

  return (
    <footer className="relative z-10 mt-6 bg-brand-950 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-brand-200">
            Brief your expert in minutes
          </p>
          <h2 className="mt-2 max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
            Turn any conversation into evidence your expert can act on.
          </h2>
          <Link href="/signup" prefetch={false} className="btn-secondary mt-5">
            Create an account
          </Link>
        </div>
        <div className="flex flex-col gap-4 sm:items-end">
          <Link href="/" className="text-3xl font-bold tracking-tight">
            Gist
          </Link>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-brand-100">
            {signupLinks.map((label) => (
              <Link
                key={label}
                href="/signup"
                prefetch={false}
                className="transition-colors hover:text-white"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

type RecentSave = { id: string; title: string | null; created_at: string; project_id: string | null };

function SignedInHome() {
  const [recentSaves, setRecentSaves] = useState<RecentSave[]>([]);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("encrypted_artifacts")
        .select("id,title,created_at,project_id")
        .eq("artifact_type", "synthesis")
        .order("created_at", { ascending: false })
        .limit(5);
      setRecentSaves((data ?? []) as RecentSave[]);
    };
    load();
  }, []);

  return (
    <main className="page-wide">
      <header className="motion-section mb-6">
        <h1 className="page-title max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Turn any conversation into a brief your expert can act on.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-300">
          Start with a project, synthesize your conversations, then save the report privately.
        </p>
      </header>

      <Link href="/projects" className="card card-hover motion-card block p-6">
        <div className="mb-4 h-1.5 w-16 rounded-full bg-brand-600" />
        <p className="text-base font-semibold text-neutral-900">Projects</p>
        <p className="mt-2 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
          Create a project and run syntheses within it. Each project keeps
          one conversation batch in one place.
        </p>
        <p className="mt-5 text-sm font-semibold text-brand-800">
          Open projects &rarr;
        </p>
      </Link>

      {recentSaves.length > 0 && (
        <section className="surface-panel mt-6 p-5 motion-section">
          <p className="product-kicker mb-3">Recent syntheses</p>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {recentSaves.map((save) => (
              <li key={save.id}>
                <Link
                  href={save.project_id ? `/encrypted?project=${save.project_id}` : "/encrypted"}
                  className="group flex items-center justify-between gap-4 px-1 py-3 text-sm transition-colors hover:bg-brand-50 dark:hover:bg-brand-950/30"
                >
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    {save.title || "Private synthesis"}
                  </span>
                  <span className="text-sm font-medium text-neutral-500 group-hover:text-brand-700 dark:text-neutral-300 dark:group-hover:text-brand-300">
                    {new Date(save.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}{" "}
                    &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
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
  const [notionConnected, setNotionConnected] = useState(false);
  const [notionDatabases, setNotionDatabases] = useState<{ id: string; title: string }[]>([]);
  const [notionSelectedDb, setNotionSelectedDb] = useState("");
  const [notionPushing, setNotionPushing] = useState(false);
  const [notionPushError, setNotionPushError] = useState<string | null>(null);
  const [notionPushUrl, setNotionPushUrl] = useState<string | null>(null);
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
        if (res.status === 404) {
          throw new Error(
            "The server restarted while your synthesis was running. Please try again. This usually happens right after a deploy."
          );
        }
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
          return;
        }
        // Load Notion connection for the inline push button.
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
                  const dbs = await dbRes.json() as { id: string; title: string }[];
                  setNotionDatabases(dbs);
                  if (dbs.length > 0) setNotionSelectedDb(dbs[0].id);
                }
              }
            }
          } catch { /* Notion check failed — push UI stays hidden */ }
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
      const cap = isAudio(f.name) ? MAX_AUDIO_BYTES : isDoc(f.name) ? MAX_DOC_BYTES : MAX_TEXT_BYTES;
      return f.size > cap;
    });
    if (tooBig) {
      const cap = isAudio(tooBig.name) ? MAX_AUDIO_BYTES : isDoc(tooBig.name) ? MAX_DOC_BYTES : MAX_TEXT_BYTES;
      setError(
        `${tooBig.name} is larger than ${(cap / 1024 / 1024).toFixed(0)} MB.`,
      );
      return;
    }

    // Accumulate: merge with existing files, skipping exact filename duplicates.
    const existingNames = new Set(files.map((f) => f.name));
    const incoming = picked.filter((f) => !existingNames.has(f.name));
    const merged = [...files, ...incoming];

    if (merged.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files per request.`);
      return;
    }

    const stems = merged.map((f) => stemOf(f.name));
    if (new Set(stems).size !== stems.length) {
      setError(
        "Duplicate filenames detected. Each transcript stem must be unique (e.g. P1.txt, P2.txt).",
      );
      return;
    }

    setFiles(merged);
    setLabels((prev) => [...prev, ...incoming.map(() => "")]);
    setResult(null);
    setPrivateSaveTitle((prev) => prev || stemOf(merged[0].name));
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

  const pushToNotion = async () => {
    if (!result || !notionSelectedDb) return;
    setNotionPushing(true);
    setNotionPushError(null);
    setNotionPushUrl(null);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`${API_URL}/notion/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ markdown: result.markdown, database_id: notionSelectedDb }),
    });
    setNotionPushing(false);
    if (!res.ok) {
      const text = await res.text();
      let detail = text || "Push failed";
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch { /* keep raw */ }
      setNotionPushError(detail);
      return;
    }
    const data = await res.json() as { notion_page_url: string };
    setNotionPushUrl(data.notion_page_url);
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

  const strength: 0 | 1 | 2 | 3 | 4 = (() => {
    if (!privateSavePassword) return 0;
    const passed = PASSWORD_RULES.filter((r) => r.test(privateSavePassword)).length;
    if (passed <= 2) return 1;
    if (passed === 3) return 2;
    if (passed === 4) return 3;
    return 4;
  })();

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
      <>
        <main className="page-wide">
          <section className="grid items-center gap-5 pb-4 pt-2 lg:grid-cols-[1.05fr_0.95fr] lg:pb-6">
          <div className="motion-section">
            <h1 className="page-title max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
              Drop a file.{" "}
              <span className="text-gradient">Get the expert perspective.</span>
            </h1>

            <p className="mt-3 max-w-2xl text-xl leading-relaxed text-neutral-700 dark:text-neutral-300">
              Upload a PDF, transcript, recording, or slide deck. Gist extracts verified findings and shows what the right expert would do with them.
            </p>

          <p className="mt-3 max-w-xl text-base font-semibold leading-snug text-neutral-600 dark:text-neutral-200">
            For legal teams, consultants, investigators, product teams, and anyone making decisions from complex material.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
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

          <div className="mt-4 flex flex-wrap gap-2">
            {([
              {
                label: "Browser-encrypted saves",
                icon: (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
                    <rect x="3" y="8" width="10" height="7" rx="1.5" />
                    <path d="M5.5 8V5.5a2.5 2.5 0 0 1 5 0V8" />
                  </svg>
                ),
              },
              {
                label: "Verbatim quote verification",
                icon: (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
                    <polyline points="2.5 8.5 6 12 13.5 4" />
                  </svg>
                ),
              },
              {
                label: "No transcript storage",
                icon: (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
                    <path d="M8 1.5L2 4v4c0 3.5 2.5 6.75 6 7.75C11.5 14.75 14 11.5 14 8V4L8 1.5z" />
                    <line x1="5.5" y1="8" x2="10.5" y2="8" />
                  </svg>
                ),
              },
              {
                label: "PDF, DOCX, PPT & audio",
                icon: (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
                    <path d="M4 1.5h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
                    <path d="M9 1.5v3h3" />
                    <line x1="5" y1="8" x2="11" y2="8" />
                    <line x1="5" y1="11" x2="9" y2="11" />
                  </svg>
                ),
              },
            ] as { label: string; icon: React.ReactNode }[]).map(({ label, icon }) => (
              <span key={label} className="trust-chip">
                {icon}
                {label}
              </span>
            ))}
          </div>
          </div>

          <div className="depth-scene motion-card [animation-delay:120ms]">
            <ProductDemo />
          </div>
          </section>

          <section id="features" className="motion-section py-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="feature-card bg-brand-50 dark:bg-brand-950/20 sm:col-span-2">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700/10 text-brand-700 dark:bg-brand-400/10 dark:text-brand-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="8.5 12 11 14.5 15.5 9.5" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-neutral-950 dark:text-neutral-50">
                AI tools summarize. Gist verifies.
              </h3>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-neutral-700 dark:text-neutral-300">
                A lawyer needs exact quotes from a deposition. A detective
                needs consistent statements across witnesses. A consultant
                needs the client's real priorities from discovery calls. Every
                theme Gist surfaces comes with a quote checked verbatim against
                the source. If the exact words aren't in the transcript, the
                theme is dropped. Every claim is traceable.
              </p>
            </div>
            <div className="feature-card bg-white dark:bg-neutral-900">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-neutral-950 dark:text-neutral-50">
                Sensitive conversations stay sensitive.
              </h3>
              <p className="mt-3 text-base leading-relaxed text-neutral-700 dark:text-neutral-300">
                Depositions, discovery calls, witness interviews. Precisely
                the conversations that need synthesis are the ones that need
                protection. Reports encrypt in your browser before they are
                stored. The password never reaches our servers. Gist cannot
                read what you save.
              </p>
            </div>
            <div className="feature-card bg-brand-50 dark:bg-brand-950/20">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700/10 text-brand-700 dark:bg-brand-400/10 dark:text-brand-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                  <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                  <line x1="8" y1="22" x2="16" y2="22" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-neutral-950 dark:text-neutral-50">
                Any file. One pipeline.
              </h3>
              <p className="mt-3 text-base leading-relaxed text-neutral-700 dark:text-neutral-300">
                PDF, PPTX, DOCX, TXT, or audio recordings. Drop any artifact
                and Gist extracts its text, runs the same verified synthesis,
                and identifies the right experts for the domain. One file or
                twenty.
              </p>
            </div>
            <div className="feature-card bg-white dark:bg-neutral-900 sm:col-span-2">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-neutral-950 dark:text-neutral-50">
                Deliver the brief where your expert already works.
              </h3>
              <p className="mt-3 text-base leading-relaxed text-neutral-700 dark:text-neutral-300">
                Connect Notion once, no API keys. Push any synthesis directly
                to the database your lawyer, client, or team already uses. Every
                theme, verified quote, and source lands as a formatted page,
                ready to act on.
              </p>
              {user && (
                <Link
                  href="/settings#integrations"
                  className="btn-primary mt-4 inline-flex px-4 py-2 text-sm"
                >
                  Deliver the brief where your expert already works.
                </Link>
              )}
            </div>
          </div>
          </section>

        </main>
        {!user && <LandingFooter />}
      </>
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
      <header className="motion-section mb-6">
        <h1 className="page-title text-3xl font-semibold tracking-tight">
          New synthesis
        </h1>
        <p className="mt-2 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
          Add one or more artifacts — PDFs, documents, transcripts, or audio files. Gist extracts verified findings, identifies relevant experts, and shows what they would do with this material.
        </p>
      </header>

      <section className="card motion-card p-6">
        {/* Drag-and-drop zone */}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`
            flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center
            transition-all duration-300 ease-out
            ${
              isDragging
                ? "scale-[1.01] border-brand-700 bg-brand-50 dark:bg-brand-950/30"
                : "border-neutral-300 dark:border-neutral-600 bg-white/50 dark:bg-neutral-800/60 hover:-translate-y-0.5 hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-950/20"
            }
            ${isLoading ? "opacity-50" : ""}
          `}
        >
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand-950 text-white transition-transform duration-300 group-hover:scale-105">
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
          <p className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-100">
            {isDragging
              ? "Drop to add files"
              : files.length > 0 ? "Add more files" : "Drag & drop, or browse"}
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
            .pdf, .pptx, .docx, .txt, .mp3, .wav, .m4a, .mp4, .webm · up to {MAX_FILES} files · 200 MB audio
          </p>
          <label className="btn-secondary mt-4 cursor-pointer text-xs">
            Browse files
            <input
              type="file"
              multiple
              accept={[
                ".txt",
                "text/plain",
                ".pdf",
                "application/pdf",
                ".pptx",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                ".docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
          <div className="fade-panel mt-6 space-y-3">
            <p className="eyebrow">Files ({files.length})</p>
            <ul className="space-y-2">
              {files.map((f, i) => {
                const fp = job?.file_progress?.find(
                  (p) => p.participant_id === resolvedId(i),
                );
                return (
                  <li
                    key={f.name + i}
                    className="flex flex-col gap-2 rounded-lg bg-white/75 p-3 text-sm text-neutral-700 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white dark:bg-neutral-800/75 dark:text-neutral-200 dark:hover:bg-neutral-800 sm:flex-row sm:items-center sm:gap-3"
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
              <p className="surface-panel px-3 py-2 text-xs text-neutral-700">
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
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 animate-fade-in">
            {error}
          </p>
        )}
      </section>

      {isLoading && job && (
        <div className="card mt-6 p-6 animate-rise-in">
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

          <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
            {(
              ["transcribing", "extracting", "clustering", "insights", "experts"] as const
            ).map((stage) => {
              const order = [
                "queued",
                "transcribing",
                "extracting",
                "clustering",
                "insights",
                "experts",
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
                        ? "bg-brand-950 text-white"
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

          <div className="surface-panel mt-4 px-4 py-3">
            <p className="text-xs font-semibold text-neutral-800">
              You can switch to another tab. Just don't close this one.
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
        <section className="card mt-6 p-6 animate-rise-in">
          <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
            Scroll down to save. Navigating away will lose this synthesis.
          </p>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="eyebrow">
              {result.participant_count} participants ·{" "}
              {result.cluster_count} clusters · {result.themes_extracted} themes
              {result.themes_dropped > 0
                ? ` (${result.themes_dropped} dropped)`
                : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyMarkdown}
                className="btn-secondary text-xs"
              >
                Copy markdown
              </button>
              {notionConnected && notionDatabases.length > 0 && (
                <>
                  <select
                    value={notionSelectedDb}
                    onChange={(e) => setNotionSelectedDb(e.target.value)}
                    className="input h-9 max-w-[12rem] py-1 text-sm"
                  >
                    {notionDatabases.map((db) => (
                      <option key={db.id} value={db.id}>{db.title}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={pushToNotion}
                    disabled={notionPushing || !notionSelectedDb}
                    className="btn-primary min-h-9 px-4 py-1.5 text-sm"
                  >
                    {notionPushing ? "Pushing..." : "Push to Notion"}
                  </button>
                </>
              )}
            </div>
          </div>
          {notionPushError && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {notionPushError}
            </p>
          )}
          {notionPushUrl && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-700 text-xs text-white">&#10003;</span>
              Pushed to Notion.{" "}
              <a href={notionPushUrl} target="_blank" rel="noreferrer" className="font-medium underline">Open in Notion</a>
            </div>
          )}
          <article className="prose prose-neutral prose-brand max-w-none">
            {!result.markdown ? (
              <p className="text-sm text-neutral-500">
                No synthesis content was returned. Please try again.
              </p>
            ) : looksLikeJson(result.markdown) ? (
              <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-950">
                <p className="font-medium">Synthesis result could not be rendered.</p>
                <p className="mt-1 text-xs">
                  The server returned an unexpected response format. Try
                  re-running the synthesis. This is usually a one-off issue.
                </p>
              </div>
            ) : (
              <ReactMarkdown>{result.markdown}</ReactMarkdown>
            )}
          </article>

          {result.expert_recommendations && result.expert_recommendations.length > 0 && (
            <div className="mt-6">
              <p className="eyebrow mb-3">Expert perspectives</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {result.expert_recommendations.map((expert, i) => (
                  <div
                    key={i}
                    className="card border-l-2 border-brand-700 p-5 dark:border-brand-500"
                  >
                    <p className="text-sm font-bold text-neutral-900 dark:text-neutral-50">
                      {expert.role}
                    </p>
                    {expert.perspective && (
                      <p className="mt-1 text-xs italic leading-relaxed text-neutral-500 dark:text-neutral-400">
                        {expert.perspective}
                      </p>
                    )}
                    <ol className="mt-3 space-y-2">
                      {expert.insights.map((insight, j) => (
                        <li key={j} className="flex gap-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-950 text-[9px] font-bold text-white dark:bg-brand-700">
                            {j + 1}
                          </span>
                          {insight}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="surface-panel mt-6 p-4">
            <p className="text-sm font-semibold text-neutral-900">
              Save privately
            </p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">
              The report is encrypted in your browser before being stored. The
              password stays on your device. Gist never sees it.
            </p>
            <div className="mt-3 grid gap-3">
              <input
                type="text"
                value={privateSaveTitle}
                onChange={(e) => setPrivateSaveTitle(e.target.value)}
                placeholder="Title, e.g. Legal discovery round, May 2026"
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
                                ? (["", "bg-brand-300", "bg-brand-500", "bg-brand-700", "bg-brand-950"] as const)[strength]
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
                              className={`flex items-center gap-1.5 text-xs transition-colors duration-100 ${ok ? "text-brand-700" : "text-neutral-400"}`}
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
                        ? "text-brand-700"
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
                  !!saveStatus ||
                  !isValidPassword(privateSavePassword) ||
                  privateSavePassword !== privateSavePasswordConfirm
                }
                className="btn-primary text-xs"
              >
                {isSavingEncrypted ? "Encrypting..." : saveStatus ? "Saved ✓" : "Save privately"}
              </button>
              <Link href="/projects" className="btn-secondary text-xs">
                {saveStatus ? "Close" : "Cancel"}
              </Link>
              {saveStatus && (
                <span className="text-xs text-brand-800">{saveStatus}</span>
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
