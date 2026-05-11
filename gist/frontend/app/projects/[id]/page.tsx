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
      <main className="page">
        <div className="space-y-4">
          <div className="skeleton h-6 w-24 rounded-md" />
          <div className="skeleton h-10 w-72 rounded-md" />
          <div className="skeleton h-20 rounded-xl" />
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="page text-center">
        <p className="text-sm text-neutral-500">Project not found.</p>
        <Link
          href="/projects"
          className="mt-3 inline-block text-sm text-brand-700 underline"
        >
          Back to projects
        </Link>
      </main>
    );
  }

  return (
    <main className="page">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 text-xs text-neutral-500 transition-colors hover:text-brand-700"
      >
        ← Projects
      </Link>

      <header className="mt-3 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <p className="mt-1 text-xs text-neutral-500">
            Created {new Date(project.created_at).toLocaleDateString()} ·{" "}
            {project.syntheses.length} synthesis
            {project.syntheses.length === 1 ? "" : "es"}
          </p>
        </div>
        <Link href={`/?project=${project.id}`} className="btn-primary">
          New synthesis
        </Link>
      </header>

      <h2 className="eyebrow mb-3">Syntheses</h2>

      {project.syntheses.length === 0 && (
        <div className="rounded-2xl border border-dashed border-brand-300 bg-brand-gradient-soft p-12 text-center">
          <div className="mx-auto inline-grid h-12 w-12 place-items-center rounded-xl bg-brand-gradient text-white shadow-glow animate-float">
            <span className="text-xl">↑</span>
          </div>
          <h3 className="mt-4 text-lg font-semibold text-neutral-800">
            No syntheses yet
          </h3>
          <p className="mt-1 text-sm text-neutral-600">
            Drop a few customer-interview transcripts and Gist will extract
            themes, cluster them, and surface founder takeaways.
          </p>
          <Link
            href={`/?project=${project.id}`}
            className="btn-primary mt-5"
          >
            Upload transcripts
          </Link>
        </div>
      )}

      {project.syntheses.length > 0 && (
        <ul className="space-y-3">
          {project.syntheses.map((s, i) => (
            <li
              key={s.id}
              className="animate-fade-in-up"
              style={{
                animationDelay: `${i * 0.05}s`,
                animationFillMode: "backwards",
              }}
            >
              <Link
                href={`/syntheses/${s.id}`}
                className="card card-hover block p-5 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-900 transition-colors group-hover:text-brand-700">
                    Synthesis · {new Date(s.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-neutral-400 transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {new Date(s.created_at).toLocaleString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
