# PROMPT.md — Session Context for Gist

A self-contained restart guide for this project. Drop this into a fresh
Claude Code session along with the repo and resume work without losing
context.

> If this file disagrees with the actual repo state, trust the repo.
> Treat this as a snapshot from 2026-06-10.
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

**Latest pushed commit:** `06e3ec4` — design: shimmer on all page titles, teal accent in light mode

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
│   │   ├── components/ThemeProvider.tsx     ← dark/light/system theme context + useTheme() hook
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
NOTION_TOKEN_ENCRYPTION_KEY=...           # REQUIRED in prod — Fernet key for encrypting Notion tokens at rest
                                          # Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
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
| Projects page v2 | Each project card now lists its synthesis runs (date-labeled, linked to `/syntheses/{id}`) and a one-liner pointing to Private saves. Backend: removed auto-create fallback that named projects after synthesis filenames — `project_id` is now required by `/synthesize` when DB is available. | ✅ |
| Security audit | Full OWASP audit + 10 fixes: exception internals no longer reach clients; NOTION_TOKEN_ENCRYPTION_KEY documented; FastAPI docs disabled in prod; HSTS added; CORS tightened; auth callback `next` param validated; PBKDF2 raised to 600K iterations; Notion OAuth cancel redirects to UI; N+1 project fetches replaced with single request; job pruning on every poll. | ✅ |
| Design audit | `/ui-design-prompts` full audit. 6 fixes: removed border+shadow double on cards and navbar; unified `zinc-*` → `neutral-*` across all 11 frontend files; standardized inner page header spacing to `mb-8`; replaced blue-50/blue-700 "Extracting" badge with brand teal; added `translateY` to `fadeIn` keyframe; fixed `<p>` as flex container. | ✅ |
| Border removal | Removed all subsection borders across all pages: `.card` border stripped from globals.css (cascades site-wide); section dividers (`border-t`), info panels, file list items, and all colored alert borders (red/green/amber) removed inline per page. Dashed drag-and-drop zones, form input borders, and button borders preserved. | ✅ |
| Visual motion refresh | Warmer humanist system font stack, richer background color, subtle card depth, 3D hover motion, animated stage rails, scroll/entrance transitions, first-viewport sample synthesis visual (ProductDemo component), more tactile surfaces. | ✅ |
| Tasteful 3D inspiration pass | Circular kinetic text, slow marquee rail, layered 3D landing hero cards. ResearchOrbit replaced by ProductDemo (mock browser frame showing synthesis result). | ✅ |
| Workspace clarity + ambient 3D | Widened page container, ambient 3D side shapes, centered footer, signed-in workspace hero rewrite, tighter landing copy, logout latency fix. | ✅ |
| UI spacing + micro-interactions | Reduced whitespace, nav icons/state visuals, stronger primary button hover, `cardLoad` animation, `fade-panel` transitions. | ✅ |
| Railway Python build fix | Added `gist/backend/mise.toml` with `python.github_attestations = false` for Railway/mise 2026.6.0 compatibility. | ✅ |
| Project descriptions + synthesis linking | `PATCH /projects/{id}` endpoint; `update_project()` in db.py; `projects.description` column (migration `002_add_project_description.sql`); project card Overview tab shows editable description; synthesis list queries `encrypted_artifacts` by `project_id` directly from frontend — shows save titles, not dates from backend `syntheses` table (which is empty by default). | ✅ |
| Workspace UX cleanup | Private Saves: removed 3-tab nav (single working list), added X close button. Projects page: removed Private saves button per card; functional Overview/Syntheses tabs (`.project-tabs` dark pill style, no borders); removed non-functional top workspace-tabs; added Most recent synthesis header button. Workspace hub: removed Private reports tab, Private saves card, How it works section, Next best step panel; added Recent syntheses list (last 5 from `encrypted_artifacts`). Landing: removed How it works card grid, trimmed hero paragraph. Synthesis title auto-populated from first file stem. | ✅ |
| Dark mode + competitor design pass | Theme toggle in Settings (Light/Dark/System); `ThemeProvider` client component with localStorage + system preference; anti-flash inline script in `<head>`; comprehensive dark CSS vars in globals.css; removed hero kinetic-marquee scroll animation + both eyebrows ("Private-by-default…" and "What it does"); tightened page spacing; trust signal chips below hero CTAs; Dovetail/Looppanel-inspired feature copy; `SECURITY_TRUST_PLAN.md` + `E2EE_STORAGE_PLAN.md` added to `.gitignore`. | ✅ |
| Design refinement: icons, security page, shimmer, polish | SVG inline icons for trust chips + feature cards (Looppanel-inspired: 16×16 / 24×24, outline, 1.5px stroke, round caps, `stroke="currentColor"`); `/security` static page (data-flow disclosure, `Row` component, `CheckIcon`/`LockIcon`/`ShieldIcon`/`AlertIcon`); `Features` + `Security` navbar links (signed-out, `hidden sm:inline-flex`); `.page-title` shimmer class — light mode `#0a0a0a→#0f766e→#0a0a0a` gradient with 6 s sweep, dark mode `#e5e5e5→#5eead4→#e5e5e5`; critical fix: `.dark .page-title` must re-declare `-webkit-background-clip: text; background-clip: text` — `background` shorthand resets `background-clip` to `border-box` causing full-rectangle gradient bug; eyebrow removals (Browser-encrypted storage, Research rounds, Research project, Workspace); Files/Progress/Report upload tab bar removed; default project tab `"syntheses"` → `"overview"`; date text bumped to `text-sm font-medium dark:text-neutral-300`; `.dark .btn-primary` brightened to teal-600 base / teal-500 hover; "traced" → "linked" in hero `text-gradient` span; "For founders…" fixed to `dark:text-neutral-200`; `.dark .trust-chip` color raised to `rgb(196 196 196)`. | ✅ Current |
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
17. **Design direction: editorial/precise, not decorative** — near-black primary buttons (`bg-neutral-900`), deep teal accent (`brand-700 = #0f766e`), borderless surfaces (no shadows, no blur, no gradients, no card borders — background color alone separates sections), left-aligned hero, direct copy. Design communicates restraint and trust — appropriate for a tool that handles sensitive customer research data.
18. **IDOR defense in db.py** — `get_syntheses_for_project(user_id, project_id)` and `get_transcripts_for_project(user_id, project_id)` both require `user_id` and enforce ownership via a `projects!inner(user_id)` join. Safe to call from any context.
19. **Per-user rate limiting via in-memory sliding window** — `defaultdict(deque)` per endpoint category. Synthesis: 5/10min, max 2 concurrent. Notion proxy: 20/60s. Project creation: 10/10min. All configurable via env vars.
20. **RLS is SELECT-only on backend-owned tables** — `syntheses`, `transcripts`, `projects`, and `notion_connections` use `FOR SELECT` policies. The backend service-role key handles all writes; client JWTs can only read their own rows. `encrypted_artifacts` retains `FOR ALL` with `WITH CHECK` because the browser writes directly to Supabase.
21. **Project-first synthesis flow** — synthesis always requires a `?project=<id>` context. Visiting `/?upload=1` without a project falls through to the workspace hub. The standalone "New synthesis" entry point has been removed. Flow: Projects → pick or create project → New synthesis (per-project row action).
22. **Projects page synthesis list** — each project card loads syntheses via `GET /projects?include_syntheses=true` (single request) and displays them as clickable date-labeled rows linking to `/syntheses/{id}`. A one-liner at the bottom of each card directs users to Private saves for encrypted reports.
23. **Project auto-naming removed** — `/synthesize` now returns 400 if `project_id` is missing when the DB is available, instead of auto-creating a project named `"Synthesis {filename}"`. This was the root cause of some projects showing synthesis filenames as their names.
24. **PBKDF2 iterations at 600K** — NIST SP 800-132 (2023) minimum for SHA-256. Old saves decrypt correctly because each record stores its own `iterations` value; new saves get 600K. The password that protects research data is never stored anywhere.
25. **N+1 projects/syntheses fetch eliminated** — `GET /projects?include_syntheses=true` returns all projects with their syntheses in one round trip. The backend loops the same `get_syntheses_for_project` calls; no new query.
26. **Job pruning on every `GET /jobs/{id}` poll** — `_prune_jobs()` runs on each poll, not only when a new synthesis is submitted. Prevents stale jobs accumulating in memory between synthesis sessions.
27. **CORS locked to explicit headers** — `allow_headers` is `["Authorization", "Content-Type"]` (not `"*"`); `allow_methods` includes `DELETE` for the Notion disconnect route.
28. **FastAPI docs disabled in production** — `/docs`, `/redoc`, `/openapi.json` are `None` when `APP_ENV=production` or `RAILWAY_ENVIRONMENT=production`. Available in dev.
29. **Auth error internals hidden from clients** — pipeline crash exceptions are logged server-side (`logging.getLogger("gist").exception(...)`) and return a generic `"An unexpected error occurred"` message to the polling client. Auth module exceptions return `"Authentication failed"` without the httpx/jwt error string.
30. **Auth callback `next` param restricted to relative paths** — `next` must match `/[^/].*` or be `/` exactly; `//evil.com` or absolute URLs are silently replaced with `/`.
31. **Design system rules enforced by audit** — cards use border only (no `shadow-soft`); navbar uses border-bottom only (no `shadow-sm`); single neutral scale (`neutral-*`) throughout — `zinc-*` removed; palette max: neutral + brand-teal + red/green/amber semantic; no blue accent; `fadeIn` includes `translateY(4px→0)` for proper entrance feel.
32. **Synthesis list in projects comes from `encrypted_artifacts`, not `syntheses`** — `STORE_PLAINTEXT_SYNTHESES=false` in production, so the backend `syntheses` table is always empty. The projects page fetches `encrypted_artifacts` filtered by `project_id` directly from Supabase on the frontend. This is the only way to show synthesis history without storing plaintext output.
33. **Project descriptions editable in-line** — `PATCH /projects/{id}` endpoint; `update_project()` in db.py. Requires `projects.description text` column (migration `002_add_project_description.sql`). The frontend patches optimistically and updates local state on success.
34. **`.project-tabs` vs `.workspace-tabs`** — two separate CSS classes. `.workspace-tabs` is for page-level tab bars (border-y, `span` elements, light active state). `.project-tabs` is for inner card tab navs (no borders, `button` elements, dark pill active state — `bg-brand-950 text-white`). Never mix them.
35. **`SignedInHome` is a standalone component with its own fetch** — it fetches recent encrypted_artifacts from Supabase directly (no backend call needed). Kept separate from the `Home` function to avoid passing props through the conditional render tree.
36. **Dark mode architecture: `darkMode: "class"` + Turbopack gotcha** — With `darkMode: "class"` in Tailwind + Next.js 16 Turbopack, `bg-white` (and opacity variants like `bg-white/90`) in `@apply` inside `@layer components` causes a circular dependency build error. `dark:*` variants in `@apply` also fail. Fix: replace every `bg-white` in `@apply` with raw `background-color: white;`; replace every `dark:*` in `@apply` with a separate `.dark .classname { }` rule placed OUTSIDE all `@layer` blocks. Unlayered CSS has higher cascade priority than all layered utilities, so `.dark` overrides placed outside layers beat Tailwind classes without `!important`. Never use Tailwind utility class names (`.bg-white`, `.text-neutral-*`) as CSS selectors inside `@layer base`.
37. **`ThemeProvider` pattern** — `components/ThemeProvider.tsx` is a `"use client"` context component that wraps all body content in `layout.tsx`. It reads from `localStorage` on mount and listens for system preference changes. Anti-flash inline `<script>` in `<head>` applies the `dark` class synchronously before React hydrates. `suppressHydrationWarning` on `<html>` prevents server/client mismatch. Theme persisted as `"light" | "dark" | "system"` under key `"gist-theme"`.
38. **`.trust-chip` design system class** — small bordered chip for trust signal labels (e.g., "Browser-encrypted saves"). Used in the landing page hero below the CTA buttons, competitor-inspired (Looppanel SOC2/security badge pattern). Defined in `globals.css`.

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
- Browser-side AES-GCM-256 encrypted private saves; PBKDF2-SHA256 at 600K iterations; password never leaves the device.
- Notion OAuth uses single-use CSRF nonces (`oauth_states` table).
- Notion access tokens encrypted at rest with Fernet when `NOTION_TOKEN_ENCRYPTION_KEY` is set. Key is documented in `.env.example`.
- CORS restricted to configured origins; explicit `allow_headers` list.
- HSTS (`max-age=63072000; includeSubDomains`) added in production.
- FastAPI docs disabled in production (`/docs`, `/redoc`, `/openapi.json` return 404).
- Exception internals never reach clients — logged server-side only.
- Auth callback `next` param validated to relative paths only.
- Frontend CSP set in `next.config.mjs` (includes `'unsafe-inline'` — nonce-based tightening is a future item).

**Trust gaps remaining:**

- No public `/security` or `/privacy` page.
- No deletion/retention controls for projects, syntheses, or encrypted artifacts.
- No event logging wired (analytics `events` table exists but no writes yet).
- Audio/video sent to Groq or OpenAI for transcription (third-party data processor).
- Transcript text and themes sent to Anthropic (third-party data processor).
- In-memory job store resets on backend restart (jobs lost).
- `NOTION_TOKEN_ENCRYPTION_KEY` not yet set in Railway production — Notion tokens stored plaintext until set. Reconnect required after setting the key.
- `requirements.txt` dependency versions unpinned — no CVE scanning in CI.
- No test suite or CI/CD pipeline.

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
5d078db  design: spacing, typography, and shadow polish pass
1ef90dd  ux: add minimum 6-character rule to password requirements
9b39c03  ux: add number rule to password requirements
c483194  ux: interactive password UI on private save — checklist, strength bar, match indicator, show/hide
f2dd946  security: harden auth, headers, CORS, encryption, and error handling
80a9341  docs: update PROMPT.md to reflect 2026-05-28 security audit session
f45dd82  design: full audit — remove border+shadow double, unify to neutral scale, fix accent discipline
2185efd  design: remove all subsection borders site-wide
8a36ae1  design: clarify workspace and logout flow
e902cbd  design: refine ui spacing and interactions
e8fd715  deploy: disable mise python attestations
ea8c92a  design: strengthen navigation cards and footer
e04658e  design: refine navbar footer and palette
bc35d2a  design: replace orbit with product demo frame and refine UI polish
58319b8  design: remove citation dot '7' from product demo card
db99a3c  feat: project descriptions, synthesis linking, workspace cleanup
604a86d  design: project card tabs as mini-navbar pills, no borders
4f466ee  design: remove Next best step panel from workspace header
794f4ed  docs: update CLAUDE.md and PROMPT.md to reflect current state  ← HEAD (dark mode commit pending)
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
35. **Full OWASP security audit + 10 fixes** — ran `/vibe-app-security-audit`. Findings across all 5 audit steps. Fixed in commit `f2dd946`: exception internals hidden from clients (logged server-side), NOTION_TOKEN_ENCRYPTION_KEY documented in .env.example with gen command, FastAPI docs disabled in prod, HSTS added to backend, CORS allow_headers tightened + DELETE added, auth callback `next` param validated to relative paths, PBKDF2 raised to 600K iterations (NIST 2023), Notion OAuth cancel redirects to frontend UI, N+1 projects/syntheses fetch replaced with single `GET /projects?include_syntheses=true`, job pruning on every poll, reflected URL `message` param removed from login page. Remaining: pin requirements.txt, add CI/CD + CVE scanning, nonce-based CSP, test suite.
36. **PROMPT.md updated** post-security-audit (`80a9341`).
37. **Full design audit** — ran `/ui-design-prompts` → option 1 (AUDIT). 6 fixes in commit `f45dd82`: removed border+shadow double from `.card` and navbar (border only now); unified all `zinc-*` → `neutral-*` across 11 files; standardized synthesis detail header to `mb-8`; replaced blue "Extracting" badge with brand teal (eliminates 5th accent); added `translateY(4px→0)` to `fadeIn` keyframe; fixed `<p>` as flex container in Notion push banner.
38. **Remove all subsection borders** — stripped all card/panel/section borders from every page. `.card` border removed in `globals.css` (cascades site-wide); section dividers (`border-t`), info panels, file list items, and all colored alert borders (red/green/amber) removed per-file. Dashed drag-and-drop zones and form input/button borders preserved. Committed `2185efd`.
39. **Visual motion refresh** — current uncommitted session. Bhavana asked to make the website more user-friendly and visually richer, focusing on animation, scrolling, transitions, card layouts, text movement, 3D motion, stronger color, and a better font tone. Changes made in the frontend only: system font stack moved from Inter/Google font dependency to Aptos/Segoe UI Variable style; `globals.css` gained warmer backgrounds, card shadows, 3D hover transforms, animated stage rails, rise-in transitions, reduced-motion handling, and reusable `surface-panel` / `flow-step` / motion classes; landing page gained a first-viewport sample synthesis visual and card-based value sections; workspace, upload, projects, private saves, and synthesis detail pages gained more tactile cards and animated surfaces. Verification: `npx tsc --noEmit` and `npm run build` pass.
40. **Tasteful 3D inspiration pass** — current uncommitted session. Bhavana referenced `https://www.trymindhub.com/about` and asked to extract/duplicate the most valuable tasteful 3D animation features. The adapted takeaways were: circular kinetic text around a center mark, a slow horizontal text rail, and layered floating cards with subtle perspective movement. Implemented as Gist-specific landing hero motion: `ResearchOrbit`, `kinetic-marquee`, `research-orbit`, `depth-scene`, `depth-stack`, and `float-card`; no MindHub branding, assets, or copy were reused. Verification: `npx tsc --noEmit` and `npm run build` pass.
41. **Workspace clarity + ambient 3D** — current uncommitted session. Bhavana asked for more 3D animation ideas, better use of empty side space, a centered footer, clearer signed-in purpose, tighter landing copy, and logout latency investigation. Changes made: `page-wide` widened to `max-w-6xl`; added `ambient-3d-field` side shapes for decorative 3D motion on wide screens; added centered readable footer in `layout.tsx`; signed-in workspace now leads with "Turn customer interviews into decisions you can trust" plus a "Next best step" panel; landing audience copy is larger and simpler; removed "Not designed for..." wording and replaced the em dash in hero description; added a client `LogoutButton` with pending text; `/logout` now redirects relative to `request.url` instead of hardcoded localhost and uses local sign-out scope. Verification: `npx tsc --noEmit` and `npm run build` pass. Build still warns if untracked `gist/package-lock.json` exists alongside `gist/frontend/package-lock.json`.
42. **UI spacing + micro-interactions** — current uncommitted session. Bhavana asked to review the whole frontend, remove excess whitespace, judge where icons/images are valuable, add visual/2D/3D motion to other tabs, and add micro-interactions. Changes made: reduced `.page` / `.page-wide` vertical padding and section spacing; added nav glyphs for Home/Projects/Private saves/Settings; added state visuals for Projects/Private saves/Settings; updated `.btn-primary` hover to scale and color-shift to brand teal; added default `cardLoad` animation for `.card`; added `fade-panel` for empty/data-loaded transitions on Projects, Private saves, upload file list, and synthesis action bar; tightened Projects, Private saves, Settings, Synthesis detail, workspace, landing, and footer spacing. Verification: `npx tsc --noEmit` and `npm run build` pass. Build warning remains tied to untracked `gist/package-lock.json`.
43. **Railway Python build fix** — Railway backend build failed during `mise install` for `python@3.11.9` with `No GitHub artifact attestations found` under `mise 2026.6.0`. Added `gist/backend/mise.toml` with `[settings] python.github_attestations = false`.
44. **Design iteration (Codex session)** — replaced ResearchOrbit with ProductDemo (mock browser frame showing a synthesis result); tightened card shadows, body gradient, and hover states; added product-frame CSS classes. Citation dot "7" removed from demo card.
45. **Project descriptions + synthesis linking + workspace cleanup** — full feature session. See build phases table for full list. Key decisions: syntheses shown under projects come from `encrypted_artifacts` (frontend Supabase query), not the backend `syntheses` table; project description stored in `projects.description` (migration required); synthesis title auto-populates from first uploaded file's stem; `.project-tabs` is a new CSS class separate from `.workspace-tabs` (dark pill active, no borders).
46. **Docs update** — updated CLAUDE.md (stack, full repo layout, backend routes table, design system class reference) and PROMPT.md (this file) to reflect all changes since session 43.
47. **Dark mode + competitor design pass** — full dark mode system: `ThemeProvider` client component (localStorage + system preference, `"light"|"dark"|"system"`), anti-flash inline script in `<head>`, `suppressHydrationWarning` on `<html>`, `darkMode: "class"` in Tailwind config. Comprehensive dark CSS vars in `globals.css` (all 16 bg-white @apply replaced with raw CSS, all dark: @apply moved to `.dark .class {}` rules outside @layers). Settings page: new Appearance section with Light/Dark/System 3-column pill toggle. Homepage: removed kinetic-marquee scroll animation, removed both eyebrows ("Private-by-default interview synthesis" and "What it does"), tightened hero + features section spacing, added trust signal chip row (Browser-encrypted saves / Verbatim quote verification / No transcript storage / Audio supported), sharpened feature card copy (Dovetail/Looppanel-inspired). `SECURITY_TRUST_PLAN.md` + `E2EE_STORAGE_PLAN.md` added to `.gitignore`. Critical Turbopack gotcha: `bg-white` in @apply inside `@layer components` causes circular dependency when `darkMode: "class"` is active — see architecture decision note below.
48. **Design refinement: icons, security page, shimmer titles, dark mode polish** — Commits `43539a9` → `06e3ec4` (6 commits total). Hero "traced" → "linked". SVG inline icons added to trust chips (lock, checkmark, shield-dash, mic; 16×16 `stroke="currentColor"`) and feature cards (shield+check, padlock, microphone, external-link; 24×24). `/security` static page: data-flow disclosure with `CheckIcon`, `LockIcon`, `ShieldIcon`, `AlertIcon` components and `Row` layout. `Features` (→ `/#features`) and `Security` (→ `/security`) links added to navbar for signed-out users (`hidden sm:inline-flex`). `.page-title` CSS class: light mode shimmer `#0a0a0a→#0f766e→#0a0a0a` at 6 s, dark mode `#e5e5e5→#5eead4→#e5e5e5` at 3 s; `@keyframes text-shimmer` sweeps `background-position`. Critical CSS bug found and fixed: `.dark .page-title { background: linear-gradient(...) }` shorthand resets `background-clip` to `border-box`, making the gradient render as a filled rectangle behind text — fix is to always re-declare `-webkit-background-clip: text; background-clip: text` in the same rule. Light mode shimmer updated to teal accent (was gray, too subtle). `.page-title` applied to every page h1 (home, projects, private saves, settings, security, login, signup, forgot/reset password, synthesis detail). Eyebrow removals: Browser-encrypted storage (private saves), Research rounds (projects), Research project (project cards), Workspace (signed-in home), Trust & Privacy (security page). Files/Progress/Report tab bar removed from upload UI entirely. Default active tab changed from `"syntheses"` to `"overview"`. Synthesis list dates bumped to `text-sm font-medium dark:text-neutral-300`. `.dark .btn-primary` brightened: teal-600 base → teal-500 hover + box-shadow. `.dark .text-gradient` (hero accent span): bright teal shimmer `#2dd4bf→#5eead4→#a7f3d0`. "For founders…" text: `dark:text-neutral-200`. `.dark .trust-chip` color raised to `rgb(196 196 196)`, border opacity `0.2`. Security page section text: `dark:text-neutral-300`. Drag-drop upload zone and file list items: explicit dark bg + text classes. White background bar removed from private saves sidebar, projects form, and settings (caused by `bg-white` leaking through).

---

## 12. Open / next steps

- **(A) Pending migration — run now**
  - **`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text;`** — required for project description save/edit to work. File: `backend/migrations/002_add_project_description.sql`. Run in Supabase SQL Editor, then `NOTIFY pgrst, 'reload schema';`.
- **(B) Security/trust hardening — remaining items**
  - **Generate `NOTION_TOKEN_ENCRYPTION_KEY`, set in Railway, reconnect Notion** — until this is done, Notion OAuth tokens sit in plaintext in Supabase
  - **Pin `requirements.txt` versions** — use `pip freeze` or `uv lock`; prevents silent CVE regressions on every Railway deploy
  - **Add GitHub Actions CI** — lint, `pip-audit`, `npm audit --audit-level=high`, build check; skeleton is in the audit report
  - **Add security test suite** — auth/401 checks, job ownership isolation, file-type validation; skeleton is in the audit report
  - **Nonce-based CSP** — remove `'unsafe-inline'` from `script-src` via Next.js middleware nonce injection
  - Add visible beta warning near upload for confidential/regulated data
  - Add delete controls for projects, syntheses, encrypted artifacts, and Notion connection
  - Add event logging for synthesis/private-save/notion/copy actions
  - Consider Postgres-backed job store for restart durability
- **(C) Custom domain** — buy `gist.tld`, point at Vercel via DNS.
- **(D) Phase 4 real users** — recruit first 5-10 users manually with redacted/synthetic transcripts. Lead with "private-by-default synthesis with traceable quotes."
- **(E) Watch for real-user feedback, iterate**
- **(F) Backlog**
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

## Latest UI/UX sessions

44. **TryClean-inspired density and footer pass** — larger nav/buttons, tighter spacing, bolder color, richer card motion, full-width dark CTA footer.
45. **Granola-inspired navigation and palette refinement** — compact borderless header, footer restricted to signed-out landing, brand green unified throughout, prefetch disabled on protected-page preview links.
46. **Research workflow design synthesis** — detailed study of Looppanel, Dovetail, and Grain (documented in `DESIGN_RESEARCH_REPORT.md`). Landing visual replaced with ProductDemo (realistic mock browser frame); synthesis detail rebuilt as split document + dark evidence rail; private saves as master-detail repository.
47. **Project descriptions + synthesis linking + workspace UX cleanup** — see session log entry 45 above and build phases table for full detail. Key user-visible changes: project description field (editable in Overview tab), synthesis names shown under each project, Private Saves X close button, workspace hub simplified (Recent syntheses list replaces How it works + Private saves card + Next best step panel). Requires running `002_add_project_description.sql` in Supabase.
48. **Dark mode + competitor design pass** — see session log entry 47 above. Key implementation notes: `ThemeProvider` in `components/ThemeProvider.tsx`; dark rules go OUTSIDE all `@layer` blocks (higher cascade priority than utilities, no `!important` needed); ProductDemo mockup protected with `background-color: #ffffff !important` so demo always renders as light UI. New design system class: `.trust-chip`.
49. **Design refinement: icons, security page, shimmer, dark mode polish** — see session log entry 48 above. Key CSS gotcha: `background` shorthand always resets `background-clip` — re-declare `-webkit-background-clip: text; background-clip: text` after every `background:` line that feeds a gradient-text effect. `.page-title` is now the universal shimmer title class applied to all h1 elements site-wide. New page: `/security`. New nav links: Features + Security (signed-out only). All eyebrows removed except those on the synthesis detail report header.

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
