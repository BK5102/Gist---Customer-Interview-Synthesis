# Gist — Customer Interview Synthesis

AI tool that turns customer interview transcripts (and audio) into themed synthesis with verified quotes.

## Stack

**Backend** — Python 3.11+, FastAPI, `anthropic` SDK, `openai`/`groq` SDK (Whisper), `python-multipart`
**Frontend** — Next.js 16 App Router, Tailwind CSS, `react-markdown`, `@supabase/ssr`
**LLMs** — `claude-sonnet-4-6` (clustering, insights), `claude-haiku-4-5-20251001` (extraction)
**Infra** — Railway (backend), Vercel (frontend), Supabase (auth + Postgres)

## Repo Layout

```
gist/
├── backend/
│   ├── main.py              # FastAPI entry point — all routes
│   ├── db.py                # Supabase helpers + HTTP/2 retry wrapper
│   ├── models.py            # Pydantic schemas
│   ├── synth/
│   │   ├── extract.py       # Per-transcript theme extraction via tool-use
│   │   ├── cluster.py       # Cross-transcript theme clustering
│   │   ├── insights.py      # Founder-focused takeaways
│   │   ├── verify.py        # Quote verification — verbatim string-match
│   │   ├── format.py        # Markdown renderer
│   │   └── prompts.py       # All LLM prompts in one place
│   ├── transcribe/
│   │   └── whisper.py       # Audio → text via Groq (preferred) or OpenAI Whisper
│   ├── auth/
│   │   └── supabase_client.py  # JWT verification (HS256 + JWKS)
│   ├── integrations/
│   │   └── notion.py        # OAuth + internal token + markdown→blocks
│   ├── migrations/          # SQL migration files — run in Supabase SQL Editor in order
│   ├── schema.sql           # Base Supabase tables + RLS
│   ├── requirements.txt
│   ├── runtime.txt          # python-3.11.x for Railway
│   ├── Procfile             # uvicorn main:app --host 0.0.0.0 --port $PORT
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # Landing hero + upload UI + signed-in workspace hub + SignedInHome
│   │   ├── projects/page.tsx        # Project list, create project, per-project synthesis history
│   │   ├── syntheses/[id]/page.tsx  # Synthesis detail + Notion push
│   │   ├── encrypted/page.tsx       # Browser-decrypted private saves
│   │   ├── settings/page.tsx        # Notion connect/disconnect + Appearance (dark/light/system toggle)
│   │   ├── security/page.tsx        # Static data-flow disclosure page (/security)
│   │   ├── login/ signup/ logout/ forgot-password/ reset-password/
│   │   ├── layout.tsx       # Navbar — signed-out links: Features (/#features), Security (/security)
│   │   ├── globals.css      # Design system — all shared classes here
│   │   └── icon.svg
│   ├── components/
│   │   ├── Breadcrumb.tsx
│   │   └── ThemeProvider.tsx    # dark/light/system theme context; useTheme() hook; wraps layout body
│   ├── lib/
│   │   ├── supabase/{client,server}.ts
│   │   ├── encryption.ts    # AES-GCM browser encryption for private saves
│   │   └── password.ts      # Password validation rules
│   ├── tailwind.config.ts   # Brand palette + darkMode: "class"
│   ├── package.json
│   └── .env.local.example
├── test-transcripts/        # Sample .txt files for dev (P1.txt, P2.txt, P3.txt)
├── eval/
│   ├── baseline.md
│   └── results/
├── BUILD_PLAN.md
├── PROMPT.md                # Durable session-restart doc — keep up to date
└── CLAUDE.md
```

## Key Conventions

- Commit format: `<type>: <what changed>` — types: `feat`, `design`, `fix`, `security`, `deploy`, `docs`
- `main` is always deployed; use short-lived feature branches if needed
- All LLM prompts live in `backend/synth/prompts.py` — no inline prompt strings elsewhere
- Every extracted quote must pass `verify.py` before being returned to the user
- `STORE_PLAINTEXT_SYNTHESES=false` in production — syntheses live only in browser-encrypted artifacts
- Syntheses shown under each project are fetched directly from `encrypted_artifacts` (Supabase, frontend query), not from the backend `syntheses` table
- Project descriptions stored in `projects.description` column (migration: `002_add_project_description.sql`)
- Backend env: `ANTHROPIC_API_KEY`, `GROQ_API_KEY` (or `OPENAI_API_KEY`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- Frontend env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Backend Routes (main.py)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| POST | `/synthesize` | Start synthesis job (202 + job_id) |
| GET | `/jobs/{job_id}` | Poll job status |
| GET | `/projects` | List user's projects (+ `?include_syntheses=true`) |
| POST | `/projects` | Create project |
| PATCH | `/projects/{id}` | Update project description |
| GET | `/projects/{id}` | Single project with syntheses |
| GET | `/syntheses/{id}` | Synthesis detail |
| GET/POST/DELETE | `/notion/*` | Notion OAuth + push + disconnect |

## Design System (globals.css)

Key classes:
- `.page` / `.page-wide` — page containers
- `.card` / `.card-hover` — surface cards
- `.report-shell` — bordered report card container
- `.btn-primary` / `.btn-secondary` — buttons
- `.workspace-tabs` — top-level tab nav (border-y, span elements)
- `.project-tabs` — inner project card tab nav (no borders, button elements, dark pill active state)
- `.surface-panel` — inset panel surface
- `.meta-chip` — small label chips
- `.eyebrow` — uppercase section label
- `.product-kicker` — small teal label
- `.trust-chip` — small bordered chip for trust signal labels (used in landing hero below CTAs); contains inline SVG icon + text
- `.page-title` — shimmer gradient text for all page h1s; light: `#0a0a0a→#0f766e→#0a0a0a` 6 s sweep; dark: `#e5e5e5→#5eead4→#e5e5e5` 3 s sweep; **always re-declare `-webkit-background-clip: text; background-clip: text` in `.dark .page-title` — the `background` shorthand resets `background-clip` to `border-box`, rendering the gradient as a filled rectangle behind text instead of gradient-colored text**
- Dark mode: `darkMode: "class"` in Tailwind; `.dark .class {}` overrides live OUTSIDE all `@layer` blocks; never use `bg-white` or `dark:*` in `@apply` (Turbopack circular dep error)
