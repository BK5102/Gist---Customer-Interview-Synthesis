# Database helpers for Supabase Postgres.
# Uses the service-role key so RLS is bypassed; we enforce user ownership
# in Python before calling these functions.
import os
import secrets
from datetime import datetime, timedelta, timezone
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


# ─── notion_connections ────────────────────────────────────────────────────

def get_notion_connection(user_id: str) -> dict[str, Any] | None:
    """Fetch the Notion connection for a user, if any."""
    resp = (
        _db()
        .table("notion_connections")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    return resp.data[0] if resp.data else None


def save_notion_connection(
    user_id: str,
    access_token: str,
    workspace_id: str | None = None,
    workspace_name: str | None = None,
) -> dict[str, Any]:
    """Upsert a Notion connection for the user."""
    payload = {
        "user_id": user_id,
        "access_token": access_token,
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
    }
    resp = (
        _db()
        .table("notion_connections")
        .upsert(payload, on_conflict="user_id")
        .execute()
    )
    return resp.data[0]


def delete_notion_connection(user_id: str) -> None:
    """Remove the Notion connection for a user."""
    (
        _db()
        .table("notion_connections")
        .delete()
        .eq("user_id", user_id)
        .execute()
    )


# ─── oauth_states (CSRF protection) ────────────────────────────────────────
# Issued by GET /<provider>/auth, validated and consumed by /<provider>/callback.
# Single-use, time-limited.

OAUTH_STATE_TTL_MIN = 10


def create_oauth_state(user_id: str, provider: str) -> str:
    """Mint a single-use OAuth state nonce for the given user/provider.

    Returns the opaque state string the caller should embed in the OAuth
    authorize URL. Validates and consumes it via consume_oauth_state on
    the callback side.
    """
    state = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OAUTH_STATE_TTL_MIN)
    (
        _db()
        .table("oauth_states")
        .insert(
            {
                "state": state,
                "user_id": user_id,
                "provider": provider,
                "expires_at": expires_at.isoformat(),
            }
        )
        .execute()
    )
    return state


def consume_oauth_state(state: str, provider: str) -> str | None:
    """Look up an OAuth state nonce, return its user_id, then delete it.

    Returns None when the state is unknown, expired, or for a different
    provider. The row is deleted regardless to make the nonce single-use.
    """
    if not state:
        return None
    resp = (
        _db()
        .table("oauth_states")
        .select("*")
        .eq("state", state)
        .eq("provider", provider)
        .execute()
    )
    row = resp.data[0] if resp.data else None
    # Always delete (single-use) — even on mismatch a noop delete is cheap.
    _db().table("oauth_states").delete().eq("state", state).execute()
    if not row:
        return None
    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        return None
    return row["user_id"]


def purge_expired_oauth_states() -> int:
    """Delete expired oauth_states rows. Returns the count purged.

    Called opportunistically from /notion/auth so the table stays small
    without a separate cron.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    resp = (
        _db()
        .table("oauth_states")
        .delete()
        .lt("expires_at", now_iso)
        .execute()
    )
    return len(resp.data or [])
