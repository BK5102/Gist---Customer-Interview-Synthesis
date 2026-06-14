"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Breadcrumb } from "@/components/Breadcrumb";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type EncryptedSave = {
  id: string;
  title: string | null;
  created_at: string;
  project_id: string | null;
};

type Project = {
  id: string;
  name: string;
  description?: string | null;
  created_at: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [allSaves, setAllSaves] = useState<EncryptedSave[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeProjectTabs, setActiveProjectTabs] = useState<Record<string, "overview" | "syntheses">>({});
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);

  const fetchData = async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }

      const [projectsRes, savesRes] = await Promise.all([
        fetch(`${API_URL}/projects`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        supabase
          .from("encrypted_artifacts")
          .select("id,title,created_at,project_id")
          .eq("artifact_type", "synthesis")
          .order("created_at", { ascending: false }),
      ]);

      if (!projectsRes.ok) {
        setProjects([]);
      } else {
        setProjects((await projectsRes.json()) as Project[]);
      }

      setAllSaves((savesRes.data ?? []) as EncryptedSave[]);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
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
    fetchData();
  };

  const saveDescription = async (projectId: string) => {
    setSavingDescription(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) { setSavingDescription(false); return; }

    const res = await fetch(`${API_URL}/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ description: descriptionDraft.trim() || null }),
    });

    if (res.ok) {
      setProjects((prev) =>
        prev?.map((p) =>
          p.id === projectId ? { ...p, description: descriptionDraft.trim() || null } : p
        ) ?? null
      );
      setEditingProject(null);
    }
    setSavingDescription(false);
  };

  const tabFor = (projectId: string) => activeProjectTabs[projectId] ?? "overview";
  const setTab = (projectId: string, tab: "overview" | "syntheses") =>
    setActiveProjectTabs((prev) => ({ ...prev, [projectId]: tab }));

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

  const mostRecentSave = allSaves[0] ?? null;

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
          <h1 className="page-title text-4xl font-semibold tracking-tight">
            Projects
          </h1>
          <p className="mt-2 max-w-xl text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
            Keep interviews and syntheses together by research question.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="meta-chip">{projects?.length ?? 0} projects</span>
          <span className="meta-chip">{allSaves.length} syntheses</span>
          {mostRecentSave && (
            <Link
              href="/encrypted"
              className="btn-secondary min-h-9 px-3 py-1.5 text-sm"
            >
              Most recent: {mostRecentSave.title || "Synthesis"} &rarr;
            </Link>
          )}
        </div>
      </header>

      <form
        onSubmit={createProject}
        className="workspace-toolbar mb-6 rounded-xl border border-neutral-200 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900"
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Project name, e.g. Q2 stakeholder interviews"
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
          <p className="mt-1 text-base text-neutral-600 dark:text-neutral-300">
            Create one project per conversation batch, case, engagement, or research round.
          </p>
        </div>
      )}

      {projects && projects.length > 0 && (
        <ul className="fade-panel space-y-4">
          {projects.map((project) => {
            const projectSaves = allSaves.filter((s) => s.project_id === project.id);
            const activeTab = tabFor(project.id);
            const isEditing = editingProject === project.id;

            return (
              <li key={project.id}>
                <article className="report-shell motion-card">
                  <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                    <div>
                      <h2 className="text-xl font-semibold text-neutral-950">
                        {project.name}
                      </h2>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="meta-chip">
                          Created{" "}
                          {new Date(project.created_at).toLocaleDateString()}
                        </span>
                        <span className="meta-chip">
                          {projectSaves.length}{" "}
                          {projectSaves.length === 1 ? "synthesis" : "syntheses"}
                        </span>
                      </div>
                    </div>
                    <Link
                      href={`/?project=${project.id}`}
                      className="btn-primary min-h-10 px-4 py-2 text-sm"
                    >
                      New synthesis
                    </Link>
                  </div>

                  <div className="project-tabs">
                    <button
                      type="button"
                      onClick={() => setTab(project.id, "overview")}
                      className={activeTab === "overview" ? "is-active" : ""}
                    >
                      Overview
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab(project.id, "syntheses")}
                      className={activeTab === "syntheses" ? "is-active" : ""}
                    >
                      Syntheses
                    </button>
                  </div>

                  <div className="p-4 sm:p-5">
                    {activeTab === "overview" && (
                      <div>
                        {isEditing ? (
                          <div className="flex flex-col gap-3">
                            <textarea
                              value={descriptionDraft}
                              onChange={(e) => setDescriptionDraft(e.target.value)}
                              placeholder="Describe this project: the research question, participant segment, or goal."
                              rows={4}
                              className="input resize-none text-sm"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => saveDescription(project.id)}
                                disabled={savingDescription}
                                className="btn-primary px-3 py-1.5 text-xs"
                              >
                                {savingDescription ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingProject(null)}
                                className="btn-secondary px-3 py-1.5 text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            {project.description ? (
                              <p className="text-base leading-relaxed text-neutral-700 dark:text-neutral-200">
                                {project.description}
                              </p>
                            ) : (
                              <p className="text-sm text-neutral-400">
                                No description yet.
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setDescriptionDraft(project.description ?? "");
                                setEditingProject(project.id);
                              }}
                              className="mt-3 text-xs font-medium text-brand-700 hover:underline"
                            >
                              {project.description ? "Edit description" : "Add description"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === "syntheses" && (
                      <div>
                        {projectSaves.length > 0 ? (
                          <ul className="divide-y divide-neutral-100">
                            {projectSaves.map((save) => (
                              <li key={save.id}>
                                <Link
                                  href={`/encrypted?project=${project.id}`}
                                  className="group flex items-center justify-between gap-4 px-2 py-3 text-sm text-neutral-700 transition-colors hover:bg-brand-50 dark:text-neutral-300 dark:hover:bg-brand-950/30"
                                >
                                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                                    {save.title || "Private synthesis"}
                                  </span>
                                  <span className="text-sm font-medium text-neutral-500 group-hover:text-brand-800 dark:text-neutral-300 dark:group-hover:text-brand-300">
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
                        ) : (
                          <p className="rounded-lg bg-neutral-50 p-4 text-sm text-neutral-500">
                            No synthesis has been run for this project yet.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
