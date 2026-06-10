import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Analytics } from "@vercel/analytics/next";
import { LogoutButton } from "@/components/LogoutButton";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gist | Interview Synthesis",
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
    <nav className="sticky top-0 z-40 border-b border-transparent bg-white/95 backdrop-blur-xl dark:border-white/[0.06] dark:bg-neutral-950/95">
      <div className="nav-shell">
        <Link
          href={user ? "/?landing=1" : "/"}
          className="group flex shrink-0 items-center gap-2.5 text-xl font-bold tracking-tight"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-950 text-white transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105">
            <span className="text-sm font-bold leading-none">G</span>
          </span>
          <span className="text-neutral-900">Gist</span>
        </Link>
        <div className="flex min-w-0 items-center gap-1.5">
          {user ? (
            <>
              <Link href="/" className="nav-link hidden sm:inline-flex">
                <NavGlyph kind="home" />
                <span className="hidden lg:inline">Home</span>
              </Link>
              <Link href="/projects" className="nav-link">
                <NavGlyph kind="projects" />
                <span className="hidden lg:inline">Projects</span>
              </Link>
              <Link href="/encrypted" className="nav-link">
                <NavGlyph kind="saves" />
                <span className="hidden lg:inline">Private saves</span>
              </Link>
              <Link href="/settings" className="nav-link">
                <NavGlyph kind="settings" />
                <span className="hidden lg:inline">Settings</span>
              </Link>
              <span className="ml-2 hidden text-sm text-neutral-500 xl:inline">
                {user.email}
              </span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="nav-link px-3.5">
                Log in
              </Link>
              <Link href="/signup" className="nav-cta">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Anti-flash: apply dark class before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('gist-theme');if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen text-neutral-900 antialiased dark:text-neutral-100">
        <ThemeProvider>
          <div className="ambient-3d-field" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <Navbar />
          <div className="relative z-10">{children}</div>
          {!user && <Analytics />}
        </ThemeProvider>
      </body>
    </html>
  );
}
