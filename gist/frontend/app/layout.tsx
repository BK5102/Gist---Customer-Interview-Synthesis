import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Analytics } from "@vercel/analytics/next";
import { LogoutButton } from "@/components/LogoutButton";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gist: Verified Expert Briefs",
  description:
    "Turn any conversation into expert-ready insights. Themed synthesis with verbatim-verified quotes, for legal teams, consultants, investigators, and more.",
};

function NavGlyph({ kind }: { kind: "home" | "projects" | "saves" | "settings" }) {
  const paths = {
    home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9.5Z",
    projects: "M4 6h6l2 2h8v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z",
    saves: "M7 10V8a5 5 0 0 1 10 0v2m-9 0h8a2 2 0 0 1 2 2v7H6v-7a2 2 0 0 1 2-2Z",
    settings: "M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z",
  };

  return (
    <span className="nav-glyph" aria-hidden="true">
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
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
    <nav className="sticky top-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur-xl dark:border-white/[0.06] dark:bg-neutral-950/95">
      <div className="nav-shell">
        <Link
          href={user ? "/?landing=1" : "/"}
          className="group flex shrink-0 items-center gap-3 text-2xl font-bold tracking-tight"
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-950 text-white transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105">
            <span className="text-base font-bold leading-none">G</span>
          </span>
          <span className="text-neutral-900">Gist</span>
        </Link>
        <div className="flex min-w-0 items-center gap-1.5">
          {user ? (
            <>
              <Link href="/" className="nav-link hidden sm:inline-flex">
                <NavGlyph kind="home" />
                <span className="hidden lg:inline">Workspace</span>
              </Link>
              <Link href="/projects" className="nav-link">
                <NavGlyph kind="projects" />
                <span className="hidden lg:inline">Projects</span>
              </Link>
              <Link href="/encrypted" className="nav-link">
                <NavGlyph kind="saves" />
                <span className="hidden lg:inline">Private saves</span>
              </Link>
              <Link href="/settings" className="nav-link" aria-label="Settings">
                <NavGlyph kind="settings" />
              </Link>
              <Link
                href="/settings"
                className="ml-2 hidden shrink-0 items-center gap-2 xl:flex"
                aria-label="Account settings"
              >
                {user.user_metadata?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.user_metadata.avatar_url}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover ring-1 ring-neutral-200 dark:ring-white/10"
                  />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-950 text-xs font-semibold text-white">
                    {(user.email?.[0] ?? "?").toUpperCase()}
                  </span>
                )}
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {user.email}
                </span>
              </Link>
              <ThemeToggle />
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/#features" className="nav-link hidden sm:inline-flex px-3.5">
                Features
              </Link>
              <Link href="/security" className="nav-link hidden sm:inline-flex px-3.5">
                Security
              </Link>
              <ThemeToggle />
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
            __html: `(function(){try{var t=localStorage.getItem('gist-theme');if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
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
