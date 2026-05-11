# Gist

Turn customer interview transcripts into themed synthesis with traceable quotes — built for solo founders doing customer discovery.

**🌐 Live: [gist-customer-interview-synthesis.vercel.app](https://gist-customer-interview-synthesis.vercel.app)**

**Status: v1.0 — auth, persistence, audio, and Notion push in production.**

Drop `.txt` transcripts or audio (`.mp3 .wav .m4a .mp4 .webm` up to 200 MB), and Gist returns markdown with:

- **Insights** — strongest signal, contradicted assumption, biggest surprise
- **Themes** — clustered across interviews, each with verbatim quotes and participant IDs

Every quote is verified against the source transcript before it reaches the output. If a quote can't be found in the transcript (whitespace-normalized substring match), the theme is dropped and counted in the response — never made up.

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
| Backend | FastAPI, async job pattern (`POST /synthesize` returns 202 + `job_id`, client polls `GET /jobs/{id}`) |
| Persistence | Supabase Postgres with row-level security; service-role key on backend, JWT auth on routes (HS256 legacy + ES256/RS256 JWKS) |
| Frontend | Next.js 14 App Router, Tailwind, `react-markdown`, `@supabase/ssr` |
| Notion | OAuth (Public integration) **or** internal-token fallback. Markdown→blocks converter handles headings, bullets, numbered lists, blockquotes, dividers, paragraphs. Block-count chunking and 2000-char rich_text guards. 429 backoff on all calls |
| Infra | Railway (backend) + Vercel (frontend) + Supabase (auth + DB) |

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
6. **SQL Editor**: paste `backend/schema.sql` and click Run. Then paste `NOTIFY pgrst, 'reload schema';` and run that too (PostgREST needs to refresh its cache after table creation)

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
- **Tables missing in production** — re-run `gist/backend/schema.sql` in the Supabase SQL Editor, then `NOTIFY pgrst, 'reload schema';` to refresh PostgREST's cache.
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
- [backend/db.py](backend/db.py) — Supabase Postgres helpers (with HTTP/2 stale-connection retry)
- [backend/schema.sql](backend/schema.sql) — RLS-enabled tables for projects, transcripts, syntheses, notion_connections, oauth_states
- [frontend/app/page.tsx](frontend/app/page.tsx) — upload UI (drag-drop, per-file labels, staged progress)
- [frontend/app/projects/](frontend/app/projects/) — dashboard + project detail
- [frontend/app/syntheses/[id]/page.tsx](frontend/app/syntheses/) — synthesis detail + Notion push
- [frontend/app/settings/page.tsx](frontend/app/settings/page.tsx) — Notion connection UI

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

**`v1.0.1` is live in production** at [gist-customer-interview-synthesis.vercel.app](https://gist-customer-interview-synthesis.vercel.app) — covers Phase 0 (synthesis) → Phase 1 (audio + async) → Phase 2 (auth + persistence) → Phase 3 (Notion). Phase 4 (real users + iteration) is in progress.
