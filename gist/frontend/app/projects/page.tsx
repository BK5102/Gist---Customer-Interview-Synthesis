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
      const data = (await res.json()) as Project[];
      setProjects(data);
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
      <main className="page">
        <div className="space-y-4">
          <div className="skeleton h-8 w-48 rounded-md" />
          <div className="skeleton h-20 rounded-xl" />
          <div className="skeleton h-20 rounded-xl" />
        </div>
      </main>
    );
  }

  return (
    <main className="page-wide">
      <Breadcrumb
        items={[
          { label: "Workspace", href: "/" },
          { label: "Projects" },
        ]}
      />
      <header className="mb-8">
        <p className="eyebrow">Research rounds</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Projects
        </h1>
        <p className="mt-1 max-w-xl text-sm text-neutral-600">
          Keep each research round in its own project. Create a project below,
          then run a synthesis from within it.
        </p>
      </header>

      <form onSubmit={createProject} className="mb-8 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Project name - e.g. Q2 customer discovery"
          className="input flex-1"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="btn-secondary"
        >
          {creating ? "Creating..." : "Create project"}
        </button>
      </form>

      {projects && projects.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-12 text-center">
          <div className="mx-auto inline-grid h-12 w-12 place-items-center rounded-xl bg-zinc-900 text-white">
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
        <ul className="space-y-3">
          {projects.map((proj) => (
            <li key={proj.id}>
              <div className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-900">
                      {proj.name}
                    </h2>
                    <p className="mt-1 text-xs text-neutral-500">
                      Created {new Date(proj.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/?project=${proj.id}`}
                      className="btn-primary px-3 py-1.5 text-xs"
                    >
                      New synthesis
                    </Link>
                    <Link
                      href={`/encrypted?project=${proj.id}`}
                      className="btn-secondary px-3 py-1.5 text-xs"
                    >
                      Private saves
                    </Link>
                  </div>
                </div>

                <div className="mt-4 border-t border-neutral-100 pt-4">
                  {proj.syntheses && proj.syntheses.length > 0 ? (
                    <>
                      <p className="mb-2 text-xs font-medium text-neutral-500">
                        Syntheses
                      </p>
                      <ul className="space-y-0.5">
                        {proj.syntheses.map((synth) => (
                          <li key={synth.id}>
                            <Link
                              href={`/syntheses/${synth.id}`}
                              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-50"
                            >
                              <span>
                                {new Date(synth.created_at).toLocaleDateString(
                                  "en-US",
                                  { month: "short", day: "numeric", year: "numeric" }
                                )}{" "}
                                synthesis
                              </span>
                              <span className="text-neutral-400">
                                {synth.transcript_ids?.length ?? 0} transcript
                                {(synth.transcript_ids?.length ?? 0) === 1 ? "" : "s"}{" "}
                                →
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <p className="mt-2 text-xs text-neutral-500">
                    Password-encrypted synthesis reports are in{" "}
                    <Link
                      href={`/encrypted?project=${proj.id}`}
                      className="text-brand-700 underline underline-offset-2"
                    >
                      Private saves
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
