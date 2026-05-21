# Gist Security And Trust Plan

## Why This Matters

Gist asks users to upload customer interview transcripts and audio/video files. For founders, PMs, and researchers, those files may contain company strategy, customer names, pricing, roadmap plans, complaints, or unreleased product details.

The positioning cannot be "just upload your interviews to a random AI tool." The product must earn trust before asking for sensitive data.

## Current Honest Security Posture

What exists today:

- Supabase Auth gates synthesis, projects, syntheses, and Notion routes.
- Supabase tables use Row Level Security.
- The backend uses the Supabase service-role key and checks ownership in Python before returning project/synthesis data.
- Raw transcript bodies are not persisted by default (`STORE_TRANSCRIPTS=false`).
- Quote-bearing cluster/insight cache files are disabled by default for the web app (`ENABLE_SYNTH_CACHE=false`).
- Plaintext synthesis persistence is disabled by default (`STORE_PLAINTEXT_SYNTHESES=false`).
- `encrypted_artifacts` migration exists for future browser-encrypted saved reports.
- Historical raw transcript rows can be scrubbed with `backend/migrations/2026-05-21_scrub_transcript_content.sql`.
- Historical plaintext synthesis rows can be scrubbed with `backend/migrations/2026-05-21_scrub_plaintext_syntheses.sql`.
- Notion OAuth uses a single-use state nonce.
- The frontend sends JWT bearer tokens to the backend.
- CORS is restricted to configured frontend origins.
- `GET /jobs/{job_id}` now requires auth and only returns jobs owned by the current user.
- Backend and frontend send baseline security headers.

What this means for raw transcripts:

- Uploaded `.txt` content is decoded for processing, then not saved to Supabase unless `STORE_TRANSCRIPTS=true`.
- Uploaded audio/video bytes are held only long enough to transcribe, then cleared from the job payload.
- A deployed production environment should leave `STORE_TRANSCRIPTS=false`.
- If old transcript content exists from earlier builds, run the scrub migration before inviting users.

What is still a trust gap:

- Historical synthesis markdown may exist in plaintext until the scrub migration is run.
- If `STORE_PLAINTEXT_SYNTHESES=true` is ever enabled, synthesis markdown may contain verbatim quotes from transcripts and will be readable by the developer/operator.
- Notion access tokens are stored plaintext in `notion_connections.access_token`.
- Audio/video bytes are processed in-memory and sent to Groq or OpenAI for transcription.
- Transcript text and derived themes are sent to Anthropic for synthesis.
- There is no public privacy/security page yet.
- There is no retention/delete control in the UI.
- There is no SOC 2, HIPAA, enterprise contract, DPA workflow, or zero-data-retention provider mode configured.

This is acceptable for early trusted beta only if communicated clearly. It is not yet enough for broad self-serve use with sensitive company data until client-side encrypted storage, deletion controls, and a public security/privacy page are shipped.

## Raw Transcript Privacy Rule

Production must use:

```text
STORE_TRANSCRIPTS=false
ENABLE_SYNTH_CACHE=false
STORE_PLAINTEXT_SYNTHESES=false
```

With those settings, Gist should not store raw transcript bodies in Supabase, write quote-bearing synthesis cache files to disk, or persist generated synthesis markdown in plaintext. The user sees the generated synthesis in their active browser session; the developer cannot browse raw uploaded transcript bodies or plaintext saved syntheses in Supabase because they are not retained.

Important limitation: this is not the same as full end-to-end encryption for processing. During synthesis, the backend and AI providers still receive transcript/audio data. For stored sensitive data, use client-side encryption as described in `E2EE_STORAGE_PLAN.md`; server-side encryption alone does not satisfy "not even the developer."

## Trust-First Product Strategy

Until stronger controls are shipped, use one of these asks:

- "Use synthetic, redacted, or low-sensitivity interviews first."
- "I can run a white-glove demo with sanitized transcripts."
- "Do not upload confidential customer names, financials, credentials, or regulated data yet."
- "This is an early beta; I am actively hardening security before broad team use."

Avoid promising:

- "Enterprise-grade security"
- "Your data is fully private"
- "No one can access your data"
- "Zero data retention"
- "SOC 2 compliant"

## Supabase Security Checklist

In Supabase dashboard:

1. Keep `SUPABASE_SERVICE_ROLE_KEY` backend-only. Never expose it in Vercel or client code.
2. Confirm RLS is enabled on:
   - `projects`
   - `transcripts`
   - `syntheses`
   - `notion_connections`
   - `oauth_states`
   - `events`
   - `encrypted_artifacts`
3. Confirm policies are least-privilege:
   - Users can only read/write rows tied to their own `auth.uid()`.
   - `oauth_states` has no client-facing read policy.
   - `events` is backend-written; users only select their own rows.
4. Turn email confirmation on before inviting real strangers.
5. Set production Site URL:
   - `https://gist-customer-interview-synthesis.vercel.app`
6. Add only required Redirect URLs:
   - `https://gist-customer-interview-synthesis.vercel.app/**`
   - `http://localhost:3000/**` for local dev only.
7. Raise password requirements.
8. Enable leaked password protection if the Supabase plan supports it.
9. Enable MFA when ready, at least for admin/project owner accounts.
10. Review Supabase logs weekly for failed auth, odd IPs, or unexpected API usage.
11. Rotate keys after any accidental exposure or suspicious activity.
12. Run `backend/migrations/2026-05-21_scrub_transcript_content.sql` once to remove historical raw transcript bodies.
13. Run `backend/migrations/2026-05-21_scrub_plaintext_syntheses.sql` once to remove historical plaintext saved syntheses.
14. Run `backend/migrations/2026-05-21_encrypted_artifacts.sql` before implementing encrypted saves.

Useful SQL audit:

```sql
-- Confirm RLS is enabled on all public tables
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- Review active policies
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

## Railway Security Checklist

In Railway dashboard:

1. Keep only the FastAPI backend public.
2. Do not expose any database, worker, or internal service publicly.
3. Store secrets as Railway variables.
4. Seal high-value variables where available:
   - `ANTHROPIC_API_KEY`
   - `GROQ_API_KEY`
   - `OPENAI_API_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_JWT_SECRET`
   - `NOTION_CLIENT_SECRET`
   - `NOTION_INTERNAL_TOKEN`
5. Confirm `CORS_ORIGINS` contains only:
   - `https://gist-customer-interview-synthesis.vercel.app`
   - `http://localhost:3000` only if needed for local testing
6. Set `STORE_TRANSCRIPTS=false` in production.
7. Set `ENABLE_SYNTH_CACHE=false` in production.
8. Set `STORE_PLAINTEXT_SYNTHESES=false` in production.
9. Keep logs free of transcript content, tokens, uploaded file bytes, and generated synthesis output.
10. Watch deployment logs for unhandled exceptions that may leak request details.
11. Rotate API keys if logs or settings accidentally expose secrets.
12. Use private networking if additional Railway services are added later.

## Vercel Security Checklist

In Vercel dashboard:

1. Only expose public frontend variables:
   - `NEXT_PUBLIC_API_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. Never put backend secrets in Vercel:
   - no Anthropic key
   - no Groq/OpenAI key
   - no Supabase service-role key
   - no Notion client secret/internal token
3. Mark any non-public sensitive variables as sensitive environment variables.
4. Enable deployment protection for preview deployments.
5. Restrict team/project access to only people who need production access.
6. Keep the production domain HTTPS-only.
7. Use Vercel Web Analytics for traffic, but do not record transcript content in analytics events.
8. Confirm security headers are present after deploy:

```bash
curl -I https://gist-customer-interview-synthesis.vercel.app
```

Look for:

- `x-content-type-options: nosniff`
- `x-frame-options: DENY`
- `referrer-policy: strict-origin-when-cross-origin`
- `permissions-policy: camera=(), microphone=(), geolocation=(), payment=()`

## App Security Work To Prioritize

### P0 Before Asking Strangers For Real Confidential Data

1. Add a public `/security` or `/privacy` page with honest data-flow disclosure.
2. Add a visible "Do not upload sensitive or regulated data during beta" note near upload.
3. Add delete controls:
   - delete synthesis
   - delete project
   - delete transcripts
   - disconnect Notion
4. Keep raw transcript retention disabled in production with `STORE_TRANSCRIPTS=false`.
5. Encrypt Notion tokens at application level before storing in Supabase.
6. Keep plaintext synthesis persistence disabled with `STORE_PLAINTEXT_SYNTHESES=false`.
7. Implement client-side encrypted storage from `E2EE_STORAGE_PLAN.md` for saved syntheses.
7. Add structured logging that never logs transcript text, synthesis output, file bytes, or tokens.

### P1 Trust Improvements

1. Add data export/delete instructions.
2. Add provider disclosure:
   - audio/video may be sent to Groq or OpenAI for transcription
   - transcript text and derived themes may be sent to Anthropic for synthesis
   - syntheses can be pushed to Notion only when the user connects Notion
3. Add "redaction before upload" guidance.
4. Add sample transcripts so cautious users can test without uploading real data.
5. Add per-user rate limits to reduce abuse and cost risk.
6. Move jobs from in-memory state to Postgres with ownership checks and expiry.

### P2 Enterprise Path

1. Bring-your-own-provider-key mode.
2. Zero-data-retention provider configuration where available.
3. Customer-managed retention.
4. Workspace/team access controls.
5. Audit logs visible to workspace admins.
6. DPA/privacy policy/TOS.
7. SOC 2 readiness.

## Suggested Security Page Copy

Use this as a starting point:

"Gist is an early beta for customer interview synthesis. Your uploaded transcripts/audio are used to generate themes and quote-backed insights. Text and derived analysis may be processed by Anthropic; audio/video may be processed by Groq or OpenAI for transcription. Gist stores projects, transcripts, and syntheses in Supabase so you can revisit your work. Do not upload regulated data, credentials, or highly confidential information during beta. We are actively adding deletion controls, retention options, and stronger encryption."

## Outreach Framing

When asking for first users, say:

"Because customer interviews can contain sensitive company and customer information, please start with redacted, synthetic, or low-sensitivity transcripts. I am using the first beta users to harden both product quality and security before asking teams to trust Gist with confidential research."
