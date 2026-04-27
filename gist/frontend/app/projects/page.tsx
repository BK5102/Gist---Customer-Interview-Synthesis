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
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = async () => {
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
      setLoading(false);
      return;
    }
    const data = (await res.json()) as Project[];
    setProjects(data);
    setLoading(false);
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
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-neutral-500">Loading projects…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <Link
          href="/"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          New synthesis
        </Link>
      </div>

      <form onSubmit={createProject} className="mb-6 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Project name"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create project"}
        </button>
      </form>

      {projects && projects.length === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No projects yet. Create your first one above, or start a{" "}
          <Link href="/" className="underline">
            new synthesis
          </Link>{" "}
          and we&rsquo;ll make one automatically.
        </p>
      )}

      {projects && projects.length > 0 && (
        <ul className="space-y-3">
          {projects.map((proj) => (
            <li
              key={proj.id}
              className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:shadow"
            >
              <Link
                href={`/projects/${proj.id}`}
                className="block text-sm font-medium text-neutral-900"
              >
                {proj.name}
              </Link>
              <p className="mt-1 text-xs text-neutral-500">
                Created {new Date(proj.created_at).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
