import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gist — Interview Synthesis",
  description:
    "Turn customer interview transcripts into themed synthesis with traceable quotes.",
};

async function Navbar() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <nav
      className="sticky top-0 z-40 border-b border-neutral-200/60 bg-white/70
                 backdrop-blur-xl backdrop-saturate-150 transition-all"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link
          href="/"
          className="group flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          {/* Gradient G logomark */}
          <span
            className="grid h-7 w-7 place-items-center rounded-md
                       bg-brand-gradient text-white shadow-soft
                       transition-transform duration-300 ease-out-expo
                       group-hover:rotate-3 group-hover:scale-105"
          >
            <span className="text-sm font-bold leading-none">G</span>
          </span>
          <span className="bg-gradient-to-r from-neutral-900 to-brand-700 bg-clip-text text-transparent">
            Gist
          </span>
        </Link>
        <div className="flex items-center gap-1 text-sm">
          {user ? (
            <>
              <Link href="/projects" className="btn-ghost">
                Projects
              </Link>
              <Link href="/settings" className="btn-ghost">
                Settings
              </Link>
              <span className="ml-2 hidden text-xs text-neutral-400 sm:inline">
                {user.email}
              </span>
              <form action="/logout" method="post" className="ml-1">
                <button type="submit" className="btn-ghost">
                  Log out
                </button>
              </form>
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen text-neutral-900 antialiased">
        <Navbar />
        <main className="relative">{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
