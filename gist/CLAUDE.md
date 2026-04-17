# Gist — Customer Interview Synthesis

AI tool that turns customer interview transcripts (and audio) into themed synthesis with traceable quotes.

## Stack

**Backend** — Python 3.11+, FastAPI, `anthropic` SDK, `openai` SDK (Whisper), `python-multipart`
**Frontend** — Next.js 14 App Router, Tailwind CSS, `react-markdown`, `@supabase/ssr`
**LLMs** — `claude-sonnet-4-6` (synthesis), `claude-haiku-4-5-20251001` (cheaper extraction)
**Infra** — Railway (backend), Vercel (frontend), Supabase (auth + Postgres)

## Repo Layout

```
gist/
├── backend/
│   ├── main.py              # FastAPI entry point — POST /synthesize, GET /health
│   ├── models.py            # Pydantic schemas
│   ├── synth/
│   │   ├── extract.py       # Per-transcript theme extraction via tool-use
│   │   ├── cluster.py       # Cross-transcript theme clustering
│   │   ├── insights.py      # Founder-focused takeaways (strongest signal, contradictions, surprises)
│   │   ├── verify.py        # Quote verification — string-match check verbatim quotes
│   │   └── prompts.py       # All LLM prompts in one place
│   ├── transcribe/
│   │   └── whisper.py       # Phase 1: audio → text via OpenAI Whisper
│   ├── auth/
│   │   └── supabase_client.py  # Phase 2: JWT verification + Supabase client
│   ├── integrations/
│   │   └── notion.py        # Phase 3: push synthesis to Notion
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # Upload + synthesize (v0 main page)
│   │   ├── projects/        # Phase 2: dashboard
│   │   └── synthesis/[id]/  # Phase 2: synthesis detail
│   ├── components/
│   ├── lib/
│   ├── package.json
│   └── .env.local.example
├── test-transcripts/        # Sample .txt files for dev (P1.txt, P2.txt, P3.txt)
├── eval/
│   ├── baseline.md          # Known findings from past research
│   └── results/             # Scored outputs per run
├── BUILD_PLAN.md
└── CLAUDE.md
```

## Key Conventions

- Commit format: `phase-N: <what changed>` (e.g. `phase-0: add extraction prompt`)
- `main` is always deployed; feature work on `feature/<phase>-<name>` branches
- All LLM prompts live in `backend/synth/prompts.py` — no inline prompt strings elsewhere
- Every extracted quote must pass `verify.py` before being returned to the user
- Env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`
