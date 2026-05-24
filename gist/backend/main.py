# FastAPI entry point — POST /synthesize, GET /jobs/{job_id}, GET /health
import os
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from auth.supabase_client import require_auth
from db import (
    create_project,
    db_available,
    get_project,
    get_projects,
    get_synthesis,
    get_syntheses_for_project,
    get_syntheses_for_user,
    save_synthesis,
    save_transcript,
)
from synth.cluster import cluster_themes, cluster_themes_cached
from synth.extract import extract_from_text
from synth.format import render_markdown
from synth.insights import generate_insights, generate_insights_cached
from transcribe.whisper import MAX_AUDIO_BYTES as WHISPER_AUDIO_BYTES
from transcribe.whisper import transcribe_bytes

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=True)

MAX_FILES_PER_REQUEST = int(os.environ.get("MAX_FILES_PER_REQUEST", "10"))
MAX_TOTAL_UPLOAD_BYTES = int(os.environ.get("MAX_TOTAL_UPLOAD_MB", "100")) * 1024 * 1024
MAX_SYNTH_JOBS_PER_WINDOW = int(os.environ.get("MAX_SYNTH_JOBS_PER_WINDOW", "5"))
SYNTH_RATE_WINDOW_SECONDS = int(os.environ.get("SYNTH_RATE_WINDOW_SECONDS", "600"))
MAX_ACTIVE_JOBS_PER_USER = int(os.environ.get("MAX_ACTIVE_JOBS_PER_USER", "2"))
JOB_RETENTION_SECONDS = int(os.environ.get("JOB_RETENTION_SECONDS", "3600"))

# Per-type size caps. Text transcripts are tiny; audio is bounded by
# Whisper's upstream limits and our own memory budget.
TEXT_EXTENSIONS = {".txt"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".webm", ".mpeg", ".mpga"}
ALLOWED_EXTENSIONS = TEXT_EXTENSIONS | AUDIO_EXTENSIONS

MAX_TEXT_BYTES = 2 * 1024 * 1024  # 2 MB
MAX_AUDIO_BYTES = min(
    WHISPER_AUDIO_BYTES,
    int(os.environ.get("MAX_AUDIO_UPLOAD_MB", "50")) * 1024 * 1024,
)
STORE_TRANSCRIPTS = os.environ.get("STORE_TRANSCRIPTS", "false").lower() == "true"
ENABLE_SYNTH_CACHE = os.environ.get("ENABLE_SYNTH_CACHE", "false").lower() == "true"
STORE_PLAINTEXT_SYNTHESES = (
    os.environ.get("STORE_PLAINTEXT_SYNTHESES", "false").lower() == "true"
)

# Comma-separated list of allowed CORS origins. Defaults to local dev.
# Production: set CORS_ORIGINS=https://your-vercel-domain.vercel.app
_cors_env = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)
CORS_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()]

app = FastAPI(title="Gist — Interview Synthesis API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=()",
    )
    return response


# ─── job state ──────────────────────────────────────────────────────────────
# In-memory job store. Phase-2 swaps in Postgres so jobs survive restarts.
# Single-process uvicorn is fine for v0; multi-worker setups would need a
# shared store (Redis) anyway.
JOBS: dict[str, dict[str, Any]] = {}
SYNTH_RATE_LIMITS: dict[str, deque[float]] = defaultdict(deque)
NOTION_RATE_LIMITS: dict[str, deque[float]] = defaultdict(deque)
ACTIVE_JOB_STATUSES = {"queued", "transcribing", "extracting", "clustering", "insights"}

MAX_NOTION_CALLS_PER_WINDOW = int(os.environ.get("MAX_NOTION_CALLS_PER_WINDOW", "20"))
NOTION_RATE_WINDOW_SECONDS = int(os.environ.get("NOTION_RATE_WINDOW_SECONDS", "60"))


def _is_production() -> bool:
    env_values = [
        os.environ.get("APP_ENV", ""),
        os.environ.get("ENVIRONMENT", ""),
        os.environ.get("RAILWAY_ENVIRONMENT", ""),
        os.environ.get("RAILWAY_ENVIRONMENT_NAME", ""),
    ]
    return any(v.strip().lower() in {"prod", "production"} for v in env_values)


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _prune_jobs() -> None:
    cutoff = time.time() - JOB_RETENTION_SECONDS
    stale = [
        job_id
        for job_id, job in JOBS.items()
        if job.get("updated_at", job.get("created_at", 0)) < cutoff
        and job.get("status") not in ACTIVE_JOB_STATUSES
    ]
    for job_id in stale:
        JOBS.pop(job_id, None)


def _active_jobs_for_user(user_id: str) -> int:
    return sum(
        1
        for job in JOBS.values()
        if job.get("user_id") == user_id and job.get("status") in ACTIVE_JOB_STATUSES
    )


def _enforce_synthesis_limits(user_id: str) -> None:
    _prune_jobs()
    now = time.time()
    window_start = now - SYNTH_RATE_WINDOW_SECONDS
    attempts = SYNTH_RATE_LIMITS[user_id]
    while attempts and attempts[0] < window_start:
        attempts.popleft()
    if len(attempts) >= MAX_SYNTH_JOBS_PER_WINDOW:
        raise HTTPException(
            429,
            "Too many synthesis requests. Please wait a few minutes and try again.",
        )
    if _active_jobs_for_user(user_id) >= MAX_ACTIVE_JOBS_PER_USER:
        raise HTTPException(
            429,
            "You already have synthesis jobs running. Wait for one to finish before starting another.",
        )
    attempts.append(now)


def _enforce_notion_limits(user_id: str) -> None:
    now = time.time()
    window_start = now - NOTION_RATE_WINDOW_SECONDS
    attempts = NOTION_RATE_LIMITS[user_id]
    while attempts and attempts[0] < window_start:
        attempts.popleft()
    if len(attempts) >= MAX_NOTION_CALLS_PER_WINDOW:
        raise HTTPException(429, "Too many Notion requests. Please wait a minute and try again.")
    attempts.append(now)


def _set_job(job_id: str, **fields: Any) -> None:
    """Atomically merge fields into a job's state."""
    fields["updated_at"] = time.time()
    JOBS[job_id].update(fields)


def _set_file_status(
    job_id: str,
    participant_id: str,
    status: str,
    error_filename: str | None = None,
) -> None:
    """Update the status of a single file in the job's file_progress list."""
    fp = JOBS[job_id].get("file_progress")
    if fp is None:
        return
    for item in fp:
        # file_progress may contain plain dicts or Pydantic model instances
        # depending on whether the route has validated the job dict.
        pid = (
            item["participant_id"]
            if isinstance(item, dict)
            else getattr(item, "participant_id", None)
        )
        if pid == participant_id:
            if isinstance(item, dict):
                item["status"] = status
                if error_filename:
                    item["filename"] = error_filename
            else:
                setattr(item, "status", status)
                if error_filename:
                    setattr(item, "filename", error_filename)
            break


# ─── response models ────────────────────────────────────────────────────────
class SynthesizeResult(BaseModel):
    markdown: str
    cluster_count: int
    participant_count: int
    themes_extracted: int
    themes_dropped: int
    project_id: str | None = None
    synthesis_id: str | None = None


class JobStartResponse(BaseModel):
    job_id: str
    status: str  # "queued"


class FileProgress(BaseModel):
    filename: str
    participant_id: str
    status: str  # pending | transcribing | extracted | error


class JobStatusResponse(BaseModel):
    job_id: str
    status: str  # queued | transcribing | extracting | clustering | insights | done | error
    current: int | None = None
    total: int | None = None
    file_progress: list[FileProgress] | None = None
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
    project_id: str | None = None,
    user_id: str = Depends(require_auth),
) -> JobStartResponse:
    """Validate inputs, kick off the synthesis pipeline as a background job.

    Returns 202 Accepted with a job_id immediately; the client polls
    GET /jobs/{job_id} for progress and the final result.
    """
    _enforce_synthesis_limits(user_id)
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
    total_upload_bytes = 0
    for idx, f in enumerate(files):
        ext = Path(f.filename or "").suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                400,
                f"Unsupported file type: {f.filename} "
                f"(allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))})",
            )

        content = await f.read()
        total_upload_bytes += len(content)
        if total_upload_bytes > MAX_TOTAL_UPLOAD_BYTES:
            raise HTTPException(
                413,
                "Upload is too large for one synthesis request "
                f"({total_upload_bytes / 1_048_576:.1f} MB > "
                f"{MAX_TOTAL_UPLOAD_BYTES / 1_048_576:.0f} MB cap).",
            )
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
                "content": content if ext in AUDIO_EXTENSIONS else b"",
                "text": text,  # None for audio until transcribed
                "participant_id": resolved_ids[idx],
            }
        )

    # Resolve or create project.
    if db_available():
        if project_id:
            proj = get_project(user_id, project_id)
            if not proj:
                raise HTTPException(
                    404, f"Project {project_id} not found or access denied"
                )
            resolved_project_id = project_id
        else:
            first_name = prepared[0]["filename"]
            proj_name = f"Synthesis {first_name}"
            proj = create_project(user_id, proj_name)
            resolved_project_id = proj["id"]
    else:
        resolved_project_id = project_id or ""

    job_id = uuid.uuid4().hex[:12]
    now = time.time()
    JOBS[job_id] = {
        "job_id": job_id,
        "user_id": user_id,
        "project_id": resolved_project_id,
        "created_at": now,
        "updated_at": now,
        "status": "queued",
        "current": None,
        "total": None,
        "file_progress": [
            {
                "filename": p["filename"],
                "participant_id": p["participant_id"],
                "status": "pending",
            }
            for p in prepared
        ],
        "result": None,
        "error": None,
    }
    background_tasks.add_task(
        _run_pipeline, job_id, prepared, user_id, resolved_project_id
    )
    return JobStartResponse(job_id=job_id, status="queued")


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(
    job_id: str,
    user_id: str = Depends(require_auth),
) -> JobStatusResponse:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, f"Unknown job id: {job_id}")
    if job.get("user_id") != user_id:
        raise HTTPException(404, f"Unknown job id: {job_id}")
    return JobStatusResponse(**job)


# ─── pipeline ───────────────────────────────────────────────────────────────
def _run_pipeline(
    job_id: str,
    prepared: list[dict[str, Any]],
    user_id: str,
    project_id: str,
) -> None:
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
            _set_file_status(job_id, p["participant_id"], "transcribing")
            try:
                p["text"] = transcribe_bytes(p["content"], p["filename"])
                p["content"] = b""
            except ValueError as e:
                p["content"] = b""
                _set_file_status(job_id, p["participant_id"], "error")
                _set_job(job_id, status="error", error=str(e))
                return
            except Exception as e:  # openai/groq errors, network, etc.
                p["content"] = b""
                _set_file_status(job_id, p["participant_id"], "error")
                _set_job(
                    job_id,
                    status="error",
                    error=f"Transcription failed for {p['filename']}: {e}",
                )
                return
            if not (p["text"] or "").strip():
                _set_file_status(job_id, p["participant_id"], "error")
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
        transcript_rows: list[dict[str, Any]] = []
        for k, p in enumerate(prepared, 1):
            _set_job(job_id, status="extracting", current=k, total=len(prepared))
            _set_file_status(job_id, p["participant_id"], "extracting")
            verified, dropped = extract_from_text(p["text"], p["participant_id"])
            total_dropped += dropped
            for theme in verified:
                theme["participant_id"] = p["participant_id"]
            all_themes.extend(verified)
            _set_file_status(job_id, p["participant_id"], "extracted")

            # Raw transcripts are not persisted by default. Keeping them out
            # of Supabase means project operators cannot read user transcripts
            # from the dashboard or with the service-role key.
            if STORE_TRANSCRIPTS and db_available() and project_id:
                try:
                    row = save_transcript(
                        project_id=project_id,
                        filename=p["filename"],
                        content=p["text"],
                        participant_label=p["participant_id"],
                        source_type="audio_upload" if p["ext"] in AUDIO_EXTENSIONS else "text_upload",
                    )
                    transcript_rows.append(row)
                except Exception:
                    # Don't fail the pipeline if DB write fails; log and continue.
                    import logging
                    logging.getLogger("gist").exception("Failed to save transcript")
            else:
                p["text"] = None

        if not all_themes:
            _set_job(
                job_id,
                status="error",
                error="No themes could be extracted from the provided transcripts.",
            )
            return

        # 3. Cluster + 4. insights + 5. render.
        _set_job(job_id, status="clustering", current=None, total=None)
        clusters = (
            cluster_themes_cached(all_themes)
            if ENABLE_SYNTH_CACHE
            else cluster_themes(all_themes)
        )

        _set_job(job_id, status="insights")
        insights = (
            generate_insights_cached(clusters)
            if ENABLE_SYNTH_CACHE
            else generate_insights(clusters)
        )
        markdown = render_markdown(clusters, insights)

        # Synthesis markdown can contain verbatim customer quotes. Do not
        # persist it in plaintext unless the operator explicitly opts in.
        synthesis_id: str | None = None
        if STORE_PLAINTEXT_SYNTHESES and db_available() and project_id:
            try:
                t_ids = [r["id"] for r in transcript_rows]
                synth_row = save_synthesis(
                    project_id=project_id,
                    markdown_output=markdown,
                    transcript_ids=t_ids,
                    themes_json=clusters,
                    model_used="claude-sonnet-4-6",
                )
                synthesis_id = synth_row["id"]
            except Exception:
                import logging
                logging.getLogger("gist").exception("Failed to save synthesis")

        _set_job(
            job_id,
            status="done",
            result={
                "markdown": markdown,
                "cluster_count": len(clusters),
                "participant_count": len({p["participant_id"] for p in prepared}),
                "themes_extracted": len(all_themes),
                "themes_dropped": total_dropped,
                "project_id": project_id or None,
                "synthesis_id": synthesis_id,
            },
        )
    except Exception as e:  # last-resort: keep job dict consistent
        _set_job(
            job_id,
            status="error",
            error=f"Pipeline crashed: {e!r}",
        )


# ─── projects API ───────────────────────────────────────────────────────────
class CreateProjectRequest(BaseModel):
    name: str


@app.get("/projects")
def list_projects(user_id: str = Depends(require_auth)) -> list[dict[str, Any]]:
    if not db_available():
        raise HTTPException(503, "Database not configured")
    return get_projects(user_id)


@app.post("/projects", status_code=201)
def create_project_endpoint(
    body: CreateProjectRequest,
    user_id: str = Depends(require_auth),
) -> dict[str, Any]:
    if not db_available():
        raise HTTPException(503, "Database not configured")
    return create_project(user_id, body.name)


@app.get("/projects/{project_id}")
def get_project_detail(
    project_id: str,
    user_id: str = Depends(require_auth),
) -> dict[str, Any]:
    if not db_available():
        raise HTTPException(503, "Database not configured")
    proj = get_project(user_id, project_id)
    if not proj:
        raise HTTPException(404, "Project not found")
    proj["syntheses"] = get_syntheses_for_project(user_id, project_id)
    return proj


@app.get("/syntheses/{synthesis_id}")
def get_synthesis_detail(
    synthesis_id: str,
    user_id: str = Depends(require_auth),
) -> dict[str, Any]:
    if not db_available():
        raise HTTPException(503, "Database not configured")
    synth = get_synthesis(user_id, synthesis_id)
    if not synth:
        raise HTTPException(404, "Synthesis not found")
    return synth


# ─── Notion integration ─────────────────────────────────────────────────────
from integrations.notion import (
    auth_url,
    exchange_code,
    fetch_bot_info,
    get_internal_token,
    markdown_to_notion_blocks,
    notion_configured,
    notion_internal_configured,
    notion_oauth_configured,
    NotionClient,
)
from db import (
    consume_oauth_state,
    create_oauth_state,
    delete_notion_connection,
    get_notion_connection,
    purge_expired_oauth_states,
    save_notion_connection,
)


def _notion_redirect_uri() -> str:
    return os.environ.get("NOTION_REDIRECT_URI", "http://localhost:8000/notion/callback")


def _frontend_settings_url() -> str:
    return os.environ.get("FRONTEND_SETTINGS_URL", "http://localhost:3000/settings")


@app.get("/notion/auth")
def notion_auth(user_id: str = Depends(require_auth)) -> dict[str, Any]:
    """Start a Notion connection for the current user.

    Two modes, picked by what's configured in backend/.env:

      * OAuth (Public integration) — preferred for production. Mints a CSRF
        nonce, returns {mode: "oauth", auth_url} and the frontend redirects
        the user to Notion's consent screen.

      * Internal token — used for solo/local dev when Notion's marketplace-
        profile requirements block a Public integration. Validates the env
        token by hitting /users/me, saves the connection inline, and
        returns {mode: "internal", connected: true, workspace_name}.
    """
    if not notion_configured():
        raise HTTPException(
            503,
            "Notion integration not configured. Set NOTION_CLIENT_ID + "
            "NOTION_CLIENT_SECRET (OAuth) or NOTION_INTERNAL_TOKEN "
            "(internal integration) in backend/.env.",
        )
    if (
        notion_internal_configured()
        and not notion_oauth_configured()
        and _is_production()
        and not _env_flag("ALLOW_NOTION_INTERNAL_TOKEN_IN_PROD")
    ):
        raise HTTPException(
            503,
            "Notion internal-token mode is disabled in production. Configure "
            "NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, and NOTION_REDIRECT_URI "
            "for per-user OAuth.",
        )

    # Prefer OAuth when both are configured — it's the right thing for
    # multi-tenant production.
    if notion_oauth_configured():
        try:
            purge_expired_oauth_states()
        except Exception:  # noqa: BLE001 — purge is best-effort
            pass
        state = create_oauth_state(user_id=user_id, provider="notion")
        url = auth_url(_notion_redirect_uri(), state)
        return {"mode": "oauth", "auth_url": url}

    # Internal token path — validate, then save as if OAuth had completed.
    assert notion_internal_configured()
    token = get_internal_token()
    try:
        bot = fetch_bot_info(token)
    except Exception as e:  # noqa: BLE001 — surface a useful 502 either way
        raise HTTPException(
            502,
            f"Failed to validate NOTION_INTERNAL_TOKEN with Notion: {e}",
        ) from e

    workspace_name = bot.get("bot", {}).get("workspace_name") or bot.get(
        "workspace_name"
    )
    workspace_id = bot.get("bot", {}).get("workspace_id") or bot.get(
        "workspace_id"
    )
    save_notion_connection(
        user_id=user_id,
        access_token=token,
        workspace_id=workspace_id,
        workspace_name=workspace_name,
    )
    return {
        "mode": "internal",
        "connected": True,
        "workspace_name": workspace_name,
    }


@app.get("/notion/callback")
def notion_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> Any:
    if error:
        return {"error": error}
    if not code or not state:
        raise HTTPException(400, "Missing code or state")

    # Validate the CSRF nonce we issued in /notion/auth. consume_oauth_state
    # returns None when the state is unknown, expired, or for a different
    # provider — and always deletes it so the nonce is single-use.
    user_id = consume_oauth_state(state, "notion")
    if not user_id:
        raise HTTPException(
            400,
            "Invalid or expired OAuth state. Restart the connect flow from "
            "Settings.",
        )

    try:
        token_resp = exchange_code(code, _notion_redirect_uri())
    except Exception as e:
        raise HTTPException(400, f"Notion token exchange failed: {e}") from e

    access_token = token_resp.get("access_token")
    workspace_id = token_resp.get("workspace_id")
    workspace_name = token_resp.get("workspace_name")

    if not access_token:
        raise HTTPException(400, "No access_token in Notion response")

    save_notion_connection(
        user_id=user_id,
        access_token=access_token,
        workspace_id=workspace_id,
        workspace_name=workspace_name,
    )

    from fastapi.responses import RedirectResponse

    return RedirectResponse(_frontend_settings_url(), status_code=302)


@app.get("/notion/databases")
def list_notion_databases(user_id: str = Depends(require_auth)) -> list[dict[str, Any]]:
    _enforce_notion_limits(user_id)
    conn = get_notion_connection(user_id)
    if not conn:
        raise HTTPException(401, "Notion not connected")
    client = NotionClient(conn["access_token"])
    try:
        dbs = client.list_databases()
        return [
            {
                "id": db["id"],
                "title": db.get("title", [{}])[0].get("plain_text", "Untitled"),
            }
            for db in dbs
        ]
    except Exception as e:
        raise HTTPException(502, f"Notion API error: {e}") from e


class PushToNotionRequest(BaseModel):
    synthesis_id: str
    database_id: str


@app.post("/notion/push")
def push_to_notion(
    body: PushToNotionRequest,
    user_id: str = Depends(require_auth),
) -> dict[str, str]:
    _enforce_notion_limits(user_id)
    conn = get_notion_connection(user_id)
    if not conn:
        raise HTTPException(401, "Notion not connected")

    synth = get_synthesis(user_id, body.synthesis_id)
    if not synth:
        raise HTTPException(404, "Synthesis not found")

    client = NotionClient(conn["access_token"])
    blocks = markdown_to_notion_blocks(synth["markdown_output"])

    try:
        page = client.create_page(
            database_id=body.database_id,
            title=f"Interview Synthesis — {synth.get('created_at', '')[:10]}",
            blocks=blocks,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise HTTPException(401, "Notion token revoked; please reconnect.")
        if e.response.status_code == 404:
            raise HTTPException(404, "Notion database not found or deleted.")
        raise HTTPException(502, f"Notion API error: {e}") from e
    except Exception as e:
        raise HTTPException(502, f"Notion API error: {e}") from e

    return {
        "notion_page_id": page["id"],
        "notion_page_url": page.get("url", ""),
    }


@app.get("/notion/connection")
def notion_connection_status(
    user_id: str = Depends(require_auth),
) -> dict[str, Any]:
    """Cheap connection check — one DB read, no Notion API call.

    Used by Settings + Synthesis pages to render the right UI without
    hitting /notion/databases (which proxies a third-party request).
    """
    conn = get_notion_connection(user_id)
    if not conn:
        return {"connected": False}
    return {
        "connected": True,
        "workspace_id": conn.get("workspace_id"),
        "workspace_name": conn.get("workspace_name"),
    }


@app.delete("/notion/connection")
def disconnect_notion(user_id: str = Depends(require_auth)) -> dict[str, str]:
    delete_notion_connection(user_id)
    return {"status": "disconnected"}
