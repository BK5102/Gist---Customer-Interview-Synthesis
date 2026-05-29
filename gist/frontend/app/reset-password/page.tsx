"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { validatePassword } from "@/lib/password";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError("Open this page from the password reset email link.");
      }
      setCheckingSession(false);
    };

    checkSession();
  }, [supabase.auth]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const pwError = validatePassword(password);
    if (pwError) { setError(pwError); return; }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPassword("");
    setConfirmPassword("");
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Password updated. You can log in with the new password.");
  };

  return (
    <main className="mx-auto max-w-md px-6 py-16 sm:py-24">
      <div className="card p-8">
        <div className="text-center">
          <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-zinc-900 text-white">
            <span className="text-base font-bold">G</span>
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Choose a new password
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Use a password you will not reuse anywhere else.
          </p>
        </div>

        <form onSubmit={handleUpdate} className="mt-8 space-y-4">
          <div>
            <label className="label">New password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Uppercase, lowercase, special character"
              className="input mt-1.5"
              autoComplete="new-password"
              disabled={checkingSession}
            />
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              className="input mt-1.5"
              autoComplete="new-password"
              disabled={checkingSession}
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
            disabled={checkingSession || loading}
            className="btn-primary w-full"
          >
            {loading ? "Updating..." : "Update password"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-600">
          <Link
            href="/login"
            className="font-medium text-brand-700 transition-colors hover:text-brand-800"
          >
            Back to login
          </Link>
        </p>
      </div>
    </main>
  );
}
