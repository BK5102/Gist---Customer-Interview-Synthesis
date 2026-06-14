import Link from "next/link";

export const metadata = {
  title: "Security & Privacy | Gist",
  description:
    "How Gist handles your interview transcripts, synthesis reports, and account data and what it never stores.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-7 sm:p-8">
      <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      <div className="mt-4 space-y-3 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
        {children}
      </div>
    </section>
  );
}

function Row({ icon, label, detail }: { icon: React.ReactNode; label: string; detail: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-brand-700 dark:text-brand-400">
        {icon}
      </span>
      <div>
        <span className="font-medium text-neutral-800 dark:text-neutral-200">{label}: </span>
        {detail}
      </div>
    </div>
  );
}

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
    <polyline points="2.5 8.5 6 12 13.5 4" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
    <rect x="3" y="8" width="10" height="7" rx="1.5" />
    <path d="M5.5 8V5.5a2.5 2.5 0 0 1 5 0V8" />
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
    <path d="M8 1.5L2 4v4c0 3.5 2.5 6.75 6 7.75C11.5 14.75 14 11.5 14 8V4L8 1.5z" />
  </svg>
);

const AlertIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true">
    <path d="M8 2L1.5 13.5h13L8 2z" />
    <line x1="8" y1="7" x2="8" y2="10" />
    <circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none" />
  </svg>
);

export default function SecurityPage() {
  return (
    <main className="page">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className="page-title text-3xl font-bold tracking-tight">
            Security at Gist
          </h1>
          <p className="mt-3 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
            Conversations often contain privileged, confidential, or sensitive information.
            Here is exactly how Gist handles that data, and what it never touches.
          </p>
        </header>

        <div className="space-y-4">
          <Section title="What Gist never stores">
            <Row
              icon={<CheckIcon />}
              label="Raw transcripts"
              detail="Your interview text is processed in memory to extract themes, then discarded. It is never written to disk or database."
            />
            <Row
              icon={<CheckIcon />}
              label="Synthesis reports (plaintext)"
              detail="Reports are not saved in readable form on our servers. The only copy that persists is the one you encrypt yourself."
            />
            <Row
              icon={<CheckIcon />}
              label="Your password"
              detail="The password you use to protect a private save never leaves your browser. It is not transmitted or stored anywhere."
            />
          </Section>

          <Section title="Browser-side encryption">
            <Row
              icon={<LockIcon />}
              label="AES-GCM 256-bit"
              detail="Private saves are encrypted in your browser before they are stored. The algorithm is AES-GCM with a 256-bit key."
            />
            <Row
              icon={<LockIcon />}
              label="PBKDF2-SHA256, 600 000 iterations"
              detail="Your password is stretched using PBKDF2 at 600 000 iterations, meeting NIST SP 800-132 (2023) minimums, before it becomes the encryption key."
            />
            <Row
              icon={<LockIcon />}
              label="Unrecoverable by design"
              detail="Because the password never leaves your device, Gist cannot decrypt or recover a save if you forget it. This is intentional."
            />
          </Section>

          <Section title="Third-party data processors">
            <p className="font-medium text-neutral-700 dark:text-neutral-100">
              Two external AI providers process your content. You should know this before uploading regulated or confidential data.
            </p>
            <Row
              icon={<AlertIcon />}
              label="Audio transcription"
              detail="Audio files are sent to Groq (preferred) or OpenAI Whisper for transcription. Neither provider is used for training on customer data under their API terms."
            />
            <Row
              icon={<AlertIcon />}
              label="Theme extraction and synthesis"
              detail="Transcript text and extracted themes are sent to Anthropic (Claude) for clustering and insight generation. Anthropic does not train on API inputs by default."
            />
          </Section>

          <Section title="Account and infrastructure">
            <Row
              icon={<ShieldIcon />}
              label="Authentication"
              detail="Accounts are managed by Supabase Auth with email confirmation and JWT-based sessions. Passwords are never stored by Gist directly."
            />
            <Row
              icon={<ShieldIcon />}
              label="Row-level security"
              detail="Every database table is protected by Supabase RLS policies. You can only read or write your own data, even if you know another user's project ID."
            />
            <Row
              icon={<ShieldIcon />}
              label="HTTPS everywhere"
              detail="All traffic is served over HTTPS. The backend sets HSTS with a two-year max-age and includeSubDomains."
            />
            <Row
              icon={<ShieldIcon />}
              label="No analytics on content"
              detail="Gist does not read, index, or analyze the content of your interviews, reports, or saved artifacts."
            />
          </Section>

          <section className="rounded-xl border border-neutral-200 bg-neutral-50 px-7 py-5 dark:border-white/[0.08] dark:bg-neutral-900/60">
            <p className="text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
              Questions or concerns? Reach out at{" "}
              <a href="mailto:bkannan8@asu.edu" className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400">
                bkannan8@asu.edu
              </a>
              . This page reflects the current state of Gist as of June 2026.
            </p>
          </section>
        </div>

        <div className="mt-8">
          <Link href="/" className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400">
            &larr; Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
