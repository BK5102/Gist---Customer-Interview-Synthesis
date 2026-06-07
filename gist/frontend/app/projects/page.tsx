"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Breadcrumb } from "@/components/Breadcrumb";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Synthesis = {
  id: string;
  created_at: string;
  transcript_ids: string[] | null;
};

type Project = {
  id: string;
  name: string;
  created_at: string;
  syntheses?: Synthesis[];
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }
      const res = await fetch(`${API_URL}/projects?include_syntheses=true`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setProjects([]);
        return;
      }
      setProjects((await res.json()) as Project[]);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`${API_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setNewName("");
    setCreating(false);
    fetchProjects();
  };

  if (loading) {
    return (
      <main className="page-wide">
        <div className="space-y-4">
          <div className="skeleton h-8 w-48 rounded-md" />
          <div className="skeleton h-20 rounded-xl" />
          <div className="skeleton h-56 rounded-xl" />
        </div>
      </main>
    );
  }

  const synthesisCount =
    projects?.reduce(
      (sum, project) => sum + (project.syntheses?.length ?? 0),
      0,
    ) ?? 0;

  return (
    <main className="page-wide">
      <Breadcrumb
        items={[
          { label: "Workspace", href: "/" },
          { label: "Projects" },
        ]}
      />

      <header className="motion-section mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Research rounds</p>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight">
            Projects
          </h1>
          <p className="mt-2 max-w-xl text-base leading-relaxed text-neutral-600">
            Keep interviews, syntheses, and private reports together by
            research question.
          </p>
        </div>
        <div className="hidden gap-2 sm:flex">
          <span className="meta-chip">{projects?.length ?? 0} projects</span>
          <span className="meta-chip">{synthesisCount} syntheses</span>
        </div>
      </header>

      <div className="workspace-tabs rounded-t-xl border border-neutral-200 border-b-0 bg-white">
        <span className="is-active">Projects</span>
        <span>Recent syntheses</span>
        <span>Private reports</span>
      </div>

      <form
        onSubmit={createProject}
        className="workspace-toolbar mb-6 rounded-b-xl border border-neutral-200 bg-white px-3"
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Project name, e.g. Q2 customer discovery"
          className="input min-w-[12rem] flex-1 border-0 bg-neutral-50 shadow-none focus:ring-1"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="btn-primary min-h-10 px-4 py-2 text-sm"
        >
          {creating ? "Creating..." : "Create project"}
        </button>
      </form>

      {projects && projects.length === 0 && (
        <div className="fade-panel rounded-xl border border-dashed border-neutral-300 bg-white/65 p-10 text-center">
          <div className="state-visual">
            <span className="text-xl">+</span>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-neutral-800">
            No projects yet
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Create one project per research round, customer segment, or product
            area.
          </p>
        </div>
      )}

      {projects && projects.length > 0 && (
        <ul className="fade-panel space-y-4">
          {projects.map((project) => (
            <li key={project.id}>
              <article className="report-shell motion-card">
                <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                  <div>
                    <p className="product-kicker">Research project</p>
                    <h2 className="mt-1 text-xl font-semibold text-neutral-950">
                      {project.name}
                    </h2>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="meta-chip">
                        Created{" "}
                        {new Date(project.created_at).toLocaleDateString()}
                      </span>
                      <span className="meta-chip">
                        {project.syntheses?.length ?? 0} syntheses
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/?project=${project.id}`}
                      className="btn-primary min-h-10 px-4 py-2 text-sm"
                    >
                      New synthesis
                    </Link>
                    <Link
                      href={`/encrypted?project=${project.id}`}
                      className="btn-secondary min-h-10 px-4 py-2 text-sm"
                    >
                      Private saves
                    </Link>
                  </div>
                </div>

                <div className="workspace-tabs border-x-0">
                  <span>Overview</span>
                  <span className="is-active">Syntheses</span>
                  <span>Sources</span>
                </div>

                <div className="p-4 sm:p-5">
                  {project.syntheses && project.syntheses.length > 0 ? (
                    <>
                      <p className="product-kicker mb-2">Recent analysis</p>
                      <ul className="divide-y divide-neutral-100">
                        {project.syntheses.map((synthesis) => (
                          <li key={synthesis.id}>
                            <Link
                              href={`/syntheses/${synthesis.id}`}
                              className="group flex items-center justify-between gap-4 px-2 py-3 text-sm text-neutral-700 transition-colors hover:bg-brand-50"
                            >
                              <span className="font-medium text-neutral-900">
                                {new Date(
                                  synthesis.created_at,
                                ).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}{" "}
                                synthesis
                              </span>
                              <span className="text-xs text-neutral-500 group-hover:text-brand-800">
                                {synthesis.transcript_ids?.length ?? 0}{" "}
                                transcript
                                {(synthesis.transcript_ids?.length ?? 0) === 1
                                  ? ""
                                  : "s"}{" "}
                                &rarr;
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="rounded-lg bg-neutral-50 p-4 text-sm text-neutral-500">
                      No synthesis has been run for this project yet.
                    </p>
                  )}
                  <p className="mt-3 text-xs text-neutral-500">
                    Password-encrypted synthesis reports are in{" "}
                    <Link
                      href={`/encrypted?project=${project.id}`}
                      className="text-brand-700 underline underline-offset-2"
                    >
                      Private saves
                    </Link>
                    .
                  </p>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
