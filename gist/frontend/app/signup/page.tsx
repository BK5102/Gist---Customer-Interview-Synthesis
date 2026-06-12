"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PASSWORD_RULES, isValidPassword, validatePassword } from "@/lib/password";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const supabase = createClient();

  const strength: 0 | 1 | 2 | 3 | 4 = (() => {
    if (!password) return 0;
    const passed = PASSWORD_RULES.filter((r) => r.test(password)).length;
    if (passed <= 2) return 1;
    if (passed === 3) return 2;
    if (passed === 4) return 3;
    return 4;
  })();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const pwError = validatePassword(password);
    if (pwError) { setError(pwError); return; }

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
          <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-brand-950 text-white">
            <span className="text-base font-bold">G</span>
          </span>
          <h1 className="page-title mt-4 text-2xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="mt-1 text-base text-neutral-600">
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
            <div className="relative mt-1.5">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                className="input pr-10"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            {password && (
              <>
                <div className="mt-2 flex gap-1">
                  {[1, 2, 3, 4].map((seg) => (
                    <div
                      key={seg}
                      className={`h-1 flex-1 rounded-full transition-colors duration-150 ${
                        seg <= strength
                          ? (["", "bg-brand-300", "bg-brand-500", "bg-brand-700", "bg-brand-950"] as const)[strength]
                          : "bg-neutral-200"
                      }`}
                    />
                  ))}
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {(["", "Weak", "Fair", "Good", "Strong"] as const)[strength]}
                </p>
                <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  {PASSWORD_RULES.map((rule) => {
                    const ok = rule.test(password);
                    return (
                      <li
                        key={rule.label}
                        className={`flex items-center gap-1.5 text-xs transition-colors duration-100 ${ok ? "text-brand-700" : "text-neutral-400"}`}
                      >
                        <span className="shrink-0 font-medium">{ok ? "✓" : "✗"}</span>
                        {rule.label}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 animate-fade-in">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800 animate-fade-in">
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

        <p className="mt-6 text-center text-base text-neutral-600">
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
