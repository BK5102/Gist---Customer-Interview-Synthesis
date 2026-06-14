# Gist

Turn customer interview transcripts into themed synthesis with traceable quotes — built for solo founders doing customer discovery.

**🌐 Live: [gist-customer-interview-synthesis.vercel.app](https://gist-customer-interview-synthesis.vercel.app)**

**Status: v1.1 — auth, persistence, audio, Notion push, dark mode, profile photo, Postgres job store, and UX polish in production.**

Latest: theme toggle in navbar, profile photo upload in Settings, scroll-to-save warning, Postgres-backed job store (survives Railway restarts), avatar shown in navbar.

Drop `.txt` transcripts or audio (`.mp3 .wav .m4a .mp4 .webm` up to 200 MB), and Gist returns markdown with:

- **Insights** — strongest signal, contradicted assumption, biggest surprise
- **Themes** — clustered across interviews, each with verbatim quotes and participant IDs

Every quote is verified against the source transcript before it reaches the output. If a quote can't be found in the transcript (whitespace-normalized substring match), the theme is dropped and counted in the response — never made up.

## Security note

Gist is an early beta that processes potentially sensitive customer-interview material. Do not upload regulated data, credentials, financial secrets, or highly confidential customer/company information until stronger retention, deletion, and encryption controls are in place.

Current protections include Supabase Auth, RLS-backed tables, backend ownership checks, restricted CORS, Notion OAuth state nonces, authenticated job polling, baseline security headers, raw transcript retention disabled by default, synthesis disk caching disabled by default for the web app, and plaintext synthesis persistence disabled by default. Private saves are AES-GCM encrypted in the browser with a password Gist never sees or stores. See [/security](https://gist-customer-interview-synthesis.vercel.app/security) for the full data-flow disclosure.

## Pipeline

```
audio → Whisper transcribe ──┐
                             ├─→ extract themes per-file (Haiku, tool-use)
text ────────────────────────┘        │
                                      ▼
                              cluster across files (Sonnet)
                                      ▼
                              insights (Sonnet)
                                      ▼
                              render markdown ──→ optional: push to Notion
```

The extract / cluster / insights steps cache by SHA1 of their input under `eval/results/`, so re-runs on the same transcripts skip the slow LLM calls.

## Stack

| Layer | What |
|---|---|
| Synthesis | Anthropic SDK, `claude-sonnet-4-6` (clustering, insights), `claude-haiku-4-5` (extraction) — all via tool-use for structured output |
| Audio | Groq (`whisper-large-v3`, free tier, preferred) or OpenAI (`whisper-1`, paid). Files >24 MB chunked via ffmpeg `-c copy` (no re-encode). Static ffmpeg ships via `imageio-ffmpeg` |
| Backend | FastAPI, async job pattern (`POST /synthesize` returns 202 + `job_id`, client polls `GET /jobs/{id}`). Jobs persisted to Postgres (write-through + fallback read) so synthesis survives Railway restarts. |
| Persistence | Supabase Postgres with row-level security; service-role key on backend, JWT auth on routes (HS256 legacy + ES256/RS256 JWKS). Tables: `projects`, `transcripts`, `syntheses`, `encrypted_artifacts`, `notion_connections`, `oauth_states`, `jobs` |
| Storage | Supabase Storage — `avatars` public bucket for profile photos (user-scoped RLS, flat path = user_id) |
| Frontend | Next.js 16 App Router, Tailwind, `react-markdown`, `@supabase/ssr`. Dark mode via `ThemeProvider` (localStorage + system preference) + `ThemeToggle` (sun/moon toggle in navbar) |
| Notion | OAuth (Public integration) **or** internal-token fallback. Markdown→blocks converter handles headings, bullets, numbered lists, blockquotes, dividers, paragraphs. Block-count chunking and 2000-char rich_text guards. 429 backoff on all calls |
| Infra | Railway (backend) + Vercel (frontend) + Supabase (auth + DB + storage) |

## Run locally

You need accounts on **Anthropic** (synthesis), **Groq or OpenAI** (audio), **Supabase** (auth + DB), and **Notion** (optional push). Total setup: ~20 minutes if you don't already have these.

### 1. Supabase

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. **Project Settings → API**:
   - Copy the **Project URL** (just the bare URL — strip any `/rest/v1/` suffix)
   - Copy the **`anon public`** key (legacy tab) — used by the frontend
   - Copy the **`service_role secret`** key (legacy tab) — used by the backend
3. **Project Settings → Auth → JWT Keys → Legacy JWT Secret**: copy the value (used by backend to verify tokens)
4. **Authentication → Sign In / Providers → Email**: turn off **Confirm email** for local dev (so signup doesn't try to send mail)
5. **Authentication → URL Configuration**: not strictly needed for local dev with Confirm Email off — but if you re-enable Confirm Email later, set **Site URL** = `http://localhost:3000` and add `http://localhost:3000/**` to Redirect URLs
6. **SQL Editor**: paste `backend/schema.sql` and click Run. Then run each file in `backend/migrations/` in filename order. Finally paste `NOTIFY pgrst, 'reload schema';` and run that too (PostgREST needs to refresh its cache after table creation)
7. **Storage**: create a bucket named `avatars`, set it to **Public**, and add an RLS policy that allows authenticated users to read/write their own objects (`name = auth.uid()::text`)

### 2. Notion (optional, for push)

The simplest path uses an **Internal integration**, which sidesteps Notion's marketplace-profile requirement.

1. Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations)
2. **+ New integration** → name it "Gist" → pick your workspace → Save
3. Click **Show** on the **Installation access token** — copy the value (this is your `NOTION_INTERNAL_TOKEN`)
4. **Capabilities**: check Read content, Update content, Insert content
5. In Notion itself, open the database where you want syntheses to land. Click ⋯ at the top-right → **Connections** → **Add connections** → pick your integration → **Confirm**. Repeat for any other databases you want available

If you want OAuth instead (multi-tenant, public distribution), you'll need to complete a Notion Marketplace Profile and configure `NOTION_CLIENT_ID` + `NOTION_CLIENT_SECRET` + `NOTION_REDIRECT_URI` instead. The backend prefers OAuth when both are set.

### 3. Backend

```bash
cd backend
python -m venv venv
source venv/Scripts/activate   # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...                   # or OPENAI_API_KEY=sk-... for audio

# Supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=<legacy JWT secret>

# Notion (one of OAuth pair OR internal token)
NOTION_INTERNAL_TOKEN=secret_...
# OR:
# NOTION_CLIENT_ID=...
# NOTION_CLIENT_SECRET=...
# NOTION_REDIRECT_URI=http://localhost:8000/notion/callback

CORS_ORIGINS=http://localhost:3000
```

Start it:

```bash
uvicorn main:app --reload --port 8000
```

Smoke-test:

```bash
curl http://localhost:8000/health
# {"status": "ok"}
```

### 4. Frontend

```bash
cd ../frontend
npm install
```

Create `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

Start it:

```bash
npm run dev
```

Open `http://localhost:3000`, sign up, log in, create a project, drop a transcript from `test-transcripts/`, click Synthesize. To push the result to Notion, hit the "Push to Notion" dropdown on the synthesis detail page.

## Deploy

The repo's actual layout is `gist/backend/` and `gist/frontend/` (one level under the repo root). Both Railway and Vercel need to know that — easiest way is to set Root Directory explicitly.

### Backend → Railway

1. **New Project → Deploy from GitHub repo** → pick this repo
2. Service **Settings → Build → Root Directory** = `gist/backend`
   *(Skipping this gives `directory /build-sessions/.../backend does not exist`.)*
3. **Settings → Networking** → **Generate Domain** (you'll get something like `gist-backend-production-XXXX.up.railway.app`)
4. **Variables**: copy every line from your local `backend/.env`. Don't set `PORT` — Railway provides `$PORT` and the `Procfile` honors it.
5. `CORS_ORIGINS` is a comma-separated list with **no spaces around commas, no trailing slashes**:
   ```
   http://localhost:3000,https://<your-vercel-domain>.vercel.app
   ```
6. Verify: hit `https://<railway-domain>/health` — expect `{"status":"ok"}`. The bare URL gives a 404 (no root route); always use `/health` for liveness checks.

### Frontend → Vercel

1. **+ Add New → Project** → import the same repo
2. **Framework Preset** must be **Next.js**. If Vercel auto-detects "Other" because of the nested folder, set it manually. Symptom of skipping this: build fails with `No Output Directory named "public" found`.
3. **Root Directory** = `gist/frontend`
4. **Environment Variables**:
   - `NEXT_PUBLIC_API_URL` = your Railway URL (bare, no trailing slash, no `/health`)
   - `NEXT_PUBLIC_SUPABASE_URL` = same value as in your local `frontend/.env.local`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = same value as in your local `frontend/.env.local`
5. Deploy. Vercel gives you a `*.vercel.app` URL — add it to `CORS_ORIGINS` on Railway (step 5 above) and Railway will auto-redeploy.

### Common production gotchas

- **DNS failure on Supabase URL** (`net::ERR_NAME_NOT_RESOLVED`) — Supabase free-tier projects pause after a week of inactivity. Log into the Supabase dashboard and click **Restart project**.
- **CORS preflight failure on every route** — you forgot to add the Vercel URL to `CORS_ORIGINS` on Railway, or you used a trailing slash. The fix is always on Railway, never in the frontend.
- **Tables missing in production** — re-run `gist/backend/schema.sql` in the Supabase SQL Editor, then each migration file in `backend/migrations/` in order, then `NOTIFY pgrst, 'reload schema';` to refresh PostgREST's cache.
- **Avatar images blocked** (`net::ERR_BLOCKED_BY_CLIENT` or blank avatar) — `next.config.mjs` must include `https://*.supabase.co` in the `img-src` CSP directive. Check that the avatars bucket exists in Supabase Storage and is set to **Public**.
- **Notion redirect URI mismatch** (OAuth only) — if you used the OAuth flow rather than internal token, update `NOTION_REDIRECT_URI` on Railway to `https://<railway-domain>/notion/callback` and add the same URL to your Notion integration's Redirect URIs.

## Repo layout

See [CLAUDE.md](CLAUDE.md) for the full tree. Key entry points:

- [backend/main.py](backend/main.py) — FastAPI app: `/synthesize`, `/jobs/{id}`, `/projects`, `/syntheses/{id}`, `/notion/*`
- [backend/synth/prompts.py](backend/synth/prompts.py) — all LLM prompts + tool schemas (no inline strings elsewhere)
- [backend/synth/extract.py](backend/synth/extract.py) — per-transcript theme extraction
- [backend/synth/cluster.py](backend/synth/cluster.py) — cross-transcript clustering
- [backend/synth/insights.py](backend/synth/insights.py) — founder takeaways
- [backend/synth/verify.py](backend/synth/verify.py) — quote-substring verification
- [backend/synth/format.py](backend/synth/format.py) — markdown renderer
- [backend/transcribe/whisper.py](backend/transcribe/whisper.py) — audio → text + chunking
- [backend/auth/supabase_client.py](backend/auth/supabase_client.py) — JWT verification (HS256 + JWKS)
- [backend/integrations/notion.py](backend/integrations/notion.py) — OAuth, internal token, markdown→blocks
- [backend/db.py](backend/db.py) — Supabase Postgres helpers + job read/write (HTTP/2 stale-connection retry)
- [backend/schema.sql](backend/schema.sql) — RLS-enabled tables for projects, transcripts, syntheses, notion_connections, oauth_states
- [backend/migrations/](backend/migrations/) — incremental SQL migrations (run in order in Supabase SQL Editor): `001_add_notion_connections.sql`, `002_add_project_description.sql`, `2026-06-13_jobs_table.sql`, `2026-06-13_avatars_storage.sql`
- [frontend/app/page.tsx](frontend/app/page.tsx) — upload UI (drag-drop accumulates files, per-file labels, staged progress)
- [frontend/app/projects/](frontend/app/projects/) — dashboard + project detail
- [frontend/app/syntheses/[id]/page.tsx](frontend/app/syntheses/) — synthesis detail + Notion push
- [frontend/app/settings/page.tsx](frontend/app/settings/page.tsx) — Profile (avatar upload), Security & Privacy link, Notion connection
- [frontend/app/security/page.tsx](frontend/app/security/) — static data-flow disclosure page
- [frontend/components/ThemeProvider.tsx](frontend/components/ThemeProvider.tsx) — dark/light/system theme context; `useTheme()` hook
- [frontend/components/ThemeToggle.tsx](frontend/components/) — sun/moon icon toggle rendered in the navbar

## How many files to upload

| File count | What you get |
|---|---|
| 1–2 | Runs, but clustering is weak — essentially summarizing two people. Not enough signal to distinguish patterns from coincidence. |
| 3–5 | Sweet spot for early customer discovery. Enough variance to surface real themes, contradictions, and outliers. |
| 6–10 | Strong signal. Themes become reliably representative. Best for a full research round. |
| 10–20 | Good for larger rounds. Each file is a separate extraction call, so cost and time scale linearly. |

Files accumulate on upload — add them one at a time or all at once. **3 files is the practical minimum** for the cross-interview clustering to be meaningfully different from a manual read-through.

Individual quote accuracy is independent of file count — every quote is verified verbatim against its source transcript regardless of how many transcripts are in the batch.

## Limits

- Text: 2 MB per `.txt` file
- Audio: 200 MB per file (auto-chunked above 24 MB before hitting the Whisper API)
- 20 files per request, text + audio mixable
- Synthesis takes ~30s per text transcript and ~1 min per 5 min of audio (Whisper) plus ~30s for clustering and insights
- Notion `children` capped at 100 blocks per request — handled internally via repeated `PATCH /blocks/{id}/children`
- Notion rich_text capped at 2000 chars per object — handled internally by splitting at word boundaries

## Costs

Approximate per-interview cost at the time of writing:

| Step | Provider | Cost |
|---|---|---|
| Audio transcription (5-min interview) | Groq (free tier) | $0 |
| Audio transcription (5-min interview) | OpenAI Whisper | $0.03 |
| Theme extraction (per transcript) | Anthropic Haiku | ~$0.005 |
| Cross-cluster + insights (one batch) | Anthropic Sonnet | ~$0.05 |

A 5-interview synthesis on Groq: ~$0.08. On OpenAI: ~$0.23.

## Feedback

This is a hobby project. If you actually use it for customer discovery and have notes — bugs, weird outputs, missing features — open an issue on GitHub or email the address in your `git log` author field.

## Status

**`v1.1` is live in production** at [gist-customer-interview-synthesis.vercel.app](https://gist-customer-interview-synthesis.vercel.app) — covers Phase 0 (synthesis) → Phase 1 (audio + async) → Phase 2 (auth + persistence) → Phase 3 (Notion) → design + UX polish (dark mode, bigger nav, breadcrumbs, back nav, meta-chips, JSON fix, save flow, underline tabs, clean settings icon, theme toggle in navbar, profile photo, avatar in navbar, Postgres job store). Phase 4 (real users + iteration) is in progress.
