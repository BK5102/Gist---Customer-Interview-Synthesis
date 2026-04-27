# FastAPI entry point — POST /synthesize, GET /health
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from synth.cluster import cluster_themes_cached
from synth.extract import extract_from_text
from synth.format import render_markdown
from synth.insights import generate_insights_cached
from transcribe.whisper import WHISPER_MAX_BYTES, transcribe_bytes

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=True)

MAX_FILES_PER_REQUEST = 20

# Per-type size caps. Text transcripts are tiny; audio is bounded by
# Whisper's 25 MB API limit (chunking lands in phase-1 day 5).
TEXT_EXTENSIONS = {".txt"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".webm", ".mpeg", ".mpga"}
ALLOWED_EXTENSIONS = TEXT_EXTENSIONS | AUDIO_EXTENSIONS

MAX_TEXT_BYTES = 2 * 1024 * 1024  # 2 MB
MAX_AUDIO_BYTES = WHISPER_MAX_BYTES  # 24 MB

# Comma-separated list of allowed CORS origins. Defaults to local dev.
# Production: set CORS_ORIGINS=https://your-vercel-domain.vercel.app
_cors_env = os.environ.get("CORS_ORIGINS", "http://localhost:3000")
CORS_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()]

app = FastAPI(title="Gist — Interview Synthesis API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class SynthesizeResponse(BaseModel):
    markdown: str
    cluster_count: int
    participant_count: int
    themes_extracted: int
    themes_dropped: int


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize(
    files: list[UploadFile],
    labels: list[str] = Form(default=[]),
) -> SynthesizeResponse:
    if not files:
        raise HTTPException(400, "No files provided")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            400, f"Too many files (max {MAX_FILES_PER_REQUEST} per request)"
        )
    if labels and len(labels) != len(files):
        raise HTTPException(
            400,
            f"labels count ({len(labels)}) does not match files count "
            f"({len(files)}). Send one label per file (empty string allowed).",
        )

    # Resolve participant ids and validate uniqueness up front, before any
    # expensive reads or Whisper/Haiku calls. Filename stem is the fallback
    # when label is empty. Empty filenames will fail later in the per-file loop.
    resolved_ids: list[str] = []
    seen: set[str] = set()
    for idx, f in enumerate(files):
        if not f.filename:
            continue  # the per-file loop will raise a 400 with full context
        label = labels[idx].strip() if idx < len(labels) else ""
        pid = label or Path(f.filename).stem
        if pid in seen:
            raise HTTPException(
                400,
                f"Duplicate participant id '{pid}'. "
                "Edit the label or rename the file so each id is unique.",
            )
        seen.add(pid)
        resolved_ids.append(pid)

    all_themes: list[dict] = []
    participants: set[str] = set()
    total_dropped = 0

    for idx, f in enumerate(files):
        if not f.filename:
            raise HTTPException(400, "File missing filename")

        ext = Path(f.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                400,
                f"Unsupported file type: {f.filename} "
                f"(allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))})",
            )

        content = await f.read()
        if len(content) == 0:
            raise HTTPException(400, f"Empty file: {f.filename}")

        cap = MAX_TEXT_BYTES if ext in TEXT_EXTENSIONS else MAX_AUDIO_BYTES
        if len(content) > cap:
            raise HTTPException(
                413,
                f"File too large: {f.filename} "
                f"({len(content) / 1_048_576:.1f} MB > {cap / 1_048_576:.0f} MB cap)",
            )

        if ext in TEXT_EXTENSIONS:
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError as e:
                raise HTTPException(
                    400, f"File not valid UTF-8: {f.filename}"
                ) from e
        else:
            # Audio path: transcribe to text via Whisper, then feed into
            # the existing extraction pipeline. Upstream API errors surface
            # as 502 so the frontend can distinguish them from validation.
            try:
                text = transcribe_bytes(content, f.filename)
            except ValueError as e:
                raise HTTPException(413, str(e)) from e
            except Exception as e:  # openai errors, network, etc.
                raise HTTPException(
                    502, f"Transcription failed for {f.filename}: {e}"
                ) from e
            if not text.strip():
                raise HTTPException(
                    422,
                    f"Whisper returned empty transcript for {f.filename}; "
                    "check that the file contains speech.",
                )

        # Participant ids were resolved + dedup'd in the first pass above.
        participant_id = resolved_ids[idx]
        participants.add(participant_id)

        verified, dropped = extract_from_text(text, participant_id)
        total_dropped += dropped
        for theme in verified:
            theme["participant_id"] = participant_id
        all_themes.extend(verified)

    if not all_themes:
        raise HTTPException(
            422, "No themes could be extracted from the provided transcripts"
        )

    clusters = cluster_themes_cached(all_themes)
    insights = generate_insights_cached(clusters)
    markdown = render_markdown(clusters, insights)

    return SynthesizeResponse(
        markdown=markdown,
        cluster_count=len(clusters),
        participant_count=len(participants),
        themes_extracted=len(all_themes),
        themes_dropped=total_dropped,
    )
