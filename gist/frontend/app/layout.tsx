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
    <nav className="sticky top-0 z-40 border-b border-white/70 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link
          href={user ? "/?landing=1" : "/"}
          className="group flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-neutral-900 text-white transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105">
            <span className="text-sm font-bold leading-none">G</span>
          </span>
          <span className="text-neutral-900">Gist</span>
        </Link>
        <div className="flex items-center gap-2 text-sm">
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
              <span className="ml-2 hidden text-xs text-neutral-400 sm:inline">
                {user.email}
              </span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">
                Log in
              </Link>
              <Link
                href="/signup"
                className="btn-primary px-4 py-1.5 text-xs"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-8 pt-8 text-center">
      <div className="surface-panel mx-auto max-w-3xl p-6">
        <p className="text-lg font-semibold text-neutral-900">
          Gist turns messy customer conversations into quote-backed research
          clarity.
        </p>
        <p className="mt-2 text-base leading-relaxed text-neutral-600">
          Upload transcripts or audio, find the themes that matter, and save
          reports privately with a password only you know.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-4 text-sm font-medium text-brand-800">
          <Link href="/projects" className="transition-colors hover:text-brand-950">
            Projects
          </Link>
          <Link href="/encrypted" className="transition-colors hover:text-brand-950">
            Private saves
          </Link>
          <Link href="/settings" className="transition-colors hover:text-brand-950">
            Settings
          </Link>
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
        <SiteFooter />
        {!user && <Analytics />}
      </body>
    </html>
  );
}
