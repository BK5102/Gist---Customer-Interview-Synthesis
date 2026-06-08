# Database helpers for Supabase Postgres.
# Uses the service-role key so RLS is bypassed; we enforce user ownership
# in Python before calling these functions.
import os
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable, TypeVar

import httpx
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from supabase import create_client, Client

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=True)

_supabase: Client | None = None
NOTION_TOKEN_PREFIX = "fernet:v1:"


def _is_production() -> bool:
    env_values = [
        os.environ.get("APP_ENV", ""),
        os.environ.get("ENVIRONMENT", ""),
        os.environ.get("RAILWAY_ENVIRONMENT", ""),
        os.environ.get("RAILWAY_ENVIRONMENT_NAME", ""),
    ]
    return any(v.strip().lower() in {"prod", "production"} for v in env_values)


def _notion_token_fernet() -> Fernet | None:
    key = os.environ.get("NOTION_TOKEN_ENCRYPTION_KEY", "").strip()
    if not key:
        if _is_production():
            raise RuntimeError("NOTION_TOKEN_ENCRYPTION_KEY must be set in production")
        return None
    try:
        return Fernet(key.encode("utf-8"))
    except Exception as e:
        raise RuntimeError("NOTION_TOKEN_ENCRYPTION_KEY is not a valid Fernet key") from e


def _encrypt_notion_token(access_token: str) -> str:
    fernet = _notion_token_fernet()
    if fernet is None:
        return access_token
    encrypted = fernet.encrypt(access_token.encode("utf-8")).decode("utf-8")
    return f"{NOTION_TOKEN_PREFIX}{encrypted}"


def _decrypt_notion_token(stored_token: str) -> str:
    if not stored_token.startswith(NOTION_TOKEN_PREFIX):
        return stored_token
    fernet = _notion_token_fernet()
    if fernet is None:
        raise RuntimeError("NOTION_TOKEN_ENCRYPTION_KEY is required for this token")
    token = stored_token.removeprefix(NOTION_TOKEN_PREFIX)
    try:
        return fernet.decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as e:
        raise RuntimeError("Stored Notion token could not be decrypted") from e


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


def _reset_db_client() -> None:
    """Force a fresh Supabase client on the next call.

    PostgREST runs on HTTP/2 and the underlying httpx client pools
    connections. When Supabase closes an idle stream we sometimes see a
    `httpx.RemoteProtocolError: ConnectionTerminated error_code:1` on the
    next request from a stale pooled connection. Dropping the client
    forces a new one with fresh sockets.
    """
    global _supabase
    _supabase = None


T = TypeVar("T")


def _with_db_retry(fn: Callable[..., T]) -> Callable[..., T]:
    """Retry once on stale-connection errors from Supabase's HTTP/2 client."""

    @wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> T:
        try:
            return fn(*args, **kwargs)
        except (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadError):
            # Connection died mid-request; nuke the pool and try once more.
            _reset_db_client()
            return fn(*args, **kwargs)

    return wrapper


def db_available() -> bool:
    """Return True if Supabase service-role credentials are configured."""
    return bool(
        os.environ.get("SUPABASE_URL", "").strip()
        and os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    )


@_with_db_retry
def create_project(user_id: str, name: str) -> dict[str, Any]:
    """Create a project for a user. Returns the created row."""
    resp = _db().table("projects").insert({"user_id": user_id, "name": name}).execute()
    return resp.data[0]


@_with_db_retry
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


@_with_db_retry
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


@_with_db_retry
def update_project(user_id: str, project_id: str, description: str | None) -> dict[str, Any] | None:
    """Update mutable fields on a project. Currently only description."""
    resp = (
        _db()
        .table("projects")
        .update({"description": description})
        .eq("id", project_id)
        .eq("user_id", user_id)
        .execute()
    )
    return resp.data[0] if resp.data else None


@_with_db_retry
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


@_with_db_retry
def get_transcripts_for_project(user_id: str, project_id: str) -> list[dict[str, Any]]:
    """List transcripts for a project, scoped to the requesting user."""
    resp = (
        _db()
        .table("transcripts")
        .select("*, projects!inner(user_id)")
        .eq("project_id", project_id)
        .eq("projects.user_id", user_id)
        .order("created_at")
        .execute()
    )
    return resp.data or []


@_with_db_retry
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


@_with_db_retry
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


@_with_db_retry
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


@_with_db_retry
def get_syntheses_for_project(user_id: str, project_id: str) -> list[dict[str, Any]]:
    """List syntheses for a project, scoped to the requesting user."""
    resp = (
        _db()
        .table("syntheses")
        .select("*, projects!inner(user_id)")
        .eq("project_id", project_id)
        .eq("projects.user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return resp.data or []


# ─── notion_connections ────────────────────────────────────────────────────

@_with_db_retry
def get_notion_connection(user_id: str) -> dict[str, Any] | None:
    """Fetch the Notion connection for a user, if any."""
    resp = (
        _db()
        .table("notion_connections")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    if not resp.data:
        return None
    row = resp.data[0]
    row["access_token"] = _decrypt_notion_token(row["access_token"])
    return row


@_with_db_retry
def save_notion_connection(
    user_id: str,
    access_token: str,
    workspace_id: str | None = None,
    workspace_name: str | None = None,
) -> dict[str, Any]:
    """Upsert a Notion connection for the user."""
    payload = {
        "user_id": user_id,
        "access_token": _encrypt_notion_token(access_token),
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


@_with_db_retry
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


@_with_db_retry
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


@_with_db_retry
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


@_with_db_retry
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
