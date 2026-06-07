import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Analytics } from "@vercel/analytics/next";
import { LogoutButton } from "@/components/LogoutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gist — Interview Synthesis",
  description:
    "Turn customer interview transcripts into themed synthesis with traceable quotes.",
};

function NavGlyph({ kind }: { kind: "home" | "projects" | "saves" | "settings" }) {
  const paths = {
    home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9.5Z",
    projects: "M4 6h6l2 2h8v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z",
    saves: "M7 10V8a5 5 0 0 1 10 0v2m-9 0h8a2 2 0 0 1 2 2v7H6v-7a2 2 0 0 1 2-2Z",
    settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 3.5-2 .8a6.9 6.9 0 0 1-.6 1.4l1 1.9-2.1 2.1-1.9-1a6.9 6.9 0 0 1-1.4.6l-.8 2h-3l-.8-2a6.9 6.9 0 0 1-1.4-.6l-1.9 1L2 16.1l1-1.9a6.9 6.9 0 0 1-.6-1.4L.4 12l2-.8a6.9 6.9 0 0 1 .6-1.4L2 7.9l2.1-2.1 1.9 1a6.9 6.9 0 0 1 1.4-.6l.8-2h3l.8 2a6.9 6.9 0 0 1 1.4.6l1.9-1 2.1 2.1-1 1.9c.25.45.45.92.6 1.4l2 .8Z",
  };

  return (
    <span className="nav-glyph" aria-hidden="true">
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
        <path
          d={paths[kind]}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

async function Navbar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <nav className="sticky top-0 z-40 px-3 py-3 backdrop-blur-xl sm:px-6">
      <div className="nav-shell">
        <Link
          href={user ? "/?landing=1" : "/"}
          className="group flex items-center gap-3 text-2xl font-bold tracking-tight"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-neutral-950 text-white transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105">
            <span className="text-lg font-bold leading-none">G</span>
          </span>
          <span className="text-neutral-900">Gist</span>
        </Link>
        <div className="flex items-center gap-2 overflow-x-auto">
          {user ? (
            <>
              <Link href="/" className="btn-ghost">
                <NavGlyph kind="home" />
                Home
              </Link>
              <Link href="/projects" className="btn-ghost">
                <NavGlyph kind="projects" />
                Projects
              </Link>
              <Link href="/encrypted" className="btn-ghost">
                <NavGlyph kind="saves" />
                Private saves
              </Link>
              <Link href="/settings" className="btn-ghost">
                <NavGlyph kind="settings" />
                Settings
              </Link>
              <span className="ml-2 hidden text-sm text-neutral-500 xl:inline">
                {user.email}
              </span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="btn-secondary">
                Log in
              </Link>
              <Link href="/signup" className="btn-primary">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function SiteFooter({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="relative z-10 mt-8 bg-brand-950 text-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-12">
        <div className="grid gap-7 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-amber-400">
              Ready for clearer research?
            </p>
            <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
              Turn interviews into decisions you can defend.
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-brand-100">
              Upload transcripts or audio, trace every finding to a real quote,
              and keep private reports encrypted.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href={signedIn ? "/projects" : "/signup"}
              className="footer-action"
            >
              <span className="relative z-10 block text-xl font-bold">
                {signedIn ? "Open projects" : "Get started"}
              </span>
              <span className="relative z-10 mt-2 block max-w-[14rem] text-sm leading-relaxed text-brand-100">
                {signedIn
                  ? "Continue a research round or start a new one."
                  : "Create a workspace and synthesize your first interviews."}
              </span>
            </Link>
            <Link
              href={signedIn ? "/encrypted" : "/login"}
              className="footer-action"
            >
              <span className="relative z-10 block text-xl font-bold">
                {signedIn ? "Private saves" : "Log in"}
              </span>
              <span className="relative z-10 mt-2 block max-w-[14rem] text-sm leading-relaxed text-brand-100">
                {signedIn
                  ? "Return to reports encrypted in your browser."
                  : "Pick up where you left off in your workspace."}
              </span>
            </Link>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-6 border-t border-white/15 pt-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="text-5xl font-bold tracking-tight sm:text-7xl">
              Gist
            </Link>
            <p className="mt-2 text-sm text-brand-200">
              Quote-backed customer interview synthesis.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-base font-semibold text-brand-100">
            <Link href="/projects" className="transition-colors hover:text-amber-400">
              Projects
            </Link>
            <Link href="/encrypted" className="transition-colors hover:text-amber-400">
              Private saves
            </Link>
            <Link href="/settings" className="transition-colors hover:text-amber-400">
              Settings
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen text-neutral-900 antialiased">
        <div className="ambient-3d-field" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <Navbar />
        <div className="relative z-10">{children}</div>
        <SiteFooter signedIn={Boolean(user)} />
        {!user && <Analytics />}
      </body>
    </html>
  );
}
