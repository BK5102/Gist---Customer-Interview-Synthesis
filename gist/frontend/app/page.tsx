"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MAX_FILE_BYTES = 2 * 1024 * 1024; // keep in sync with backend
const MAX_FILES = 20;

type SynthesizeResponse = {
  markdown: string;
  cluster_count: number;
  participant_count: number;
  themes_extracted: number;
  themes_dropped: number;
};

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SynthesizeResponse | null>(null);

  const pickFiles = (incoming: FileList | null) => {
    setError(null);
    if (!incoming) return;
    const picked = Array.from(incoming);

    const badType = picked.find((f) => !f.name.toLowerCase().endsWith(".txt"));
    if (badType) {
      setError(`Only .txt files are supported in v0 (got ${badType.name}).`);
      return;
    }

    const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setError(
        `${tooBig.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }

    if (picked.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files per request.`);
      return;
    }

    const stems = picked.map((f) => f.name.replace(/\.txt$/i, ""));
    if (new Set(stems).size !== stems.length) {
      setError(
        "Duplicate filenames detected. Each transcript stem must be unique (e.g. P1.txt, P2.txt).",
      );
      return;
    }

    setFiles(picked);
    setResult(null);
  };

  const submit = async () => {
    if (files.length === 0) {
      setError("Pick at least one .txt transcript first.");
      return;
    }

    setError(null);
    setResult(null);
    setIsLoading(true);

    const body = new FormData();
    files.forEach((f) => body.append("files", f));

    try {
      const res = await fetch(`${API_URL}/synthesize`, {
        method: "POST",
        body,
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

      const data = (await res.json()) as SynthesizeResponse;
      setResult(data);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unknown error calling backend";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const copyMarkdown = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.markdown);
  };

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
        <label className="block">
          <span className="text-sm font-medium text-neutral-700">
            Upload transcripts (.txt)
          </span>
          <input
            type="file"
            multiple
            accept=".txt,text/plain"
            onChange={(e) => pickFiles(e.target.files)}
            disabled={isLoading}
            className="mt-2 block w-full cursor-pointer text-sm text-neutral-700 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-700 disabled:opacity-50"
          />
        </label>

        {files.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-neutral-600">
            {files.map((f) => (
              <li key={f.name} className="flex justify-between">
                <span className="truncate">{f.name}</span>
                <span className="ml-4 tabular-nums text-neutral-400">
                  {(f.size / 1024).toFixed(1)} KB
                </span>
              </li>
            ))}
          </ul>
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

      {isLoading && (
        <p className="mt-8 text-sm text-neutral-500">
          Extracting themes → clustering across interviews → generating
          founder takeaways. This usually takes 30–90 seconds.
        </p>
      )}

      {result && (
        <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              {result.participant_count} participants ·{" "}
              {result.cluster_count} clusters ·{" "}
              {result.themes_extracted} themes
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
