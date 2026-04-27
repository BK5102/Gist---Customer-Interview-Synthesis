# FastAPI entry point — POST /synthesize, GET /jobs/{job_id}, GET /health
import os
import traceback
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Form, HTTPException, UploadFile
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


# ─── job state ──────────────────────────────────────────────────────────────
# In-memory job store. Phase-2 swaps in Postgres so jobs survive restarts.
# Single-process uvicorn is fine for v0; multi-worker setups would need a
# shared store (Redis) anyway.
JOBS: dict[str, dict[str, Any]] = {}


def _set_job(job_id: str, **fields: Any) -> None:
    """Atomically merge fields into a job's state."""
    JOBS[job_id].update(fields)


# ─── response models ────────────────────────────────────────────────────────
class SynthesizeResult(BaseModel):
    markdown: str
    cluster_count: int
    participant_count: int
    themes_extracted: int
    themes_dropped: int


class JobStartResponse(BaseModel):
    job_id: str
    status: str  # "queued"


class JobStatusResponse(BaseModel):
    job_id: str
    status: str  # queued | transcribing | extracting | clustering | insights | done | error
    current: int | None = None
    total: int | None = None
    result: SynthesizeResult | None = None
    error: str | None = None


# ─── routes ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/synthesize", status_code=202, response_model=JobStartResponse)
async def synthesize(
    background_tasks: BackgroundTasks,
    files: list[UploadFile],
    labels: list[str] = Form(default=[]),
) -> JobStartResponse:
    """Validate inputs, kick off the synthesis pipeline as a background job.

    Returns 202 Accepted with a job_id immediately; the client polls
    GET /jobs/{job_id} for progress and the final result.
    """
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

    # Resolve participant ids and validate uniqueness up front.
    resolved_ids: list[str] = []
    seen: set[str] = set()
    for idx, f in enumerate(files):
        if not f.filename:
            raise HTTPException(400, "File missing filename")
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

    # Read + validate every file synchronously so 4xx errors return on POST,
    # not in a background job the client would have to discover via polling.
    prepared: list[dict[str, Any]] = []
    for idx, f in enumerate(files):
        ext = Path(f.filename or "").suffix.lower()
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

        # Decode text upfront so UTF-8 errors return 400 instead of vanishing
        # into a job error. Audio bytes pass through to the background task.
        text: str | None = None
        if ext in TEXT_EXTENSIONS:
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError as e:
                raise HTTPException(
                    400, f"File not valid UTF-8: {f.filename}"
                ) from e

        prepared.append(
            {
                "filename": f.filename,
                "ext": ext,
                "content": content,
                "text": text,  # None for audio until transcribed
                "participant_id": resolved_ids[idx],
            }
        )

    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "current": None,
        "total": None,
        "result": None,
        "error": None,
    }
    background_tasks.add_task(_run_pipeline, job_id, prepared)
    return JobStartResponse(job_id=job_id, status="queued")


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, f"Unknown job id: {job_id}")
    return JobStatusResponse(**job)


# ─── pipeline ───────────────────────────────────────────────────────────────
def _run_pipeline(job_id: str, prepared: list[dict[str, Any]]) -> None:
    """Run transcribe → extract → cluster → insights → render in the bg.

    All upstream errors land in JOBS[job_id]["error"] so the client can
    pick them up via GET /jobs/{job_id}.
    """
    try:
        # 1. Transcribe audio files (text files already decoded in route).
        audio_indices = [
            i for i, p in enumerate(prepared) if p["ext"] in AUDIO_EXTENSIONS
        ]
        for k, idx in enumerate(audio_indices, 1):
            _set_job(
                job_id,
                status="transcribing",
                current=k,
                total=len(audio_indices),
            )
            p = prepared[idx]
            try:
                p["text"] = transcribe_bytes(p["content"], p["filename"])
            except ValueError as e:
                _set_job(job_id, status="error", error=str(e))
                return
            except Exception as e:  # openai/groq errors, network, etc.
                _set_job(
                    job_id,
                    status="error",
                    error=f"Transcription failed for {p['filename']}: {e}",
                )
                return
            if not (p["text"] or "").strip():
                _set_job(
                    job_id,
                    status="error",
                    error=(
                        f"Whisper returned empty transcript for {p['filename']}; "
                        "check that the file contains speech."
                    ),
                )
                return

        # 2. Per-file theme extraction (Haiku).
        all_themes: list[dict] = []
        total_dropped = 0
        for k, p in enumerate(prepared, 1):
            _set_job(job_id, status="extracting", current=k, total=len(prepared))
            verified, dropped = extract_from_text(p["text"], p["participant_id"])
            total_dropped += dropped
            for theme in verified:
                theme["participant_id"] = p["participant_id"]
            all_themes.extend(verified)

        if not all_themes:
            _set_job(
                job_id,
                status="error",
                error="No themes could be extracted from the provided transcripts.",
            )
            return

        # 3. Cluster + 4. insights + 5. render.
        _set_job(job_id, status="clustering", current=None, total=None)
        clusters = cluster_themes_cached(all_themes)

        _set_job(job_id, status="insights")
        insights = generate_insights_cached(clusters)
        markdown = render_markdown(clusters, insights)

        _set_job(
            job_id,
            status="done",
            result={
                "markdown": markdown,
                "cluster_count": len(clusters),
                "participant_count": len({p["participant_id"] for p in prepared}),
                "themes_extracted": len(all_themes),
                "themes_dropped": total_dropped,
            },
        )
    except Exception as e:  # last-resort: keep job dict consistent
        _set_job(
            job_id,
            status="error",
            error=f"Pipeline crashed: {e!r}\n{traceback.format_exc()}",
        )
