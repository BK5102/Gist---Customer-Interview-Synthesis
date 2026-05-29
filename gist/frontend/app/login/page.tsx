"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError === "auth_callback_failed") {
      setError("That sign-in link could not be completed. Please try again.");
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    window.location.href = "/";
  };

  return (
    <main className="mx-auto max-w-md px-6 py-16 sm:py-24">
      <div className="card p-8">
        <div className="text-center">
          <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-neutral-900 text-white">
            <span className="text-base font-bold">G</span>
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Log in to keep your syntheses in one place.
          </p>
        </div>

        <form onSubmit={handleLogin} className="mt-8 space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="input mt-1.5"
              autoComplete="email"
              autoFocus
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <label className="label">Password</label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-brand-700 transition-colors hover:text-brand-800"
              >
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input mt-1.5"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 animate-fade-in">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-600">
          Don&rsquo;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-brand-700 transition-colors hover:text-brand-800"
          >
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
