"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Check your email for a password reset link.");
  };

  return (
    <main className="mx-auto max-w-md px-6 py-16 sm:py-24">
      <div className="card p-8">
        <div className="text-center">
          <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-neutral-900 text-white">
            <span className="text-base font-bold">G</span>
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Enter your account email and we will send a secure reset link.
          </p>
        </div>

        <form onSubmit={handleReset} className="mt-8 space-y-4">
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
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-600">
          Remembered it?{" "}
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
