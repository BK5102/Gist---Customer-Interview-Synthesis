# FastAPI entry point — POST /synthesize, GET /health
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from synth.cluster import cluster_themes_cached
from synth.extract import extract_from_text
from synth.format import render_markdown
from synth.insights import generate_insights_cached

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=True)

MAX_FILE_BYTES = 2 * 1024 * 1024  # 2 MB per file — transcripts are text
MAX_FILES_PER_REQUEST = 20
ALLOWED_EXTENSIONS = {".txt"}

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
async def synthesize(files: list[UploadFile]) -> SynthesizeResponse:
    if not files:
        raise HTTPException(400, "No files provided")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            400, f"Too many files (max {MAX_FILES_PER_REQUEST} per request)"
        )

    all_themes: list[dict] = []
    participants: set[str] = set()
    total_dropped = 0

    for f in files:
        if not f.filename:
            raise HTTPException(400, "File missing filename")

        ext = Path(f.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                400,
                f"Unsupported file type: {f.filename} "
                f"(only {', '.join(sorted(ALLOWED_EXTENSIONS))} in v0)",
            )

        content = await f.read()
        if len(content) > MAX_FILE_BYTES:
            raise HTTPException(
                413, f"File too large: {f.filename} (>{MAX_FILE_BYTES} bytes)"
            )
        if len(content) == 0:
            raise HTTPException(400, f"Empty file: {f.filename}")

        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError as e:
            raise HTTPException(
                400, f"File not valid UTF-8: {f.filename}"
            ) from e

        participant_id = Path(f.filename).stem
        if participant_id in participants:
            raise HTTPException(
                400,
                f"Duplicate participant id '{participant_id}'. "
                "Rename files so each stem is unique.",
            )
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
