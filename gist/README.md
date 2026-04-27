# Gist

Turn customer interview transcripts into themed synthesis with traceable quotes — built for solo founders doing customer discovery.

**Status: phase-1 day 4 — text + audio ingest live locally.**

Drop `.txt` transcripts or audio files (`.mp3 .wav .m4a .mp4 .webm`), get back markdown with:

- **Insights** — strongest signal, contradicted assumption, biggest surprise
- **Themes** — clustered across interviews, each with verbatim quotes and participant IDs

Every quote is verified against the source transcript before it reaches the output.

## Pipeline

```
audio → Whisper transcribe ──┐
                             ├─→ extract themes per-file (Haiku)
text ────────────────────────┘        ↓
                              cluster across files (Sonnet)
                                      ↓
                              insights (Sonnet)
                                      ↓
                              render markdown
```

Quote verification runs inside the extraction step: any theme whose `verbatim_quote` is not a substring of the transcript (whitespace-normalized) is dropped and counted.

## Architecture

```
frontend (Next.js 14)          backend (FastAPI)
┌──────────────────┐           ┌────────────────────────────┐
│ app/page.tsx     │  ──POST─▶ │ POST /synthesize           │
│  upload .txt     │ multipart │   extract_from_text ×N     │
│  render markdown │           │   cluster_themes_cached    │
│                  │ ◀──JSON── │   generate_insights_cached │
└──────────────────┘  markdown │   render_markdown          │
                               └────────────────────────────┘
```

Cluster + insights steps cache by SHA1 of their input JSON under `eval/results/` so re-runs on the same transcripts skip the slow LLM calls.

## Run locally

**Backend** (Python 3.11+):

```bash
cd backend
python -m venv venv
source venv/Scripts/activate   # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env           # fill in ANTHROPIC_API_KEY (+ OPENAI_API_KEY for audio)
uvicorn main:app --reload --port 8000
```

`GET http://localhost:8000/health` → `{"status": "ok"}`

**Frontend** (Node 18+):

```bash
cd frontend
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev
```

Open `http://localhost:3000`, pick `.txt` transcripts from `test-transcripts/` (or your own), click **Synthesize**.

## Deploy

**Backend → Railway**

- Set **Root Directory** to `backend` in Railway service settings.
- Nixpacks picks up `requirements.txt` + `runtime.txt` (Python 3.11) and runs the `Procfile`.
- Env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (Whisper, ~$0.006/min), `CORS_ORIGINS=https://<your-vercel-domain>`.

**Frontend → Vercel**

- Set **Root Directory** to `frontend`.
- Env var: `NEXT_PUBLIC_API_URL=https://<your-railway-domain>`.

## Repo layout

See [CLAUDE.md](CLAUDE.md) for the full layout. Key entry points:

- [backend/main.py](backend/main.py) — FastAPI app, `/synthesize` endpoint
- [backend/synth/prompts.py](backend/synth/prompts.py) — all LLM prompts + tool schemas
- [backend/synth/extract.py](backend/synth/extract.py) — per-transcript extraction
- [backend/synth/cluster.py](backend/synth/cluster.py) — cross-transcript clustering
- [backend/synth/insights.py](backend/synth/insights.py) — founder takeaways
- [backend/synth/verify.py](backend/synth/verify.py) — quote verification
- [backend/synth/format.py](backend/synth/format.py) — markdown renderer
- [backend/transcribe/whisper.py](backend/transcribe/whisper.py) — audio → text via Whisper
- [frontend/app/page.tsx](frontend/app/page.tsx) — upload UI

## Limits

- Text: 2 MB per `.txt` file
- Audio: 24 MB per file (Whisper API cap; chunking lands in phase-1 day 5)
- 20 files per request, mixed text/audio OK
- No auth (phase 2: Supabase)
- No persistence — each `/synthesize` call is stateless
