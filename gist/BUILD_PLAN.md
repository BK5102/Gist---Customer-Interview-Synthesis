# Customer Interview Synthesis — Build Plan

A founder-focused AI tool that turns customer interview transcripts (and audio) into a themed synthesis with traceable quotes.

**Audience:** solo founders and early-stage PMs doing customer discovery.
**Positioning:** simpler than Dovetail/Marvin, more synthesis-focused than generic meeting tools.
**Project type:** Learning project. Goal is breadth of shipping muscle, not market dominance.

---

## Contents

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [Feature scope by phase](#2-feature-scope-by-phase)
3. [Tech stack](#3-tech-stack)
4. [Repo structure](#4-repo-structure)
5. [Data model](#5-data-model)
6. [Timeline overview](#6-timeline-overview)
7. [Phase 0 — v0 core (Days 1-3)](#phase-0--v0-core-days-1-3)
8. [Phase 1 — Audio / Whisper (Days 4-6)](#phase-1--audio--whisper-days-4-6)
9. [Phase 2 — Auth + accounts + DB (Days 7-13)](#phase-2--auth--accounts--db-days-7-13)
10. [Phase 3 — Notion integration (Days 14-17)](#phase-3--notion-integration-days-14-17)
11. [Phase 4 — Ship + get real users (Day 18+)](#phase-4--ship--get-real-users-day-18)
12. [Daily shipping discipline](#12-daily-shipping-discipline)
13. [Prompts and schemas](#13-prompts-and-schemas)
14. [Cost estimates](#14-cost-estimates)
15. [Things that will go wrong](#15-things-that-will-go-wrong)

---

## 1. Goals and non-goals

**Goals**
- Ship a working, deployed tool a stranger can use within 3 days.
- Add audio transcription, persistence, and one integration across ~2.5 weeks at 3 hrs/day.
- Complete the full founder loop once: build → ship → real users → feedback → iterate.
- Produce portfolio evidence: live URL, GitHub repo with clean commits, a short write-up.

**Non-goals**
- Compete with Dovetail or Marvin on feature depth.
- Build team collaboration, tagging taxonomies, or a research repository.
- Serve enterprise customers with SOC 2, SSO, or audit logs.
- Perfectly architected code. Ship first, refactor later if the project justifies it.

---

## 2. Feature scope by phase

| Phase | Feature | Days | User-visible outcome |
|---|---|---|---|
| 0 | Text-in, synthesis-out | 1-3 | Upload `.txt` transcripts, get markdown synthesis |
| 1 | Audio transcription | 4-6 | Upload `.mp3`/`.wav`, tool transcribes then synthesizes |
| 2 | Auth + DB + dashboard | 7-13 | Signup, keep past syntheses, revisit them |
| 3 | Notion integration | 14-17 | One-click push synthesis to Notion workspace |
| 4 | Get 5-10 users | 18+ | Real usage, feedback, fixes |

---

## 3. Tech stack

Picked for speed over novelty. If any of these are unfamiliar, swap to what you know.

**Backend**
- Python 3.11+
- FastAPI (single `main.py` is fine for v0)
- `anthropic` SDK for Claude
- `openai` SDK for Whisper (Phase 1)
- `python-multipart` for file uploads

**Frontend**
- Next.js 14 with App Router + Tailwind CSS
- `react-markdown` to render synthesis output
- `@supabase/ssr` (Phase 2)

**LLM**
- `claude-sonnet-4-6` for extraction and synthesis (current Sonnet; $3/M input, $15/M output)
- `claude-haiku-4-5-20251001` as a fallback/experiment for cheaper extraction ($1/M input, $5/M output)

Verify current model names at [https://docs.claude.com/en/api/overview](https://docs.claude.com/en/api/overview) before shipping — these change.

**Infrastructure**
- GitHub for source control
- Railway or Render for backend hosting (free/cheap tier)
- Vercel for frontend (free tier)
- Supabase for auth + Postgres (Phase 2, free tier)

**Cost while building**
- Claude API: budget $15-25 during development
- Whisper API: ~$0.006/min, budget $5-10
- Everything else: free tier

---

## 4. Repo structure

```
interview-synth/
├── backend/
│   ├── main.py                  # FastAPI entry point
│   ├── synth/
│   │   ├── __init__.py
│   │   ├── extract.py           # Per-transcript theme extraction
│   │   ├── cluster.py           # Cross-transcript synthesis
│   │   ├── insights.py          # Founder-focused "what does this mean" layer
│   │   ├── verify.py            # Quote verification (string matching)
│   │   └── prompts.py           # All prompts in one place
│   ├── transcribe/              # Phase 1
│   │   └── whisper.py
│   ├── auth/                    # Phase 2
│   │   └── supabase_client.py
│   ├── integrations/            # Phase 3
│   │   └── notion.py
│   ├── models.py                # Pydantic schemas
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── page.tsx             # Upload + synthesize
│   │   ├── projects/            # Phase 2
│   │   └── synthesis/[id]/      # Phase 2
│   ├── components/
│   ├── lib/
│   ├── package.json
│   └── .env.local.example
├── test-transcripts/            # Sample transcripts for dev
├── eval/
│   ├── baseline.md              # Known findings from your past research
│   └── results/                 # Scored synthesis outputs over time
├── README.md
└── BUILD_PLAN.md                # This file
```

---

## 5. Data model

Supabase Postgres. Added in Phase 2, designed now so you don't refactor later.

```sql
-- Users come from Supabase auth.users automatically
-- Row-Level Security on every table; user_id must match auth.uid()

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table transcripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  filename text not null,
  participant_label text,           -- "P1", "Alice", etc.
  content text not null,            -- Raw transcript text
  source_type text,                 -- 'text_upload' | 'audio_upload'
  audio_url text,                   -- S3/Supabase storage URL if audio
  duration_seconds int,
  created_at timestamptz default now()
);

create table syntheses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  markdown_output text not null,
  themes_json jsonb,                -- Full structured output
  transcript_ids uuid[],            -- Which transcripts this used
  model_used text,
  cost_cents int,
  created_at timestamptz default now()
);

create table notion_connections (      -- Phase 3
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique,
  access_token text not null,           -- encrypt at rest
  workspace_id text,
  workspace_name text,
  default_database_id text,
  created_at timestamptz default now()
);

-- RLS example
alter table projects enable row level security;
create policy "Users see their own projects" on projects
  for all using (auth.uid() = user_id);
```

---

## 6. Timeline overview

At 3 hours per day, pushing features in small commits:

```
Week 1: v0 core
  Day 1  → Extraction working on one transcript
  Day 2  → Cross-transcript synthesis + eval
  Day 3  → Deploy, shareable URL
  Day 4  → Audio: wire up Whisper
  Day 5  → Audio: multi-format, chunking, speakers
  Day 6  → Audio: UI integration + test end-to-end

Week 2: Persistence
  Day 7  → Supabase setup, signup/login
  Day 8  → Protect endpoints, wire tokens
  Day 9  → Migrations, CRUD for projects
  Day 10 → Save synthesis, list past syntheses
  Day 11 → Frontend: login page, projects dashboard
  Day 12 → Frontend: synthesis detail page, history
  Day 13 → Auth bug-bash day (there will be bugs)

Week 3: Notion + ship
  Day 14 → Notion OAuth
  Day 15 → Database picker + markdown → Notion blocks
  Day 16 → Error states, token refresh
  Day 17 → Polish, README, Loom demo
  Day 18 → Post for users, fix top complaints
  Day 19+ → Iterate on user feedback
```

Total: ~18-19 working days at 3 hrs/day = **~3.5 weeks wall-clock** assuming no missed days.

---

## Phase 0 — v0 core (Days 1-3)

This is the 3-day sprint I described in chat. Reproducing here in detail so the doc is self-contained.

### Day 1 — Single-transcript extraction (3 hrs)

**Hour 1: setup**
- [ ] `mkdir interview-synth && cd interview-synth`
- [ ] `git init`, connect to GitHub
- [ ] `python -m venv venv && source venv/bin/activate`
- [ ] `pip install anthropic fastapi "uvicorn[standard]" python-multipart python-dotenv pydantic`
- [ ] Create `backend/` with `requirements.txt` and `.env.example`
- [ ] Get Anthropic API key, set `ANTHROPIC_API_KEY` in `.env`
- [ ] Commit: "Initial repo scaffold"

**Hour 2: source test data**
- [ ] Gather 3 real interview transcripts. Priority order:
  1. Your own past research projects
  2. GitHub: search `"customer discovery" transcript filetype:txt`
  3. YouTube auto-captions from podcast-style interviews
  4. Record 2 mock interviews with friends, transcribe with free Whisper
- [ ] Drop them in `test-transcripts/` as `P1.txt`, `P2.txt`, `P3.txt`
- [ ] Anonymize if needed

**Hour 3: first extraction**
- [ ] Write `backend/synth/extract.py` — see [Prompts and schemas](#13-prompts-and-schemas)
- [ ] Use Claude's tool-use for structured output (more reliable than JSON-in-prompt)
- [ ] Write `backend/synth/verify.py` — string-match check that every extracted quote appears verbatim in the transcript
- [ ] Run on each test transcript from CLI: `python -m backend.synth.extract test-transcripts/P1.txt`
- [ ] Read the outputs. Note: what's missed? what's over-extracted? what categories don't work?
- [ ] Commit: "Working single-transcript extraction with quote verification"

**End-of-day check**
You can run one command and get 8-15 verified, categorized themes from a transcript.

### Day 2 — Cross-transcript synthesis + eval (3 hrs)

**Hour 1: cluster themes across transcripts**
- [ ] Write `backend/synth/cluster.py`
- [ ] Run extraction across all 3-5 test transcripts. You now have 30-60 theme objects.
- [ ] Start with the simple approach: one Claude call that takes all themes and returns deduplicated clusters with frequency counts and best supporting quotes
- [ ] Skip embeddings/HDBSCAN unless the simple approach fails badly

**Hour 2: founder insights + markdown output**
- [ ] Write `backend/synth/insights.py` — generates 3 founder-specific takeaways:
  1. Strongest signal (what to build/validate)
  2. Most-contradicted assumption (disagreement)
  3. Biggest surprise (outlier worth investigating)
- [ ] Write a formatter that turns clusters + insights into clean markdown
- [ ] Render to `output.md`. Open in a markdown viewer. Does it look useful?

**Hour 3: eval**
- [ ] Pick one of your past research projects where you remember the real findings
- [ ] Write `eval/baseline.md` with what you actually found back then
- [ ] Run the tool on those transcripts
- [ ] Score: did it surface what you found? Miss anything? Invent anything?
- [ ] Write results in `eval/results/run1.md`
- [ ] Iterate on prompts if eval is clearly weak
- [ ] Commit: "Cross-transcript synthesis + baseline eval"

**End-of-day check**
Pointing the tool at a folder of transcripts produces a markdown file you'd send a founder friend.

### Day 3 — Deploy (3 hrs)

**Hour 1: FastAPI endpoint**
- [ ] Write `backend/main.py` with:
  - `POST /synthesize` — accepts multiple `.txt` files, returns markdown
  - `GET /health` — simple OK response
- [ ] Test locally with curl or the Swagger UI at `/docs`

**Hour 2: thinnest frontend**
- [ ] `npx create-next-app@latest frontend --typescript --tailwind --app`
- [ ] Build one page: multi-file upload → "Synthesize" → loading state → rendered markdown
- [ ] Install `react-markdown` for rendering
- [ ] Handle 3 error cases: wrong format, too big, backend error

**Hour 3: deploy**
- [ ] Push backend to Railway (set `ANTHROPIC_API_KEY` env var)
- [ ] Push frontend to Vercel (set `NEXT_PUBLIC_API_URL` env var)
- [ ] Fix CORS on backend
- [ ] Test from fresh browser: does upload-and-synthesize work end-to-end?
- [ ] Write a one-page `README.md`
- [ ] Record a 60-second Loom
- [ ] Commit: "v0 deployed"

**End of Day 3**
Live URL. A stranger can visit and use it. Tag the commit `v0.1.0`.

---

## Phase 1 — Audio / Whisper (Days 4-6)

### Day 4 — Wire up Whisper (3 hrs)

**Hour 1: pick provider and test**
- [ ] Default choice: **OpenAI Whisper API** (`whisper-1`), $0.006/min, easy
- [ ] Alternative: **Deepgram Nova-2** — faster, cheaper, better built-in speaker diarization. Pick this if you care about "who said what."
- [ ] `pip install openai` (for Whisper) or `pip install deepgram-sdk`
- [ ] Get API key, add to `.env`

**Hour 2: basic transcription**
- [ ] Write `backend/transcribe/whisper.py`
- [ ] Function: `transcribe(file_path: str) -> str` returns plain text
- [ ] Test on a 5-minute audio file
- [ ] Add a `.vtt` output option so you get timestamps (useful later)

**Hour 3: integrate into pipeline**
- [ ] Update `POST /synthesize` to accept audio files (`.mp3`, `.wav`, `.m4a`, `.mp4`)
- [ ] If audio: transcribe first, then run the existing synthesis pipeline
- [ ] Return synthesis as before, plus the transcript so the user has it
- [ ] Commit: "Phase 1: audio transcription with Whisper"

### Day 5 — Handle the annoying parts (3 hrs)

**Hour 1: format + size**
- [ ] Validate file types on the backend
- [ ] OpenAI Whisper caps files at 25MB — chunk anything larger (split at silence or at fixed 10-min intervals with ffmpeg)
- [ ] `pip install pydub` for audio slicing
- [ ] Test with a 45-minute interview recording

**Hour 2: speaker diarization**
- [ ] Whisper alone doesn't label speakers. Options:
  - Switch to Deepgram (native diarization)
  - Stay with Whisper + use `pyannote.audio` locally (heavier setup)
  - Skip speaker labels for now and just add a manual "participant name" field
- [ ] Pragmatic choice for v1: **manual participant labels per file.** User types "P1 — Alice, consultant" when uploading. Ship this. Revisit if users ask.

**Hour 3: async job handling**
- [ ] Long transcriptions take 1-3 minutes. Change `/synthesize` to:
  - Kick off a job, return a `job_id` immediately
  - Frontend polls `GET /jobs/{job_id}` for status
- [ ] Use simple in-memory job dict for now; replace with DB in Phase 2
- [ ] Show a real progress indicator on the frontend (Transcribing → Extracting → Clustering → Done)
- [ ] Commit: "Phase 1: chunking, participant labels, async jobs"

### Day 6 — Frontend integration + end-to-end test (3 hrs)

**Hour 1: upload UX**
- [ ] Drag-and-drop for audio files
- [ ] Per-file participant label input
- [ ] File size + type validation before upload

**Hour 2: progress UI**
- [ ] Show per-file status: Pending → Transcribing → Extracting → Done
- [ ] Estimated time ("~3 min for a 30-min interview")
- [ ] Handle errors gracefully per file

**Hour 3: test with real audio**
- [ ] Record a real mock interview (or use one of yours)
- [ ] Full flow: upload audio → wait → read synthesis
- [ ] Fix what breaks
- [ ] Commit: "Phase 1 complete: audio in, synthesis out"
- [ ] Tag `v0.2.0`

**End of Phase 1**
You can now upload audio files and get the same synthesis you got in v0. Tool feels real.

---

## Phase 2 — Auth + accounts + DB (Days 7-13)

This is the longest phase. Expect bugs.

### Day 7 — Supabase setup (3 hrs)

**Hour 1: project setup**
- [ ] Create Supabase project (free tier)
- [ ] Save project URL, anon key, service role key to `.env` (both backend and frontend)
- [ ] Enable email auth in Supabase dashboard
- [ ] Optionally enable Google OAuth (one click, users love it)

**Hour 2: frontend auth**
- [ ] `npm install @supabase/supabase-js @supabase/ssr`
- [ ] Create `frontend/lib/supabase/client.ts` and `server.ts` per Supabase Next.js docs
- [ ] Build `/login` and `/signup` pages
- [ ] Add a top-nav auth state (logged in vs not)

**Hour 3: test the loop**
- [ ] Sign up a test account, log in, log out
- [ ] Confirm session persists on refresh
- [ ] Commit: "Phase 2: Supabase auth scaffold"

### Day 8 — Protect the API (3 hrs)

**Hour 1: forward auth to backend**
- [ ] Frontend sends `Authorization: Bearer <supabase_jwt>` on every API call
- [ ] Backend middleware verifies the JWT using Supabase's JWKS endpoint or the shared JWT secret
- [ ] `pip install pyjwt[crypto] httpx`

**Hour 2: require auth on endpoints**
- [ ] Gate `POST /synthesize` behind auth
- [ ] Extract `user_id` from the JWT and use it for DB writes
- [ ] Return 401 cleanly on missing/invalid token

**Hour 3: test**
- [ ] Call `/synthesize` logged out — should fail
- [ ] Log in, call again — should work
- [ ] Commit: "Phase 2: protected API endpoints"

### Day 9 — Schema + migrations (3 hrs)

**Hour 1: run migrations**
- [ ] Write `schema.sql` with the [Data model](#5-data-model) above
- [ ] Run in Supabase SQL editor
- [ ] Enable RLS on every table
- [ ] Add RLS policies — test policy with a test user

**Hour 2: DB helpers in backend**
- [ ] `pip install supabase` (Python client)
- [ ] Write `backend/db.py` with functions:
  - `create_project(user_id, name)`
  - `get_projects(user_id)`
  - `save_transcript(project_id, filename, content, ...)`
  - `save_synthesis(project_id, markdown, themes_json, ...)`
  - `get_syntheses(user_id)`

**Hour 3: wire into `/synthesize`**
- [ ] On synthesis request: create or use project → save transcripts → save synthesis
- [ ] Return synthesis ID so frontend can link to it
- [ ] Commit: "Phase 2: DB schema + persistence"

### Day 10 — Projects dashboard backend (3 hrs)

**Hour 1: new endpoints**
- [ ] `GET /projects` — list user's projects
- [ ] `POST /projects` — create new project
- [ ] `GET /projects/{id}` — single project with its syntheses
- [ ] `GET /syntheses/{id}` — one synthesis with its transcripts

**Hour 2: test endpoints**
- [ ] Call from curl with a real JWT
- [ ] Confirm RLS actually blocks cross-user access (critical security check)

**Hour 3: refactor `/synthesize`**
- [ ] Accept optional `project_id` in the request
- [ ] If none provided, create a project named by the first filename or timestamp
- [ ] Commit: "Phase 2: projects API"

### Day 11 — Frontend: dashboard (3 hrs)

**Hour 1: projects list**
- [ ] `/projects` page: list all projects, "New project" button
- [ ] Fetch with server component or SWR/React Query

**Hour 2: project detail**
- [ ] `/projects/[id]` page: project name, list of syntheses with dates, "New synthesis" button

**Hour 3: polish**
- [ ] Empty states ("No projects yet — create your first one")
- [ ] Loading skeletons
- [ ] Commit: "Phase 2: projects dashboard UI"

### Day 12 — Frontend: synthesis view (3 hrs)

**Hour 1: synthesis detail page**
- [ ] `/syntheses/[id]` page renders the saved markdown
- [ ] Show which transcripts were used, participant labels
- [ ] "Copy as markdown" button (instant value — no Notion needed to get content out)

**Hour 2: history**
- [ ] Project detail page now shows timeline of past syntheses
- [ ] Allow deleting a synthesis

**Hour 3: navigation polish**
- [ ] Breadcrumbs: Projects → Project name → Synthesis
- [ ] Consistent header across pages
- [ ] Commit: "Phase 2: synthesis detail + history"

### Day 13 — Auth bug-bash (3 hrs)

Budget this day entirely for things that broke. Common issues:

- [ ] Session expiry during a long synthesis job → handle 401 in frontend, prompt re-login
- [ ] CORS preflight failing on authenticated requests → fix headers
- [ ] RLS policy blocking legitimate reads (wrong `user_id` column assumption)
- [ ] Tokens not refreshing properly → use Supabase's `onAuthStateChange`
- [ ] Logged-out user visiting `/projects` → redirect to `/login`, preserve intended destination

**End of Phase 2**
Users sign up, have their own data, can revisit past work. Tag `v0.3.0`.

---

## Phase 3 — Notion integration (Days 14-17)

Real talk: this is "nice to have." See if users ask for it in Phase 4 first. If you're still motivated, here's the plan.

### Day 14 — Notion OAuth (3 hrs)

**Hour 1: Notion developer setup**
- [ ] Create a Notion integration at https://www.notion.so/my-integrations
- [ ] Make it a "Public integration" (required for OAuth)
- [ ] Set redirect URI: `https://yourapp.com/api/notion/callback`
- [ ] Save `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` to `.env`

**Hour 2: OAuth flow**
- [ ] Add "Connect Notion" button in Settings
- [ ] Clicking opens: `https://api.notion.com/v1/oauth/authorize?client_id=...&response_type=code&owner=user&redirect_uri=...`
- [ ] On callback, exchange code for access token
- [ ] Save token in `notion_connections` table (encrypt at rest if you want to be safe)

**Hour 3: test**
- [ ] Connect Notion from a test account
- [ ] Confirm token stored correctly
- [ ] Commit: "Phase 3: Notion OAuth"

### Day 15 — Database picker + block conversion (3 hrs)

**Hour 1: list Notion databases**
- [ ] Call `POST https://api.notion.com/v1/search` with filter `{ value: 'database', property: 'object' }`
- [ ] Expose `GET /notion/databases` to frontend
- [ ] Show dropdown in UI

**Hour 2: markdown → Notion blocks**
- [ ] `pip install martian-py` (or write your own — Notion's block format isn't complicated)
- [ ] Handle: H1/H2/H3, paragraphs, bullet lists, blockquotes, bold/italic
- [ ] Test with a sample synthesis output

**Hour 3: push**
- [ ] `POST /notion/push` — takes synthesis_id + database_id
- [ ] Creates a new page in that database with the synthesis as content
- [ ] Return the Notion page URL
- [ ] Commit: "Phase 3: push synthesis to Notion"

### Day 16 — Error states + token refresh (3 hrs)

**Hour 1: error handling**
- [ ] Token revoked → catch 401 from Notion, prompt reconnect
- [ ] Database deleted → catch 404, show friendly error
- [ ] Rate limits → exponential backoff

**Hour 2: disconnect + reconnect UX**
- [ ] "Disconnect Notion" button in Settings → deletes token from DB
- [ ] Reconnect flow actually works (revoked tokens cleaned up)

**Hour 3: test a real workflow**
- [ ] From Phase 2 dashboard, open a synthesis, push to Notion, verify it appears
- [ ] Commit: "Phase 3 complete"
- [ ] Tag `v0.4.0`

### Day 17 — Polish + docs (3 hrs)

**Hour 1: README**
- [ ] What it does
- [ ] Demo Loom (record a new one)
- [ ] Tech stack
- [ ] Running locally
- [ ] Known limitations
- [ ] Feedback email

**Hour 2: landing page**
- [ ] Logged-out homepage: one-line value prop, demo GIF, "Sign up" CTA
- [ ] No fake testimonials or logos — don't do that

**Hour 3: small UX wins**
- [ ] Better empty states
- [ ] A few keyboard shortcuts (Cmd+Enter to synthesize)
- [ ] Favicon
- [ ] Commit: "v1.0 polish"

**End of Phase 3**
Full tool, deployed, with auth, audio, and Notion. Tag `v1.0.0`.

---

## Phase 4 — Ship + get real users (Day 18+)

This is the most important phase. Do not skip.

### Day 18 — Post the thing

- [ ] Indie Hackers: "I built a tool that turns customer interview recordings into synthesis docs. Free, looking for 5 founders to try it."
- [ ] r/startups, r/Entrepreneur: same post adapted
- [ ] Twitter/X: short thread with a 30-second demo video
- [ ] Lenny's Newsletter community Slack (if you have access)
- [ ] Your personal network: DM 10 founders directly

### Days 19-25 — Watch, fix, repeat

- [ ] Schedule 15-min calls with the first 5 users who try it
- [ ] Watch them use it. Don't explain. Take notes on every confusion.
- [ ] Fix top 3 issues each week
- [ ] Ask at the end: "Would you pay $20/mo for this?" (Don't actually charge yet — you're learning the answer.)

### What "done" looks like

- [ ] 10+ real users have used it
- [ ] You have a clear list of the 3 things people consistently hit
- [ ] You've written a 500-word post about what you learned
- [ ] You know whether you want to keep going or move to project #2

---

## 12. Daily shipping discipline

You said "push a few features to the repo every day." Here's how to actually make that true.

**Commit rules**
- Every hour of work ends with at least one commit, even if it's tiny.
- Commit messages follow this pattern: `<phase>: <what changed>` (e.g., `phase-2: add RLS policies on projects`)
- If you haven't committed in 90 minutes, stop and commit something.

**Branch strategy**
- `main` is always deployed and working.
- Work on `feature/<phase>-<name>` branches. Merge to `main` when the day's work is green.
- Don't let branches live more than 2 days.

**Each day**
1. Open the BUILD_PLAN. Find today's section.
2. Check off items as you finish them.
3. At end of day, write 3 lines in a `JOURNAL.md`: what you shipped, what surprised you, what's next.

The journal is the single most valuable thing you'll produce. Future-you (and future investors) will thank present-you.

**When you miss a day**
You will. Don't catch up by doubling the next day — it breaks. Just shift the timeline by one day. The goal is sustainable shipping, not heroics.

---

## 13. Prompts and schemas

### 13.1 Extraction schema (tool-use input)

```python
EXTRACT_THEMES_TOOL = {
    "name": "extract_themes",
    "description": "Extract themes, quotes, and observations from a single customer interview transcript.",
    "input_schema": {
        "type": "object",
        "properties": {
            "themes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "theme": {
                            "type": "string",
                            "description": "Short 2-5 word label for the theme"
                        },
                        "category": {
                            "type": "string",
                            "enum": [
                                "pain_point",
                                "feature_request",
                                "workflow_description",
                                "jobs_to_be_done",
                                "emotional_moment",
                                "contradiction",
                                "surprising_statement"
                            ]
                        },
                        "summary": {
                            "type": "string",
                            "description": "One-sentence summary in your own words"
                        },
                        "quote": {
                            "type": "string",
                            "description": "VERBATIM quote from the transcript supporting this theme. Copy exactly — do not paraphrase."
                        },
                        "quote_context": {
                            "type": "string",
                            "description": "One sentence: what was being discussed when this was said"
                        }
                    },
                    "required": ["theme", "category", "summary", "quote", "quote_context"]
                }
            }
        },
        "required": ["themes"]
    }
}
```

### 13.2 Extraction prompt

```
You are analyzing a single customer interview transcript for a founder
doing customer discovery. Your job is to extract meaningful themes
that would help the founder decide what to build.

Focus on:
- Pain points the participant describes (concrete, not vague)
- Specific workflows and how they currently work around problems
- Features or improvements the participant explicitly or implicitly requests
- Jobs-to-be-done — what the participant is trying to accomplish
- Emotional moments — frustration, delight, resignation
- Contradictions — where the participant says one thing but implies another
- Surprising statements — things that would make the founder rethink assumptions

Rules:
- Every quote MUST be verbatim from the transcript. Do not paraphrase.
- Aim for 8-15 themes per transcript. Skip fluff.
- Don't invent themes that weren't actually discussed.
- If the participant disagreed with themselves at different points, capture BOTH as separate themes with category "contradiction".

Call the extract_themes tool with your findings.

TRANSCRIPT (Participant: {participant_id}):
---
{transcript_text}
---
```

### 13.3 Clustering schema

```python
CLUSTER_THEMES_TOOL = {
    "name": "cluster_themes",
    "description": "Group semantically similar themes from multiple interviews.",
    "input_schema": {
        "type": "object",
        "properties": {
            "clusters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "cluster_name": {"type": "string"},
                        "cluster_summary": {"type": "string"},
                        "participant_count": {"type": "integer"},
                        "participants": {
                            "type": "array",
                            "items": {"type": "string"}
                        },
                        "category": {"type": "string"},
                        "supporting_quotes": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "participant_id": {"type": "string"},
                                    "quote": {"type": "string"}
                                }
                            }
                        }
                    },
                    "required": ["cluster_name", "cluster_summary", "participant_count", "participants", "category", "supporting_quotes"]
                }
            }
        },
        "required": ["clusters"]
    }
}
```

### 13.4 Insights prompt

```
You are helping a founder make sense of what they learned across N
customer interviews. You've been given the clustered themes.

Produce exactly 3 insights — each one sentence of setup + one paragraph:

1. STRONGEST SIGNAL: The clearest pattern. What should the founder
   build or validate next, based on what was most consistently said?

2. CONTRADICTED ASSUMPTION: Where did participants disagree with each
   other, or where did what they said contradict what they did? This
   is where assumptions break.

3. BIGGEST SURPRISE: The most unexpected statement or pattern. The
   thing the founder probably didn't go into these interviews looking for.

Be specific. Reference participants by ID. Don't hedge.
```

### 13.5 Quote verification

```python
import re

def normalize(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()

def verify_quote(quote: str, transcript: str, fuzzy_threshold: float = 0.95) -> bool:
    """Check that `quote` appears (approximately) in `transcript`."""
    norm_quote = normalize(quote)
    norm_transcript = normalize(transcript)
    if norm_quote in norm_transcript:
        return True
    # Fallback: fuzzy match via rapidfuzz if you want
    # from rapidfuzz import fuzz
    # return fuzz.partial_ratio(norm_quote, norm_transcript) / 100 >= fuzzy_threshold
    return False
```

Reject or flag any theme whose quote fails this check. An unreliable quote is worse than no quote.

---

## 14. Cost estimates

Assumes Sonnet 4.6 for all calls. Based on a single synthesis run with 10 transcripts of ~5000 tokens each.

| Step | Input tokens | Output tokens | Cost per run |
|---|---|---|---|
| Extraction (10 × transcript) | ~55,000 | ~15,000 | $0.39 |
| Clustering (1 call) | ~18,000 | ~5,000 | $0.13 |
| Insights (1 call) | ~6,000 | ~1,500 | $0.04 |
| **Total Claude cost per synthesis** | | | **~$0.56** |
| Whisper (10 × 30-min interviews) | | | $1.80 |
| **Total per synthesis with audio** | | | **~$2.36** |

At $20/mo pricing with typical usage (2-3 syntheses/mo, 15 interviews total), gross margin is healthy for a solo operator.

Development cost: you'll probably burn $15-25 in Claude credits getting prompts right. Budget $50 total including Whisper testing.

---

## 15. Things that will go wrong

In rough order of likelihood:

1. **Hallucinated quotes.** Despite "verbatim" in the prompt, Sonnet will paraphrase occasionally. This is why the verification step is non-negotiable.
2. **Huge transcripts blow context.** A 2-hour interview can be 30K tokens. Chunk at natural speaker-turn boundaries, extract per chunk, merge.
3. **Supabase RLS misconfiguration.** You'll write a policy that blocks legitimate reads. Test with a second user account from day one.
4. **CORS hell on deployment.** Railway/Vercel cross-origin. Use exact origins, not wildcards with credentials.
5. **Whisper timeout on large files.** 25MB limit is strict. Chunk with `pydub` or `ffmpeg`.
6. **Notion OAuth redirect mismatch.** Localhost vs production redirect URIs. Set both in the Notion dashboard.
7. **Session expiring mid-job.** A 3-minute synthesis outlives a short session. Refresh token proactively or design jobs to be resumable by ID without session.
8. **Supabase free tier pausing your project.** Inactive projects get paused. Not a problem while developing, annoying if you step away.
9. **Motivation crash around day 9-11.** This is normal. The auth phase is boring. Shipping discipline matters most here. Stay on the plan, commit daily, don't negotiate with yourself.
10. **Scope creep.** Every time you want to add a "small" feature mid-phase, write it in a `BACKLOG.md` and keep moving. Your future reps matter more than any one feature.

---

## Final note

The plan is a scaffold, not a contract. If Day 5 teaches you something that changes Day 12, update the plan. The goal is to ship, learn, and move — not to follow a spec.

When v1.0 is live, write a 500-word post about what you built, what broke, what surprised you. That post is worth more than the code.

Good luck. Ship it.