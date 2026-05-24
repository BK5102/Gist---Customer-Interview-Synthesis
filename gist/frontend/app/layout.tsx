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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <nav className="sticky top-0 z-40 border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link
          href={user ? "/?landing=1" : "/"}
          className="flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-zinc-900 text-white">
            <span className="text-sm font-bold leading-none">G</span>
          </span>
          <span className="text-neutral-900">Gist</span>
        </Link>
        <div className="flex items-center gap-1 text-sm">
          {user ? (
            <>
              <Link href="/" className="btn-ghost">
                Home
              </Link>
              <Link href="/projects" className="btn-ghost">
                Projects
              </Link>
              <Link href="/encrypted" className="btn-ghost">
                Private saves
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
        <Navbar />
        <div className="relative">{children}</div>
        {!user && <Analytics />}
      </body>
    </html>
  );
}
