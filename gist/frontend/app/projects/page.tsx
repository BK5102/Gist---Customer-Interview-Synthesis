"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Project = {
  id: string;
  name: string;
  created_at: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = async () => {
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }
      const res = await fetch(`${API_URL}/projects`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        setProjects([]);
        setError(
          `Backend returned ${res.status}. ${
            res.status === 401 ? "Your session may have expired — try logging in again." : ""
          }`.trim(),
        );
        return;
      }
      const data = (await res.json()) as Project[];
      setProjects(data);
    } catch (e) {
      // Network error, CORS rejection, DNS failure — fetch throws instead
      // of resolving. Show a friendly message rather than a blank page.
      setProjects([]);
      setError(
        e instanceof Error
          ? `Couldn't reach the backend: ${e.message}. Check your network or try again in a moment.`
          : "Couldn't reach the backend.",
      );
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
    <main className="page">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Projects
          </h1>
        </div>
        <Link href="/" className="btn-primary">
          New synthesis
        </Link>
      </header>

      <form onSubmit={createProject} className="mb-8 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Project name — e.g. Q2 customer discovery"
          className="input flex-1"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="btn-secondary"
        >
          {creating ? "Creating…" : "Create project"}
        </button>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 animate-fade-in">
          <p className="font-medium">Couldn&rsquo;t load your projects</p>
          <p className="mt-1 text-xs text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchProjects();
            }}
            className="mt-2 text-xs font-medium text-red-700 underline transition-colors hover:text-red-900"
          >
            Try again
          </button>
        </div>
      )}

      {projects && projects.length === 0 && (
        <div className="rounded-2xl border border-dashed border-brand-300 bg-brand-gradient-soft p-12 text-center">
          <div className="mx-auto inline-grid h-12 w-12 place-items-center rounded-xl bg-brand-gradient text-white shadow-glow animate-float">
            <span className="text-xl">+</span>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-neutral-800">
            No projects yet
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            A project groups transcripts and syntheses together. Make one per
            research round, customer segment, or product area.
          </p>
          <p className="mt-4 text-xs text-neutral-500">
            Name a project above and click <strong>Create project</strong> to
            get started.
          </p>
        </div>
      )}

      {projects && projects.length > 0 && (
        <ul className="space-y-3">
          {projects.map((proj, i) => (
            <li
              key={proj.id}
              className="animate-fade-in-up"
              style={{
                animationDelay: `${i * 0.05}s`,
                animationFillMode: "backwards",
              }}
            >
              <Link
                href={`/projects/${proj.id}`}
                className="card card-hover block p-5 group"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-900 transition-colors group-hover:text-brand-700">
                    {proj.name}
                  </h2>
                  <span className="text-xs text-neutral-400 transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  Created {new Date(proj.created_at).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
