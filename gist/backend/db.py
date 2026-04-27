# Database helpers for Supabase Postgres.
# Uses the service-role key so RLS is bypassed; we enforce user ownership
# in Python before calling these functions.
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import create_client, Client

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=True)

_supabase: Client | None = None


def _db() -> Client:
    global _supabase
    if _supabase is None:
        _url = os.environ.get("SUPABASE_URL", "").strip()
        _key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not _url or not _key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env"
            )
        _supabase = create_client(_url, _key)
    return _supabase


def db_available() -> bool:
    """Return True if Supabase service-role credentials are configured."""
    return bool(
        os.environ.get("SUPABASE_URL", "").strip()
        and os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )


def create_project(user_id: str, name: str) -> dict[str, Any]:
    """Create a project for a user. Returns the created row."""
    resp = _db().table("projects").insert({"user_id": user_id, "name": name}).execute()
    return resp.data[0]


def get_projects(user_id: str) -> list[dict[str, Any]]:
    """List all projects for a user, newest first."""
    resp = (
        _db()
        .table("projects")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return resp.data or []


def get_project(user_id: str, project_id: str) -> dict[str, Any] | None:
    """Fetch a single project if it belongs to the user."""
    resp = (
        _db()
        .table("projects")
        .select("*")
        .eq("id", project_id)
        .eq("user_id", user_id)
        .execute()
    )
    return resp.data[0] if resp.data else None


def save_transcript(
    project_id: str,
    filename: str,
    content: str,
    participant_label: str | None = None,
    source_type: str = "text_upload",
    audio_url: str | None = None,
    duration_seconds: int | None = None,
) -> dict[str, Any]:
    """Save a transcript row. Returns the created row."""
    resp = (
        _db()
        .table("transcripts")
        .insert(
            {
                "project_id": project_id,
                "filename": filename,
                "participant_label": participant_label,
                "content": content,
                "source_type": source_type,
                "audio_url": audio_url,
                "duration_seconds": duration_seconds,
            }
        )
        .execute()
    )
    return resp.data[0]


def get_transcripts_for_project(project_id: str) -> list[dict[str, Any]]:
    """List transcripts for a project, in creation order."""
    resp = (
        _db()
        .table("transcripts")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at")
        .execute()
    )
    return resp.data or []


def save_synthesis(
    project_id: str,
    markdown_output: str,
    transcript_ids: list[str],
    themes_json: list[dict[str, Any]] | None = None,
    model_used: str | None = None,
    cost_cents: int | None = None,
) -> dict[str, Any]:
    """Save a synthesis row. Returns the created row."""
    resp = (
        _db()
        .table("syntheses")
        .insert(
            {
                "project_id": project_id,
                "markdown_output": markdown_output,
                "themes_json": themes_json,
                "transcript_ids": transcript_ids,
                "model_used": model_used,
                "cost_cents": cost_cents,
            }
        )
        .execute()
    )
    return resp.data[0]


def get_syntheses_for_user(user_id: str) -> list[dict[str, Any]]:
    """List syntheses across all projects for a user, newest first."""
    resp = (
        _db()
        .table("syntheses")
        .select("*, projects!inner(user_id)")
        .eq("projects.user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return resp.data or []


def get_synthesis(user_id: str, synthesis_id: str) -> dict[str, Any] | None:
    """Fetch a single synthesis if it belongs to the user."""
    resp = (
        _db()
        .table("syntheses")
        .select("*, projects!inner(user_id)")
        .eq("id", synthesis_id)
        .eq("projects.user_id", user_id)
        .execute()
    )
    return resp.data[0] if resp.data else None


def get_syntheses_for_project(project_id: str) -> list[dict[str, Any]]:
    """List syntheses for a project."""
    resp = (
        _db()
        .table("syntheses")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .execute()
    )
    return resp.data or []
