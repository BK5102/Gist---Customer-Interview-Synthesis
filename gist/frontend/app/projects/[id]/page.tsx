"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Synthesis = {
  id: string;
  created_at: string;
  markdown_output: string;
};

type ProjectDetail = {
  id: string;
  name: string;
  created_at: string;
  syntheses: Synthesis[];
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }
      const res = await fetch(`${API_URL}/projects/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = (await res.json()) as ProjectDetail;
      setProject(data);
      setLoading(false);
    };
    load();
  }, [id]);

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-neutral-500">Loading project…</p>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-neutral-500">Project not found.</p>
        <Link href="/projects" className="mt-2 inline-block text-sm underline">
          Back to projects
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-6">
        <Link href="/projects" className="text-xs text-neutral-500 underline">
          ← Projects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {project.name}
        </h1>
        <p className="text-xs text-neutral-500">
          Created {new Date(project.created_at).toLocaleDateString()}
        </p>
      </div>

      <div className="mb-6">
        <Link
          href="/"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          New synthesis
        </Link>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Syntheses
      </h2>
      {project.syntheses.length === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No syntheses yet.{" "}
          <Link href="/" className="underline">
            Upload transcripts
          </Link>{" "}
          to create one.
        </p>
      )}
      <ul className="space-y-3">
        {project.syntheses.map((s) => (
          <li
            key={s.id}
            className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:shadow"
          >
            <Link
              href={`/syntheses/${s.id}`}
              className="text-sm font-medium text-neutral-900"
            >
              Synthesis {new Date(s.created_at).toLocaleDateString()}
            </Link>
            <p className="mt-1 text-xs text-neutral-500">
              {new Date(s.created_at).toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
