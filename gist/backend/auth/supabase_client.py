# Phase 2: Supabase JWT verification middleware.
# Fetches and caches the Supabase JWKS to verify Bearer tokens from the frontend.
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
import jwt
from dotenv import load_dotenv
from fastapi import HTTPException, Request
from fastapi.security import HTTPBearer

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env", override=True)

security = HTTPBearer(auto_error=False)

# JWT claim cache (ttl in seconds)
_JWKS_CACHE: dict[str, Any] = {}
_JWKS_CACHE_TTL = 300  # 5 minutes
_JWKS_FETCHED_AT = 0.0


def _supabase_url() -> str:
    url = os.environ.get("SUPABASE_URL", "").strip()
    if not url:
        raise RuntimeError("SUPABASE_URL not configured")
    return url.rstrip("/")


def _jwks_uri() -> str:
    return f"{_supabase_url()}/.well-known/jwks.json"


def _fetch_jwks() -> dict:
    """Fetch JWKS from Supabase. Cached for _JWKS_CACHE_TTL seconds."""
    global _JWKS_CACHE, _JWKS_FETCHED_AT
    now = time.time()
    if _JWKS_CACHE and (now - _JWKS_FETCHED_AT) < _JWKS_CACHE_TTL:
        return _JWKS_CACHE

    try:
        resp = httpx.get(_jwks_uri(), timeout=10.0)
        resp.raise_for_status()
        _JWKS_CACHE = resp.json()
        _JWKS_FETCHED_AT = now
        return _JWKS_CACHE
    except Exception as e:
        # If we have a stale cache, use it as a fallback during JWKS refresh issues.
        if _JWKS_CACHE:
            return _JWKS_CACHE
        raise RuntimeError(f"Could not fetch Supabase JWKS: {e}")


def _get_signing_key(token: str) -> jwt.PyJWK:
    jwks = _fetch_jwks()
    signing_keys = jwt.PyJWKSet(jwks.get("keys", []))
    unverified_header = jwt.get_unverified_header(token)
    kid = unverified_header.get("kid")
    if not kid:
        raise jwt.InvalidTokenError("JWT header missing 'kid'")
    return signing_keys.find_by_key_id(kid)


def verify_token(token: str) -> dict[str, Any]:
    """Verify a Supabase JWT access token.

    Returns the decoded payload on success. Raises HTTPException(401) on failure.
    """
    try:
        signing_key = _get_signing_key(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience="authenticated",
            issuer=f"{_supabase_url()}/",
            options={"require": ["exp", "iat", "sub"]},
        )
        return payload
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status_code=401, detail="Token expired") from e
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}") from e
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Auth error: {e}") from e


async def require_auth(request: Request) -> str:
    """FastAPI dependency that extracts and verifies the Supabase JWT.

    Returns the user's UUID (sub claim). Raises 401 if missing or invalid.
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    token = auth_header[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty Bearer token")

    payload = verify_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="JWT missing sub claim")

    return user_id
