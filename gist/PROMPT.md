# PROMPT.md — Session Context for Gist

A self-contained restart guide for this project. Drop this into a fresh
Claude Code session along with the repo and resume work without losing
context.

> If this file disagrees with the actual repo state, trust the repo.
> Treat this as a snapshot from 2026-05-24.
> Going forward, keep this file up to date whenever meaningful product,
> architecture, deployment, security, or growth changes are made. Bhavana
> wants to use this file to recreate Gist or a similar app in the future.

---

## 1. What is Gist

An AI tool that takes customer-interview transcripts (text or audio) and
returns themed synthesis with traceable quotes — every quote is
verified verbatim against the source transcript before it reaches the
output. Built for solo founders doing customer discovery.

**Live in production:**
- Frontend: https://gist-customer-interview-synthesis.vercel.app
- Backend API: https://gist-backend-production-ab73.up.railway.app
- GitHub: https://github.com/BK5102/Gist---Customer-Interview-Synthesis

**Latest pushed commit:** (local — projects page synthesis list + project-name bug fix)

---

## 2. Repo layout (critical)

```
Gist---Customer-Interview-Synthesis/        ← repo root (GitHub root)
├── gist/                                    ← project subdirectory
│   ├── backend/
│   │   ├── main.py                          ← FastAPI app + all routes
│   │   ├── auth/supabase_client.py          ← JWT verify (HS256 + JWKS)
│   │   ├── db.py                            ← Supabase helpers + HTTP/2 retry
│   │   ├── synth/                           ← extract / cluster / insights / format / verify / prompts
│   │   ├── transcribe/whisper.py            ← Whisper (Groq + OpenAI) + ffmpeg chunking
│   │   ├── integrations/notion.py           ← OAuth + internal token + markdown→blocks
│   │   ├── schema.sql                       ← Supabase tables + RLS
│   │   ├── migrations/                      ← SQL migrations (run in Supabase SQL Editor)
│   │   ├── requirements.txt
│   │   ├── runtime.txt                      ← python-3.11.x for Railway
│   │   ├── Procfile                         ← uvicorn main:app --host 0.0.0.0 --port $PORT
│   │   └── .env                             ← local secrets (NOT committed)
│   ├── frontend/
│   │   ├── app/
│   │   │   ├── page.tsx                     ← landing hero + upload UI + signed-in workspace hub
│   │   │   ├── login/ signup/ logout/ forgot-password/ reset-password/
│   │   │   ├── projects/page.tsx            ← project list + create project
│   │   │   ├── syntheses/[id]/page.tsx      ← synthesis detail + Notion push UI
│   │   │   ├── encrypted/page.tsx           ← browser-decrypted private saves
│   │   │   ├── settings/page.tsx            ← Notion connect/disconnect
│   │   │   ├── layout.tsx                   ← navbar with brand
│   │   │   ├── globals.css                  ← design system
│   │   │   └── icon.svg                     ← favicon
│   │   ├── components/Breadcrumb.tsx        ← shared breadcrumb nav component
│   │   ├── lib/supabase/{client,server}.ts
│   │   ├── proxy.ts                         ← Supabase session refresh for Next 16
│   │   ├── tailwind.config.ts               ← brand palette + animations
│   │   ├── package.json
│   │   └── .env.local                       ← local NEXT_PUBLIC_* (NOT committed)
│   ├── test-transcripts/                    ← P1.txt, P2.txt, P3.txt for testing
│   ├── eval/results/                        ← extract/cluster/insights cache (gitignored)
│   ├── BUILD_PLAN.md
│   ├── CLAUDE.md                            ← stack + conventions
│   ├── JOURNAL.md
│   ├── USER_GROWTH_PLAN.md
│   ├── SECURITY_TRUST_PLAN.md
│   ├── README.md
│   └── PROMPT.md                            ← this file (committed to repo)
└── .git/
```

**Deploy gotcha — `gist/` wrapper:** Both Railway and Vercel default to
the repo root. They must be told the code lives at `gist/backend` /
`gist/frontend`. Symptoms when skipped:
- Railway: `directory /build-sessions/.../backend does not exist`
- Vercel: `No Output Directory named "public" found`

---

## 3. Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI, Python 3.11+ |
| Frontend | Next.js 16 (App Router), Tailwind CSS, react-markdown, @supabase/ssr |
| Synthesis | Anthropic SDK; `claude-sonnet-4-6` (clustering, insights), `claude-haiku-4-5` (extraction). All via tool-use for structured output |
| Audio | Groq `whisper-large-v3` (free tier, preferred) **or** OpenAI `whisper-1` (paid fallback). Files >24 MB chunked via ffmpeg `-c copy`. Static ffmpeg via `imageio-ffmpeg` |
| Auth | Supabase (HS256 legacy + ES256/RS256 via JWKS — alg detected per-token), email verification/reset-password UI |
| Database | Supabase Postgres with row-level security; backend uses service-role key |
| Notion | OAuth (Public integration) OR internal-token fallback; markdown→blocks with chunking (100-block / 2000-char) and 429 backoff |
| Hosting | Railway (backend), Vercel (frontend), Supabase (auth + DB) |

---

## 4. Environment variables

### `gist/backend/.env` (server-side secrets, NOT committed)

```
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...                       # or OPENAI_API_KEY for audio
SUPABASE_URL=https://<ref>.supabase.co     # bare URL — NO /rest/v1/ suffix
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=<86-char legacy secret>
NOTION_INTERNAL_TOKEN=ntn_...              # OR NOTION_CLIENT_ID + NOTION_CLIENT_SECRET + NOTION_REDIRECT_URI
CORS_ORIGINS=http://localhost:3000         # local-only default
STORE_TRANSCRIPTS=false                    # prod default
ENABLE_SYNTH_CACHE=false                   # prod default
STORE_PLAINTEXT_SYNTHESES=false            # prod default
# Optional rate limit overrides (defaults shown):
MAX_SYNTH_JOBS_PER_WINDOW=5
SYNTH_RATE_WINDOW_SECONDS=600
MAX_ACTIVE_JOBS_PER_USER=2
MAX_NOTION_CALLS_PER_WINDOW=20
NOTION_RATE_WINDOW_SECONDS=60
MAX_PROJECTS_PER_WINDOW=10
PROJECT_RATE_WINDOW_SECONDS=600
```

### `gist/frontend/.env.local` (Next.js public + private, NOT committed)

```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### Railway env vars (production backend)

Same as `backend/.env` PLUS:

```
CORS_ORIGINS=http://localhost:3000,https://gist-customer-interview-synthesis.vercel.app
```

Comma-separated, no spaces around commas, no trailing slashes. Don't
set `PORT` — Railway provides `$PORT` and the Procfile honors it.

### Vercel env vars (production frontend)

Same three as `frontend/.env.local` but with
`NEXT_PUBLIC_API_URL = https://gist-backend-production-ab73.up.railway.app`.

---

## 5. Build phases — what's been done

| Phase | Scope | Status |
|---|---|---|
| Phase 0 | Extract → cluster → insights → markdown pipeline, verbatim quote verification | ✅ |
| Phase 1 | Audio transcription (Groq + OpenAI), ffmpeg chunking, async job pattern, per-file labels, drag-drop UI | ✅ |
| Phase 2 | Supabase auth, JWT verification, Postgres persistence, projects/syntheses dashboards | ✅ |
| Phase 3 | Notion OAuth + internal token, markdown→blocks, push, OAuth CSRF nonce, block/rich_text chunking, 429 backoff | ✅ |
| Deploy | Railway backend + Vercel frontend + Supabase + Notion integration, all live | ✅ |
| Design reset | Replaced vibe-coded design (violet gradients, floating orbs, glass-blur, staggered animations) with editorial/precise direction: near-black buttons, deep teal accent, border-defined surfaces, left-aligned hero, direct copy | ✅ |
| UX improvements | Breadcrumbs on all inner pages, "keep tab open" synthesis messaging, "built for founders" landing copy, defensive JSON rendering | ✅ |
| Security hardening | IDOR fixes in db.py, per-user rate limiting on synthesis/Notion/project-create endpoints, RLS tightened to SELECT-only on all four tables, project name length validation | ✅ |
| UX rework | Project-first flow enforced (synthesis always requires a project), workspace hub redesigned (2-col, no standalone New synthesis), copy rewrite across page.tsx, tab-open messaging clarified | ✅ |
| Projects page v2 | Each project card now lists its synthesis runs (date-labeled, linked to `/syntheses/{id}`) and a one-liner pointing to Private saves. Backend: removed auto-create fallback that named projects after synthesis filenames — `project_id` is now required by `/synthesize` when DB is available. | ✅ Current |
| Phase 4 | Real users, iterate on feedback | ⏳ Open |

---

## 6. Production setup — exact steps that work

### Supabase

1. Create project at https://supabase.com/dashboard
2. **Project Settings → Data API** → copy:
   - **Project URL** (strip `/rest/v1/` if present)
   - **anon public** key (legacy tab) → frontend
   - **service_role secret** key (legacy tab) → backend
3. **Project Settings → Auth → JWT Keys → Legacy JWT Secret** → backend
4. **Authentication → Email** → turn on email confirmation before inviting strangers.
5. **SQL Editor**: paste `gist/backend/schema.sql` → Run. Then run all migration files in `gist/backend/migrations/` in chronological order. Then:
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```

### Migrations applied in production (run in order)

```
2026-05-21_events.sql
2026-05-21_scrub_plaintext_syntheses.sql
2026-05-21_scrub_transcript_content.sql
2026-05-21_encrypted_artifacts.sql
2026-05-22_encrypted_artifacts_project_ownership.sql
2026-05-24_tighten_rls.sql                          ← syntheses + transcripts → SELECT-only
2026-05-24_tighten_rls_projects_connections.sql      ← projects + notion_connections → SELECT-only
```

### Notion (internal token — recommended for solo use)

1. https://notion.so/profile/integrations → **+ New integration**
2. Type: Internal. Capabilities: Read + Update + Insert content.
3. Copy **Installation access token** → `NOTION_INTERNAL_TOKEN`
4. In Notion, open the target database → **⋯ → Connections → + Add connections → Gist → Confirm**

### Railway (backend)

1. **+ New Project → Deploy from GitHub repo**
2. Service **Settings → Build → Root Directory** = `gist/backend`
3. **Settings → Networking → Generate Domain**
4. **Variables**: paste each line from local `backend/.env`. Set `CORS_ORIGINS` to the Vercel URL.
5. Verify `/health` returns `{"status":"ok"}`

### Vercel (frontend)

1. **+ Add New → Project** → import same repo
2. **Framework Preset = Next.js**
3. **Root Directory = `gist/frontend`**
4. Env vars: the three `NEXT_PUBLIC_*` vars with `NEXT_PUBLIC_API_URL` pointing at Railway.
5. Deploy. Add the Vercel URL to Railway's `CORS_ORIGINS`.

---

## 7. Common production gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `net::ERR_NAME_NOT_RESOLVED` on Supabase URL | Free-tier project paused | Supabase dashboard → **Restart project** |
| "CORS error" | Vercel URL not in Railway's `CORS_ORIGINS`, OR backend threw an unhandled 500 (errors bypass CORS middleware) | Check Railway env first; check Railway logs for the real error |
| `Could not find the table 'public.X' in the schema cache` | PostgREST cache stale after running schema | `NOTIFY pgrst, 'reload schema';` in SQL Editor |
| `Invalid path specified in request URL` | URL has `/rest/v1/` suffix | Strip suffix from env |
| Pages render blank on load | Fetch threw and `setLoading(false)` never ran | All loads are wrapped in try/finally |
| `httpx.RemoteProtocolError ConnectionTerminated` | Supabase HTTP/2 stale connection | `@_with_db_retry` in `db.py` handles this with one retry |
| Notion push fails for long syntheses | >100 blocks or >2000 chars per text | Already fixed: chunks blocks via PATCH, splits text at word boundaries |
| JWT verification fails with "alg not allowed" | Supabase migrated to ES256 JWT signing | Already fixed: `verify_token` detects alg from header |

---

## 8. Local dev quickstart

```bash
# Backend
cd gist/backend
python -m venv venv
source venv/Scripts/activate   # Windows
pip install -r requirements.txt
cp .env.example .env           # fill in keys
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd gist/frontend
npm install
# Create .env.local with the 3 NEXT_PUBLIC_ vars
npm run dev

# Open http://localhost:3000
```

---

## 9. Architecture decisions worth remembering

1. **All LLM prompts live in `synth/prompts.py`** — no inline strings elsewhere
2. **Quote verification is a hard post-check, not a prompt hint** — `verify.py` normalizes both strings and does substring containment. Themes whose quotes can't be found are dropped.
3. **Tool-use over JSON mode** for structured LLM output — more reliable
4. **Cache by SHA1 of input, not mtime**
5. **`load_dotenv(override=True)`** — defeats empty shell vars silently overriding `.env`
6. **Service-role key on backend, RLS on tables** — backend bypasses RLS and enforces ownership in Python
7. **Conditional DB persistence** — pipeline runs even if DB write fails; user still gets markdown
8. **Async job pattern for `/synthesize`** — POST returns 202 + `job_id` in ~6ms; frontend polls `/jobs/{id}` every 2s
9. **In-memory job store (`JOBS` dict)** — works for v1; Phase 2 was supposed to swap to Postgres-backed jobs, still pending
10. **`@_with_db_retry` decorator** — single retry on `RemoteProtocolError` / `ConnectError` / `ReadError`
11. **OAuth state nonce** — random 32-byte token in `oauth_states` table, 10-min TTL, single-use
12. **Job polling is authenticated and owner-checked** — `GET /jobs/{job_id}` requires auth and checks `job["user_id"]` against the requesting user; returns 404 on mismatch
13. **Security headers in both backend and frontend** — `nosniff`, `DENY` framing, strict referrer policy, permissions policy
14. **PROMPT.md is durable rebuild memory** — committed to repo so it survives across machines and sessions
15. **Password-based private saves** — encryption/decryption happen in the browser (AES-GCM, PBKDF2-SHA256). Password never stored or sent. Forgetting the save password makes the encrypted artifact unrecoverable.
16. **Signed-in brand navigation** — clicking the `G`/Gist logo sends signed-in users to `/?landing=1`, rendering the landing page with the signed-in navbar.
17. **Design direction: editorial/precise, not decorative** — near-black primary buttons (`bg-zinc-900`), deep teal accent (`brand-700 = #0f766e`), border-defined surfaces (no shadows, no blur, no gradients), left-aligned hero, direct copy. Design communicates restraint and trust — appropriate for a tool that handles sensitive customer research data.
18. **IDOR defense in db.py** — `get_syntheses_for_project(user_id, project_id)` and `get_transcripts_for_project(user_id, project_id)` both require `user_id` and enforce ownership via a `projects!inner(user_id)` join. Safe to call from any context.
19. **Per-user rate limiting via in-memory sliding window** — `defaultdict(deque)` per endpoint category. Synthesis: 5/10min, max 2 concurrent. Notion proxy: 20/60s. Project creation: 10/10min. All configurable via env vars.
20. **RLS is SELECT-only on backend-owned tables** — `syntheses`, `transcripts`, `projects`, and `notion_connections` use `FOR SELECT` policies. The backend service-role key handles all writes; client JWTs can only read their own rows. `encrypted_artifacts` retains `FOR ALL` with `WITH CHECK` because the browser writes directly to Supabase.
21. **Project-first synthesis flow** — synthesis always requires a `?project=<id>` context. Visiting `/?upload=1` without a project falls through to the workspace hub. The standalone "New synthesis" entry point has been removed. Flow: Projects → pick or create project → New synthesis (per-project row action).
22. **Projects page synthesis list** — each project card fetches its syntheses in parallel via `GET /projects/{id}` and displays them as clickable date-labeled rows linking to `/syntheses/{id}`. A one-liner at the bottom of each card directs users to Private saves for encrypted reports. `syntheses` are only shown when `STORE_PLAINTEXT_SYNTHESES=true`; the Private saves hint always shows.
23. **Project auto-naming removed** — `/synthesize` now returns 400 if `project_id` is missing when the DB is available, instead of auto-creating a project named `"Synthesis {filename}"`. This was the root cause of some projects showing synthesis filenames as their names.

---

## 9A. Security and trust posture

Critical user insight: the target audience (founders, PMs, researchers)
will not upload company/customer data to a random new tool without trust.
Security is part of the product, not just infrastructure.

**Current posture:**

- Supabase Auth gates all protected routes.
- All four core tables have RLS enabled; SELECT-only policies for tables the backend owns; `encrypted_artifacts` allows client-side INSERT with ownership check.
- Backend uses service-role key (bypasses RLS) and enforces ownership in Python before calling db helpers.
- `get_syntheses_for_project` and `get_transcripts_for_project` enforce user ownership via join — safe regardless of call site.
- Per-user rate limits: synthesis (5/10min, max 2 concurrent), Notion proxy (20/60s), project creation (10/10min).
- Raw transcripts not persisted by default (`STORE_TRANSCRIPTS=false`).
- Synthesis cache disabled by default (`ENABLE_SYNTH_CACHE=false`).
- Plaintext synthesis persistence disabled by default (`STORE_PLAINTEXT_SYNTHESES=false`).
- Browser-side AES-GCM encrypted private saves: password never leaves the device.
- Notion OAuth uses single-use CSRF nonces (`oauth_states` table).
- Notion access tokens encrypted at rest with Fernet when `NOTION_TOKEN_ENCRYPTION_KEY` is set.
- CORS restricted to configured origins.
- Baseline security headers on both backend and frontend.

**Trust gaps remaining:**

- No public `/security` or `/privacy` page.
- No deletion/retention controls for projects, syntheses, or encrypted artifacts.
- No event logging wired (analytics `events` table exists but no writes yet).
- Audio/video sent to Groq or OpenAI for transcription.
- Transcript text and themes sent to Anthropic.
- In-memory job store resets on backend restart (jobs lost).

**Raw transcript privacy rule (production must enforce):**

```
STORE_TRANSCRIPTS=false
ENABLE_SYNTH_CACHE=false
STORE_PLAINTEXT_SYNTHESES=false
```

---

## 10. Commit history (post-design-reset)

```
fa6f76c  design: replace vibe-coded UI with editorial, restrained aesthetic
391f239  ux: breadcrumbs, landing audience copy, async messaging, JSON rendering fix
8af06a4  security: fix IDOR, add Notion rate limiting, tighten RLS
dd380aa  security: rate limit project creation, tighten projects/connections RLS
85a1669  copy: rewrite page.tsx strings for clarity and specificity
145b37d  ux: enforce project-first flow, fix signed-in landing CTA
a175406  ux: clarify tab-open requirement during synthesis
```

Tags: `v0.2.0` (Phase 1 milestone), `v1.0.0` (Phase 3 release), `v1.0.1` (hardening + polish).

---

## 11. Conversation log — what user asked, in order

1. **Recover context** — read BUILD_PLAN, CLAUDE.md, JOURNAL, README; build from Day 1.
2–13. *(earlier build days — see previous PROMPT.md snapshot or JOURNAL.md)*
14. **Deploy** — Railway backend, Vercel frontend, Supabase JWT, CORS wiring.
15. **Production fixes** — DNS error from paused Supabase, CORS_ORIGINS update, try/catch hardening.
16. **README updated for production.**
17. **Removed Claude as co-author** — git filter-branch, re-tagged v1.0.1, force-pushed.
18. **PROMPT.md created** for session restart.
19. **Phase 4 growth + security pivot** — USER_GROWTH_PLAN.md, SECURITY_TRUST_PLAN.md, events table migration, authenticated job polling, baseline security headers.
20. **Raw transcript and synthesis retention disabled** — `STORE_TRANSCRIPTS=false`, `STORE_PLAINTEXT_SYNTHESES=false`, `ENABLE_SYNTH_CACHE=false`. Scrub migrations for historical rows.
21. **Browser-side encrypted save prototype** (IndexedDB key, then superseded).
22. **Encrypted save strategy refined** — password-per-save flow, simpler than backup-key scheme.
23. **Password-based private saves shipped** — AES-GCM in browser, password never sent.
24. **Auth and navigation tightened** — forgot/reset password UI, `/?landing=1` for signed-in logo click.
25. **Trust-first beta growth plan** — recruit 5-10 users manually with redacted/synthetic transcripts first.
26. **Pre-growth design reset requested** — make the UI feel trustworthy and production-grade.
27. **Design reset shipped** — editorial aesthetic across all 13 frontend files. Committed `fa6f76c`.
28. **UX improvements** — breadcrumbs on all inner pages, synthesis async messaging, "built for founders" landing copy, defensive JSON rendering, HTML validity fix (nested `<main>`). Committed `391f239`.
29. **Security audit** — IDOR fixed in `db.py` (`user_id` + ownership join on both project-scoped db helpers); Notion rate limiting (20/60s); project creation rate limiting (10/10min) + name length validation (1-200 chars); RLS tightened to SELECT-only on syntheses, transcripts, projects, notion_connections via two migration files — both applied in production. Committed `8af06a4`, `dd380aa`.
30. **Copy rewrite on page.tsx** — all user-visible strings rewritten: cut generic SaaS phrasing, headlines describe actual behavior, specifics added throughout. Committed `85a1669`.
31. **Project-first flow enforced + workspace redesigned** — synthesis now always requires a project; `?upload=1` without project falls through to hub; workspace hub redesigned (2-col, removed New synthesis card, how-it-works updated to project → synthesis → save flow); landing Create account CTA hidden for signed-in users; secondary hero button changed to "Go to projects"; freestanding New synthesis button removed from projects page header. Committed `145b37d`.
32. **Tab-open synthesis messaging** — clarified that user can switch tabs, just not close this one. Lead with permission, pair with constraint. Committed `a175406`.
33. **PROMPT.md updated and committed to repo** — removed from `.gitignore`, updated to reflect all changes from sessions 28-32.
34. **Projects page synthesis list + project-name bug** — projects page now fetches and displays synthesis runs per project (date-labeled, linked to `/syntheses/{id}`), with a one-liner pointing to Private saves. Backend: removed auto-create fallback (`"Synthesis {filename}"` project names) — `/synthesize` now returns 400 if no `project_id` when DB is available.

---

## 12. Open / next steps

- **(A) Security/trust hardening — remaining items**
  - Add `/security` or `/privacy` page with honest data-flow disclosure
  - Add visible beta warning near upload for confidential/regulated data
  - Add delete controls for projects, syntheses, encrypted artifacts, and Notion connection
  - Add event logging for synthesis/private-save/notion/copy actions
  - Configure `NOTION_TOKEN_ENCRYPTION_KEY` in production; rotate/reconnect old tokens
  - Consider Postgres-backed job store for restart durability
- **(B) Custom domain** — buy `gist.tld`, point at Vercel via DNS.
- **(C) Phase 4 real users** — recruit first 5-10 users manually with redacted/synthetic transcripts. Lead with "private-by-default synthesis with traceable quotes."
- **(D) Watch for real-user feedback, iterate**
- **(E) Backlog**
  - Notion `default_database_id` column exists in schema but never used
  - Synthesis save errors silently swallowed — wire to Sentry / structured log
  - Notion OAuth path needs continued production testing

---

## 13. Useful commands

```bash
# Type-check frontend
cd gist/frontend && npx tsc --noEmit

# Verify backend imports
cd gist/backend && python -c "import main; print(sorted([r.path for r in main.app.routes if hasattr(r,'path')]))"

# Verify CORS preflight
curl -s -I -X OPTIONS https://gist-backend-production-ab73.up.railway.app/projects \
  -H "Origin: https://gist-customer-interview-synthesis.vercel.app" \
  -H "Access-Control-Request-Method: GET"

# Refresh Supabase schema cache (in SQL Editor)
NOTIFY pgrst, 'reload schema';

# Force-prune local git orphans (after history rewrite)
git reflog expire --expire=now --all && git gc --aggressive --prune=now
```

---

## 14. Files to read first when restarting

1. **`PROMPT.md`** — this file, start here
2. **`CLAUDE.md`** — stack + conventions
3. **`gist/backend/main.py`** — all backend routes in one place
4. **`gist/frontend/app/page.tsx`** — landing + upload UI + signed-in hub
5. **`gist/backend/schema.sql`** — DB schema
6. **`SECURITY_TRUST_PLAN.md`** — trust posture and platform hardening checklist
7. **`USER_GROWTH_PLAN.md`** — Phase 4 user acquisition plan
8. **`README.md`** — user-facing doc, current production status
