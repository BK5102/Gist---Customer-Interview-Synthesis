# Journal

## Day 3 — 2026-04-20

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
