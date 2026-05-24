"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    const emailRedirectTo = `${window.location.origin}/auth/callback?next=/projects`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (data.session) {
      window.location.href = "/projects";
    } else {
      setMessage(
        "Check your email for a confirmation link. If you don't see it, check spam.",
      );
    }
  };

  return (
    <main className="mx-auto max-w-md px-6 py-16 sm:py-24">
      <div className="card p-8">
        <div className="text-center">
          <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-zinc-900 text-white">
            <span className="text-base font-bold">G</span>
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Keep your interview syntheses in one place.
          </p>
        </div>

        <form onSubmit={handleSignup} className="mt-8 space-y-4">
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
            <label className="label">Password</label>
            <input
              type="password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
              className="input mt-1.5"
              autoComplete="new-password"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 animate-fade-in">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 animate-fade-in">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-600">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-brand-700 transition-colors hover:text-brand-800"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
