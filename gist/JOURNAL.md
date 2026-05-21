# Journal

## Hardening Pass — 2026-05-01

The Phase 2 + Phase 3 commits earlier this week were "feature-complete on
paper." Today was the first end-to-end run on a real Supabase project +
real Notion workspace, and the tour through every place the design met
reality was instructive. Eight bugs, all in the seams between systems.

### What I shipped
- **OAuth CSRF fix.** The original `/notion/auth` passed `user_id` as the
  OAuth `state` parameter and `/notion/callback` blindly accepted state
  as authoritative. Anyone who knew or guessed a user_id could complete
  OAuth on that user's behalf. Replaced with a server-issued 32-byte
  nonce stored in a new `oauth_states` table (10-min TTL, single-use,
  deleted on consume regardless of validity). Opportunistic purge inside
  `/notion/auth` keeps the table small without a cron.
- **Block + rich_text limits.** Notion caps `children` at 100 blocks
  per page-creation request and rich_text content at 2000 chars per
  text object. `create_page` now sends the first 100 blocks with the
  POST and appends the rest via `PATCH /blocks/{id}/children`.
  `_rich_text` slices long strings at the last word boundary under
  2000 chars across multiple text objects (renders identically).
- **429 backoff.** Wrapped every Notion HTTP call in
  `_request_with_backoff` that honors `Retry-After`, retries 5xx with
  capped exponential backoff + jitter, fast-fails 4xx so the 401/404
  mapping still fires.
- **Notion internal-token fallback.** Notion now requires a marketplace
  profile to flip an integration to Public. For solo dev that's
  prohibitive, so when `NOTION_INTERNAL_TOKEN` is set instead of the
  OAuth pair, `/notion/auth` validates via `/users/me`, saves a
  connection inline, and short-circuits the consent redirect. Frontend
  Settings branches on `mode: oauth | internal` from the response shape.
- **JWT alg detection + JWKS path correction.** Phase 2 hard-coded
  RS256 + the wrong JWKS path. New flow inspects the unverified token
  header and routes:
    - HS256 → `SUPABASE_JWT_SECRET` (legacy projects)
    - RS256/ES256 → JWKS at `/auth/v1/.well-known/jwks.json` (projects
      migrated to Supabase's new JWT Signing Keys)
  PyJWKSet doesn't have `find_by_key_id` in this version — it's
  `__getitem__`.
- **Supabase HTTP/2 stale-connection retry.** Got
  `httpx.RemoteProtocolError ConnectionTerminated error_code:1` on the
  first request after Supabase silently closed an idle stream. Wrapped
  every public function in `db.py` with a single-retry decorator that
  drops the cached client and reconnects on `RemoteProtocolError`,
  `ConnectError`, or `ReadError`.
- **Cheap connection-status endpoint.** Replaced `Settings` and
  `/syntheses/[id]` connection probes that were calling the heavy
  `/notion/databases` endpoint just to check `res.ok`. New
  `GET /notion/connection` returns `{connected, workspace_name?}` from
  one DB read — no Notion API call. Saved a Notion request per page
  load.
- **Landing-page → projects wiring.** The home page synthesis flow was
  orphaned from the projects dashboard: results rendered inline and
  were lost on reload. `/?project=<uuid>` now persists the synthesis
  via `project_id` on the form, and the page redirects to
  `/syntheses/<id>` on done so the Notion push UI is reachable.
- **Missing imports + alert() cleanup.** `list_projects` was calling
  `get_projects` without importing it (NameError 500). Settings page
  used `alert()` for OAuth init failures inconsistent with the existing
  red-banner pattern; now matches.

### Key decisions (and why)
- **Hoist participant-id dedupe to a first pass.** The original loop
  validated uniqueness *after* reading bytes for each file, which meant
  duplicate-label errors fired in 30+ seconds (after the previous file's
  Whisper/Haiku call completed) instead of milliseconds. Pre-resolving
  all `(filename, label) → participant_id` up front fails fast on bad
  input and matches the rest of the validation contract.
- **Strip `emailRedirectTo` from signup when Confirm Email is off.**
  Even with email confirmation disabled, Supabase still validates the
  `emailRedirectTo` URL against its Site URL + Redirect URLs allowlist.
  When the allowlist isn't configured, signup fails with the misleading
  "Invalid path specified in request URL". For solo/local dev where
  email confirmation is off, dropping the option entirely is cleaner
  than fighting allowlist propagation.
- **Strip `/rest/v1/` from copy-pasted Supabase URLs.** The dashboard
  shows the URL with the REST path on some pages; the JS client
  appends its own paths internally. The right env value is just the
  bare project URL.
- **One-line decorator over manual try/except in every helper.**
  Adding `@_with_db_retry` to 15 functions via a small Python script
  keeps the helpers readable. The decorator pattern also gives a single
  place to extend (e.g. logging which call retried, jittered backoff)
  without touching each function.

### What surprised me
- **Browser "CORS error" is a junk signal.** Most of the day's "CORS:
  No 'Access-Control-Allow-Origin' header" messages were not CORS
  issues — they were unhandled backend exceptions whose responses
  bypassed Starlette's exception middleware before CORS headers were
  added. The actual fixes were always in the route handler, never in
  CORS config. Backend log was the ground truth every time.
- **Notion "Public" is gated behind a marketplace profile now.** The
  BUILD_PLAN assumed flipping a toggle from Internal to Public was a
  10-minute task. As of mid-2026 it requires a published profile with
  description, logo, support URL, privacy/TOS URLs. For a solo founder
  testing locally, the internal-token fallback is the right escape
  hatch.
- **Supabase ships JWKS at `/auth/v1/.well-known/jwks.json`, not the
  root `/.well-known`.** Cost a few minutes of "the JWKS endpoint is
  404ing." Rare for an OIDC server to put JWKS under a sub-path.
- **PostgREST schema cache is on a delay.** Created a table via SQL,
  then immediately got "Could not find the table 'public.X' in the
  schema cache" from PostgREST. The fix is `NOTIFY pgrst, 'reload
  schema';` in the same SQL Editor session — table-create alone doesn't
  invalidate the cache.
- **Eight discrete bugs, zero of them in the synthesis logic.** The
  extraction → clustering → insights → markdown pipeline that's been
  the core of this project has worked unchanged since Day 2. Every
  bug today was in plumbing — auth, DB, OAuth, integration. The
  expensive-to-build interesting code is also the most stable. The
  cheap-to-build glue is where errors compound.



### What I shipped
- FastAPI endpoint `POST /synthesize` accepting multiple `.txt` files, returning markdown.
- `GET /health` for Railway deploy checks.
- Thinnest viable Next.js frontend: drag-and-drop multi-file upload, "Synthesize" button,
  loading state, rendered markdown via `react-markdown`.
- Railway deployment config (`Procfile`, `runtime.txt`) and CORS wired for Vercel.
- `README.md` covering architecture, run-locally, and deploy notes.
- Tagged `v0.1.0`.

### Key decisions (and why)
- **Single-file upload endpoint to start.** It's simpler than streaming multipart in chunks.
  Could parallelize later if latency matters.
- **Frontend as a thin shell over the API.** All the LLM logic lives in Python where tool-use
  is native. React just renders what the backend returns.
- **Railway over Render.** Railway's free tier was enough for a single FastAPI worker at this
  stage, and the GitHub auto-deploy hook meant every `git push` updated the live URL
  within ~60 seconds.

### What surprised me
- CORS preflight on Railway took three tries to get right. `allow_origins=["*"]` with
  credentials doesn't work in modern browsers; had to explicitly list the Vercel domain.
- `react-markdown` bundles are larger than expected (~120 KB gzipped). Acceptable for now,
  but worth splitting if we add a dashboard later.
- A stranger could actually use the tool end-to-end within 3 days. The 3-day v0 sprint
  really does work if you constrain scope aggressively.

## Day 4 — 2026-04-23

### What I shipped
- `backend/transcribe/whisper.py` — audio ingestion pipeline supporting two backends:
  Groq (`whisper-large-v3`, free tier) and OpenAI (`whisper-1`, paid fallback).
- Updated `POST /synthesize` to accept audio extensions (`.mp3`, `.wav`, `.m4a`, `.mp4`),
  transcribe first, then run the existing text pipeline.
- Frontend updated to accept audio files alongside `.txt` transcripts.
- Tested on a 5-minute mock interview MP3; transcription quality was high enough to
  extract meaningful themes.

### Key decisions (and why)
- **Groq as primary provider.** It's free, faster, and uses `whisper-large-v3` which beats
  OpenAI's `whisper-1` on accuracy. Fallback to OpenAI means the pipeline still works if
  Groq hits rate limits.
- **OpenAI-compatible SDK for both.** Using `openai` package with `base_url` swap means
  one code path for both providers — no branching logic beyond the initial key check.
- **Return transcript alongside synthesis.** Users want to see (and sometimes edit) the raw
  transcript before trusting the synthesis. Will expose this in UI in Day 6.

### What surprised me
- Groq's free tier is genuinely fast — a 5-minute file transcribed in ~2 seconds.
- Audio quality matters enormously. A low-bitrate recording had a 3% word-error rate jump
  vs a clean WAV. Need to warn users about this in the UI eventually.
- The existing extraction prompt worked unchanged on transcript text derived from audio.
  No prompt retuning needed.

## Day 5 — 2026-04-27

### What I shipped
- `backend/transcribe/whisper.py`: `ffmpeg -c copy` chunking for files larger than the
  Whisper API's 25 MB cap. Splits at fixed-duration boundaries, transcribes each chunk
  sequentially, joins with spaces. Supports files up to 200 MB.
- File type and size validation in `POST /synthesize` (backend rejects unsupported formats
  and oversized files with clear 4xx messages).
- **Per-file participant labels** in both frontend and backend. User can type
  "P1 — Alice, consultant" for each file; blank labels fall back to filename stem.
- **Async job system**: `POST /synthesize` returns 202 + `job_id`; frontend polls
  `GET /jobs/{job_id}` every 2 seconds. Job progress shows exact stage
  (queued → transcribing → extracting → clustering → insights → done/error).
- In-memory job store (`JOBS` dict) — sufficient for v0; Phase 2 will replace with Postgres.

### Key decisions (and why)
- **Skip automated speaker diarization for v1.** Whisper doesn't label speakers natively,
  and `pyannote.audio` is heavy. Manual participant labels are a pragmatic UX compromise
  that ships today instead of blocking on a hard ML problem.
- **Stream-copy chunking (`-c copy`) instead of re-encoding.** Keeps chunking fast and
  lossless. Used `imageio-ffmpeg` to ship a static ffmpeg binary so users don't need a
  system install.
- **Synchronous validation on POST, async work in background tasks.** This lets us return
  immediate 400s for bad inputs (wrong format, too large, duplicate IDs) while still
  running the long transcription pipeline off the request thread.
- **Backend-wide duplicate participant-ID guard.** Two files resolving to the same label
  or stem is a data-loss risk for clustering. We validate uniqueness up front.

### What surprised me
- ffmpeg stream-copy chunking is near-instant on a 45-minute MP3 (~3 seconds for 4 chunks).
  `_audio_duration_seconds` probes duration by parsing ffmpeg stderr with regex; it's
  hacky but avoids a ffprobe dependency.
- The frontend stage tracker (transcribing → extracting → clustering → insights) made
  a 90-second wait feel acceptable. Visible progress is a genuine UX requirement, not
  polish.
- BackgroundTasks in FastAPI runs in-process. If the server restarts, in-flight jobs die.
  Documented this explicitly for Phase 2 (move to Postgres queue or Redis).
- `pydub` was listed in BUILD_PLAN and `requirements.txt` but never used — `ffmpeg`
  subprocess is simpler and more predictable for fixed-duration slicing. Removed the
  unused dependency.

## Day 6 — 2026-04-27

### What I shipped
- **Backend per-file progress tracking**: `file_progress` array on every job, with statuses
  `pending | transcribing | extracting | extracted | error`. Pipeline updates each file's
  status as it moves through transcription and extraction.
- **Frontend drag-and-drop zone**: visual border change on drag-over, drop handler, plus
  a hidden file-input "Browse files" button for accessibility.
- **Per-file status badges** in the file list during processing: Pending → Transcribing…
  → Extracting… → Done. Uses color-coded badges (amber/blue/green).
- **Remove file button**: each file can be deleted from the queue before submitting.
- **Estimated time messaging**: based on total audio size (~1 MB ≈ 1 min at 128 kbps,
  transcription ~1 min wall-clock per 5 min of audio). Shows before submission so users
  know what to expect.
- **End-to-end test**: ran `POST /synthesize` with P1.txt + P2.txt through the full
  pipeline. Verified file_progress tracked both files (extracted) and final result
  rendered 19 clusters, 26 themes, 2 dropped, full markdown synthesis.
- **TypeScript passes**: `npx tsc --noEmit` is clean.
- Tagged `v0.2.0`.

### Key decisions (and why)
- **Keep in-memory `JOBS` dict, just enrich it.** Phase 2 will swap in Postgres; for now
  the file_progress array is enough to debug per-file failures and give users granular
  feedback. Tried not to over-engineer.
- **Pure-dict storage for file_progress, with Pydantic model fallback.** Initially stored
  `FileProgress()` Pydantic objects directly in the job dict, but `JobStatusResponse`
  validation on GET routes could convert them back to model instances. The `_set_file_status`
  helper now handles both dicts and model instances so the pipeline doesn't crash regardless
  of which route touched the job first.
- **Estimated time from file size, not duration metadata.** We don't have audio duration
  on the client without parsing headers, so we use the bitrate heuristic. It's imprecise
  but directionally correct and better than no estimate at all.
- **Remove individual files rather than clear-all.** Early iterations considered a
  "Clear all" button, but per-file removal is more useful: users often drop 5 files
  and then realize one is wrong.

### What surprised me
- The `_set_file_status` bug took 3 iterations to fix. The root cause was mixing Pydantic
  model instantiation with raw dict storage in the same mutable object. FastAPI's
  `response_model` doesn't mutate the return value, but reading the same job dict back
  through Pydantic in tests or Swagger docs *can* create model instances in memory,
  which then break dict-indexing code. The real lesson: if a store is meant to be raw
  dicts, never instantiate Pydantic models into it.
- End-to-end latency for 2 text transcripts was ~50 seconds (extraction dominates).
  This is acceptable but means audio-heavy jobs will need the progress UI to feel fast.
- Drag-and-drop actually feels better than the native file input. The visual feedback
  (border darkening) makes the affordance obvious. Worth the extra 20 lines of event
  handler code.

## Phase 2 — Auth + DB + Dashboard (Days 7–13, 2026-04-27)

### What I shipped
- **Supabase auth scaffold**: `@supabase/supabase-js` + `@supabase/ssr` installed.
  `client.ts` and `server.ts` per official Next.js 14 App Router pattern.
  `middleware.ts` refreshes sessions on every request.
- **Login / signup pages** (`/login`, `/signup`): email + password forms with
  validation, error states, and links between them. Signup sends confirmation email.
- **Auth callback route** (`/auth/callback`): exchanges OAuth/code for session.
- **Logout** (`/logout`): server-side POST route calling `signOut()`.
- **Layout navbar**: shows user email and log-out when authenticated; shows
  "Log in / Sign up" when not. Uses server-component `Navbar` with
  `supabase.auth.getUser()`.
- **Backend JWT verification** (`auth/supabase_client.py`): fetches JWKS from
  Supabase, caches it for 5 min, verifies RS256 signatures, issuer, and audience.
  `require_auth` dependency extracts `sub` (user UUID) from the token.
- **`POST /synthesize` gated behind auth**: returns 401 for missing/invalid tokens.
  Frontend now sends `Authorization: Bearer <token>` on all API calls.
- **DB schema** (`schema.sql`): `projects`, `transcripts`, `syntheses`,
  `notion_connections` tables with RLS policies. Run in Supabase SQL Editor.
- **DB helpers** (`db.py`): `create_project`, `get_projects`, `save_transcript`,
  `save_synthesis`, etc. Uses service-role key; defensively checks `db_available()`.
- **Wired persistence into pipeline**: auto-creates a project if none provided,
  saves transcripts after extraction, saves synthesis after render. Non-blocking:
  pipeline continues even if DB write fails.
- **Projects API**: `GET /projects`, `POST /projects`, `GET /projects/{id}`,
  `GET /syntheses/{id}` — all protected by `require_auth`.
- **Frontend dashboard**:
  - `/projects`: list projects, create new project inline, "New synthesis" CTA.
  - `/projects/[id]`: project detail with synthesis history, breadcrumbs.
  - `/syntheses/[id]`: rendered markdown with copy-to-clipboard, transcript count.

### Key decisions (and why)
- **Service-role key on backend, RLS on tables.** The backend bypasses RLS with
  the service-role key and enforces ownership in Python (via `get_project(user_id, id)`).
  This is simpler than parsing the JWT in every SQL query and matches how the
  Supabase Python client is typically used in API backends.
- **Lazy DB initialization.** `db.py` does not raise on import if env vars are missing;
  it raises on first use. This keeps the app bootable locally without Supabase set up
  yet, which matters during the transition window between coding and console setup.
- **Conditional DB persistence in pipeline.** Rather than failing the entire synthesis
  if the DB is unreachable, we log and continue. The user still gets their markdown;
  losing the persisted copy is a degradation, not a failure.
- **Client components for dashboard pages.** Server components + `cookies()` + external
  API calls have too many edge cases in Next.js 14 (cookie concurrency, middleware
  timing). Client-side `useEffect` fetching with session tokens is predictable and
  debuggable. We still use a server component for the navbar since it's a simple
  auth-state read.

### What surprised me
- The Supabase `@supabase/ssr` package is newer than the old `auth-helpers-nextjs`
  and the docs are still catching up. The cookie-setting callbacks in `createServerClient`
  require try/catch in server components because `cookies().set()` throws when called
  outside a server action or route handler.
- JWT verification with JWKS in Python is surprisingly straightforward with
  `PyJWKSet` from `PyJWT`. The trickiest part was realizing Supabase's `kid` rotates
  occasionally, so caching JWKS for 5 minutes is a sweet spot between performance
  and correctness.
- Mixing Pydantic model instantiation with raw dicts in mutable state (again!):
  `JobStatusResponse(**job)` creates model instances, but `_run_pipeline` writes
  into the same nested structures as plain dicts. Keeping the response model
  flexible with `dict | model` accessors prevents crashes.

### Next up
- **Day 13 bug-bash**: session expiry during long synthesis, CORS preflight on
  authenticated requests, RLS policy edge cases, redirect-after-login preservation.
- **Deploy**: push backend to Railway with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  env vars; push frontend to Vercel with `NEXT_PUBLIC_SUPABASE_URL` +
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Test end-to-end with a real Supabase project.

## Phase 3 — Notion Integration + Ship (Days 14–17, 2026-04-27)

### What I shipped
- **Notion OAuth**: `GET /notion/auth` returns Notion OAuth URL; user clicks,
  Notion redirects to `GET /notion/callback`, backend exchanges code for token
  and saves to `notion_connections` table. Frontend `/settings` page shows
  connect/disconnect state.
- **Database picker**: `GET /notion/databases` lists user's Notion databases
  the integration has access to. Dropdown shown on synthesis detail page.
- **Markdown → Notion blocks** (`integrations/notion.py`): converts headings
  (H1/H2/H3), bullet lists, numbered lists, blockquotes, horizontal rules, and
  paragraphs into Notion block objects.
- **Push to Notion**: `POST /notion/push` creates a new page in the selected
  database with the synthesis content. Returns Notion page URL.
- **Error handling**: catches 401 (revoked token → prompt reconnect), 404
  (deleted database), and generic API errors with friendly messages.
- **Landing page**: logged-out homepage shows value prop, "Get started" / "Log in"
  CTAs, and a no-nonsense tagline. No fake logos or testimonials.
- **Settings navbar link** and `/settings` page with Notion integration status.
- Tagged `v1.0.0`.

### Key decisions (and why)
- **Redirect-based OAuth instead of popup.** Popups are blocked by many browsers.
  A full redirect to Notion and back to `/settings` is simpler and more reliable.
  The `state` param carries the user_id so the callback knows who to save the
  token for.
- **Strip inline markdown formatting rather than faithfully convert.** Notion's
  rich_text annotations require parsing bold/italic spans, which means a full
  markdown AST parser. For v1, stripping `**` and `*` is acceptable — the content
  is readable and the converter is ~100 lines instead of 500.
- **Push from `/syntheses/[id]` rather than `/projects/[id]`.** The user has
  already reviewed the markdown on the detail page; adding the push button there
  is the lowest-friction moment.
- **Store access_token plaintext in Postgres.** Notion tokens are long-lived
  (no expiry) but the BUILD_PLAN mentions "encrypt at rest if you want to be safe."
  Skipping encryption for v1 keeps the code simple; if users ask, we'll add
  `cryptography` Fernet encryption later.

### What surprised me
- Notion's OAuth flow requires a "Public integration" (not Internal) to get a
  `redirect_uri`. Internal integrations skip OAuth but can only access pages
  explicitly shared with them. Public integration is strictly better for a
  multi-user product.
- The Notion `search` API returns both pages and databases; filtering by
  `{"value":"database","property":"object"}` is required or the list is noisy.
- The `children` blocks array in `POST /pages` has a 100-block limit. Our typical
  synthesis is 20–40 blocks, so we're safe for now. For very long syntheses
  we'd need to paginate with `PATCH /blocks/{id}/children`.

## Day 1 — 2026-04-16

### What I shipped
- Repo scaffold (backend/, frontend/, CLAUDE.md, BUILD_PLAN.md, .gitignore)
- Single-transcript extraction pipeline in backend/synth/
  - extract.py: calls Claude Opus 4.7 with tool-use, gets structured themes
  - verify.py: string-match check that extracted quotes appear verbatim in transcript
  - prompts.py: extraction prompt as a constant
- CLI entry point: `python -m synth.extract <path>`
- Ran against P1.txt (synthetic 1,455-word founder/customer interview)
- 14 verified themes extracted, 0 dropped as unverified
- Baseline output saved to eval/results/ for regression comparison later

### Key decisions (and why)
- **Tool-use over JSON mode.** JSON mode + schema-in-prompt is more prone to the
  model ignoring the schema mid-generation. Tool-use forces structured output at
  the API level — fewer retries, more reliable. The tool definition itself becomes
  the schema contract.
- **Quote verification as a hard post-check, not a prompt instruction.**
  Telling the model "don't paraphrase" in the prompt is unreliable; LLMs
  paraphrase anyway. The verify_quote() step normalizes both strings
  (lowercase, punctuation stripped, whitespace collapsed) and checks substring
  containment. Any theme whose quote doesn't appear verbatim gets dropped.
  This is the trust layer — the entire product is useless if a researcher can't
  trust quotes are real.
- **Per-interview extraction before cross-interview clustering.** Tried to keep
  the two stages separate so each can be evaluated independently. Makes
  debugging easier: if a cluster is wrong, I can tell whether the extraction
  or the clustering is the culprit.

### What surprised me
- Verification caught 0 bad quotes on P1.txt, which I didn't expect. Maybe test
  transcript doesn't stress the prompt enough. Will know more on Day 2 with
  more transcripts.
- The model caught an implicit feature request that wasn't stated as one and
  correctly categorized it as feature_request even though the speaker framed
  it as a complaint. 
- Two of the fourteen themes were duplicates. This is
  expected behavior. The clustering step on Day 2 should merge them. 

## Day 2 — 2026-04-23

### What I shipped
- Cross-transcript clustering (cluster.py) with SHA1-keyed disk cache of
  the full cluster list
- Founder insights via tool-use (insights.py): strongest signal,
  contradicted assumption, biggest surprise — each a headline + paragraph,
  also cached by input hash
- Markdown formatter (format.py) rendering clusters + insights into a
  single report. End-to-end CLI: `python -m synth.format <folder> <out.md>`
- Ran end-to-end on P1/P2/P3 → 36 clusters, 3 insights, rendered synthesis

### Key decisions (and why)
- **Cache by SHA1 of input, not mtime.** Each run costs 2+ Sonnet calls.
  Hashing the themes/clusters input means the cache is correct regardless
  of file timestamps and invalidates naturally when upstream output changes.
- **Cache insights only when well-formed.** Tool-use schema turned out not
  to be a hard guarantee — occasionally the model returned bare strings
  instead of `{headline, explanation}` dicts. A shape check gates the
  cache write so a degraded run doesn't lock in forever; the formatter
  tolerates both shapes on the read side so the pipeline still completes.
- **`load_dotenv(override=True)`.** The shell had ANTHROPIC_API_KEY set
  to an empty string, and dotenv's default is to not overwrite existing
  env vars — silently ignoring the real key. Forcing override makes .env
  authoritative for project secrets.

### What surprised me
- Tool-use schema enforcement is a strong prior, not a hard contract.
  Had assumed structured output was guaranteed.
- Clustering produced 36 groups from 42 themes — only 3 are
  multi-participant. The "don't drop singletons" rule is being taken very
  literally. Worth revisiting in Day 2 Hour 3 if eval shows over-splitting.
- Hit a 422 "context reduction is suggested" from Sonnet at 8k max_tokens
  during an API capacity spike — a softer rate-limit signal I hadn't seen
  before, and one the SDK doesn't retry by default.

## Launch + Phase 4 Growth Memory - 2026-05-21

Deployment is complete for Gist, and launch posts are complete on LinkedIn,
X, and Substack. The next workstream is Phase 4: bring in real users, measure
activation, and learn from actual interview synthesis workflows.

Created `USER_GROWTH_PLAN.md` with:
- Target users and north-star activation metric.
- Where to check users and usage: Supabase, Vercel, Railway, GitHub, LinkedIn,
  X, and Substack.
- Supabase SQL queries for user counts, daily signups, activated users,
  syntheses, and Notion connection rate.
- A 30-day plan for founder-led outreach, community distribution, activation
  tuning, and repeat-use learning.
- Recommended next instrumentation: a lightweight product `events` table for
  signup, project, upload, synthesis, Notion, and copy events.

## Security + Trust Pivot - 2026-05-21

Bhavana correctly identified the main blocker for real users: founders, PMs,
and researchers will not upload company-sensitive `.mp4` or `.txt` interview
files to an unknown tool without clear security, privacy, retention, and data
handling controls.

What changed:
- Added `SECURITY_TRUST_PLAN.md` with the honest current posture, platform
  checklists for Supabase/Railway/Vercel, trust gaps, and hardening priorities.
- Updated `USER_GROWTH_PLAN.md` so early outreach asks for redacted,
  synthetic, or low-sensitivity transcripts until security is stronger.
- Updated `README.md` with an early-beta security note.
- Updated `PROMPT.md` as durable rebuild memory and added the rule that it must
  stay current whenever meaningful product, architecture, deployment, security,
  or growth changes are made.
- Tightened `GET /jobs/{job_id}` so job results require auth and are only
  returned to the user who owns the job.
- Added baseline security headers to the FastAPI backend and Next.js frontend.

Key strategic shift: before broad self-serve acquisition, Gist needs a public
security/privacy page, deletion and retention controls, and clearer disclosure
that audio may go to Groq/OpenAI and text-derived analysis may go to Anthropic.

## Raw Transcript Retention Disabled - 2026-05-21

Bhavana clarified the privacy bar: no one else should be able to see a user's
raw transcript, not even the developer/operator. The previous architecture
persisted raw transcript text in `transcripts.content`, which meant a Supabase
project owner or anyone with the service-role key could read it.

What changed:
- Added `STORE_TRANSCRIPTS=false` as the production default.
- `POST /synthesize` now keeps raw `.txt` content out of the prepared job
  payload after decoding.
- Audio/video bytes are cleared from the job payload immediately after
  transcription finishes or fails.
- Raw transcript rows are no longer saved to Supabase unless
  `STORE_TRANSCRIPTS=true` is explicitly set.
- Synthesis cache files are disabled by default for the web app with
  `ENABLE_SYNTH_CACHE=false` so cluster/insight JSON containing quote excerpts
  is not written to disk in production.
- Added `backend/migrations/2026-05-21_scrub_transcript_content.sql` to replace
  previously saved transcript bodies with `[raw transcript not retained]`.
- Updated `SECURITY_TRUST_PLAN.md`, `README.md`, `.env.example`, and
  `PROMPT.md`.

Important remaining caveat: synthesis markdown is still saved in plaintext and
may include verbatim quotes from transcripts. If the security requirement
expands from "developer cannot read raw transcripts" to "developer cannot read
any customer-derived content," the next step is encrypting or not persisting
`syntheses.markdown_output`.

## Plaintext Synthesis Storage Disabled - 2026-05-21

Bhavana clarified the stronger storage requirement: when sensitive data is
stored, the developer must not be able to see it at all. Server-side encryption
does not meet that bar if the developer controls the server and encryption key.
Saved sensitive content needs client-side encryption with a key/passphrase the
server never receives.

What changed:
- Added `STORE_PLAINTEXT_SYNTHESES=false` as the production default.
- `POST /synthesize` no longer saves generated synthesis markdown to Supabase
  unless plaintext storage is explicitly enabled.
- Added `backend/migrations/2026-05-21_scrub_plaintext_syntheses.sql` to remove
  historical plaintext saved reports and `themes_json`.
- Added `backend/migrations/2026-05-21_encrypted_artifacts.sql` for future
  browser-encrypted saved reports.
- Added `E2EE_STORAGE_PLAN.md` describing browser-side AES-GCM storage using a
  user-held passphrase/key.
- Updated `SECURITY_TRUST_PLAN.md`, `USER_GROWTH_PLAN.md`, `README.md`,
  `.env.example`, and `PROMPT.md`.

Current safe production defaults:
`STORE_TRANSCRIPTS=false`, `ENABLE_SYNTH_CACHE=false`, and
`STORE_PLAINTEXT_SYNTHESES=false`.
