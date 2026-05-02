# Phase 2: Supabase JWT verification middleware.
#
# Supports two key styles:
#   * Legacy HS256 — older Supabase projects sign tokens with a shared
#     "JWT Secret" (set SUPABASE_JWT_SECRET in backend/.env). No JWKS
#     endpoint, no key rotation; symmetric secret only.
#   * New RS256 / ES256 — newer projects publish JWKS at
#     /auth/v1/.well-known/jwks.json. We fetch + cache the keys and
#     verify with the asymmetric public key.
#
# We prefer HS256 when SUPABASE_JWT_SECRET is set, fall back to JWKS.
# This matches the typical migration path: legacy projects work today,
# upgraded projects get verified via JWKS without code changes.
import os
import time
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


def _jwt_secret() -> str:
    """Legacy HS256 shared secret. Empty string when not configured."""
    return os.environ.get("SUPABASE_JWT_SECRET", "").strip()


def _jwks_uri() -> str:
    # Supabase publishes JWKS under the auth subpath, not the root .well-known.
    return f"{_supabase_url()}/auth/v1/.well-known/jwks.json"


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
    # PyJWT exposes lookup-by-kid via __getitem__, not a named method.
    try:
        return signing_keys[kid]
    except KeyError as e:
        raise jwt.InvalidTokenError(
            f"No signing key in JWKS for kid '{kid}'"
        ) from e


def verify_token(token: str) -> dict[str, Any]:
    """Verify a Supabase JWT access token.

    Returns the decoded payload on success. Raises HTTPException(401) on
    failure. The verification path is picked from the token's own `alg`
    header — Supabase projects can be on legacy HS256 (shared secret) OR
    on new JWT Signing Keys (RS256/ES256 via JWKS), and a single project
    can issue both during migration.
    """
    try:
        # Inspect the token to decide which path to take. PyJWT raises
        # InvalidTokenError for malformed inputs here.
        unverified_header = jwt.get_unverified_header(token)
        alg = unverified_header.get("alg", "").upper()

        if alg == "HS256":
            secret = _jwt_secret()
            if not secret:
                raise jwt.InvalidTokenError(
                    "Token is HS256-signed but SUPABASE_JWT_SECRET is not "
                    "configured. Add it from Supabase → Auth → JWT Keys → "
                    "Legacy JWT Secret."
                )
            payload = jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                audience="authenticated",
                options={"require": ["exp", "iat", "sub"]},
            )
            return payload

        if alg in ("RS256", "ES256"):
            signing_key = _get_signing_key(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                audience="authenticated",
                # Don't pin issuer — Supabase has shipped multiple iss values
                # across project versions (with and without trailing /).
                options={"require": ["exp", "iat", "sub"]},
            )
            return payload

        raise jwt.InvalidTokenError(
            f"Unsupported JWT alg '{alg}' (expected HS256, RS256, or ES256)"
        )
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
