# Notion integration: OAuth + API client + markdown-to-blocks converter
import os
import random
import re
import time
from pathlib import Path
from typing import Any, Callable

import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env", override=True)

NOTION_API_BASE = "https://api.notion.com/v1"
NOTION_OAUTH_AUTHORIZE = "https://api.notion.com/v1/oauth/authorize"
NOTION_OAUTH_TOKEN = "https://api.notion.com/v1/oauth/token"

# Notion API hard limits (https://developers.notion.com/reference/request-limits)
NOTION_MAX_BLOCKS_PER_REQUEST = 100
NOTION_MAX_RICH_TEXT_CHARS = 2000

# Rate-limit handling. Notion enforces ~3 req/sec per integration and
# returns 429 with a Retry-After header when exceeded.
NOTION_MAX_RETRIES = 4
NOTION_INITIAL_BACKOFF_SEC = 1.0
NOTION_MAX_BACKOFF_SEC = 30.0


def _request_with_backoff(
    fn: Callable[[], httpx.Response],
    *,
    max_retries: int = NOTION_MAX_RETRIES,
) -> httpx.Response:
    """Run an HTTP call, honoring 429 Retry-After with exponential backoff.

    Retries on 429 and 5xx responses. Other 4xx errors propagate immediately
    so the caller can map them to user-facing errors. Network errors
    (httpx.RequestError) get one retry with backoff.
    """
    backoff = NOTION_INITIAL_BACKOFF_SEC
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            resp = fn()
        except httpx.RequestError as e:
            last_exc = e
            if attempt >= max_retries:
                raise
            time.sleep(min(backoff, NOTION_MAX_BACKOFF_SEC))
            backoff = min(backoff * 2, NOTION_MAX_BACKOFF_SEC)
            continue

        # Retry on 429 with Retry-After, plus 5xx server errors.
        if resp.status_code == 429 and attempt < max_retries:
            retry_after = resp.headers.get("Retry-After")
            try:
                wait = float(retry_after) if retry_after else backoff
            except ValueError:
                wait = backoff
            # Add jitter so multiple clients don't synchronize.
            wait += random.uniform(0, 0.5)
            time.sleep(min(wait, NOTION_MAX_BACKOFF_SEC))
            backoff = min(backoff * 2, NOTION_MAX_BACKOFF_SEC)
            continue
        if 500 <= resp.status_code < 600 and attempt < max_retries:
            time.sleep(min(backoff, NOTION_MAX_BACKOFF_SEC))
            backoff = min(backoff * 2, NOTION_MAX_BACKOFF_SEC)
            continue

        return resp

    # Should not reach here, but if we did all retries hit RequestError:
    if last_exc:
        raise last_exc
    return resp  # type: ignore[possibly-undefined]


def _client_id() -> str:
    return os.environ.get("NOTION_CLIENT_ID", "").strip()


def _client_secret() -> str:
    return os.environ.get("NOTION_CLIENT_SECRET", "").strip()


def notion_configured() -> bool:
    return bool(_client_id() and _client_secret())


def auth_url(redirect_uri: str, state: str) -> str:
    """Build the Notion OAuth authorization URL."""
    client_id = _client_id()
    if not client_id:
        raise RuntimeError("NOTION_CLIENT_ID not configured")
    return (
        f"{NOTION_OAUTH_AUTHORIZE}?client_id={client_id}"
        f"&response_type=code&owner=user&redirect_uri={redirect_uri}"
        f"&state={state}"
    )


def exchange_code(code: str, redirect_uri: str) -> dict[str, Any]:
    """Exchange an OAuth code for an access token."""
    import base64

    client_id = _client_id()
    client_secret = _client_secret()
    if not client_id or not client_secret:
        raise RuntimeError("NOTION_CLIENT_ID or NOTION_CLIENT_SECRET not configured")

    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

    resp = _request_with_backoff(
        lambda: httpx.post(
            NOTION_OAUTH_TOKEN,
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/json",
            },
            json={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            timeout=30.0,
        )
    )
    resp.raise_for_status()
    return resp.json()


class NotionClient:
    """Lightweight wrapper around the Notion API."""

    def __init__(self, access_token: str):
        self.token = access_token
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        }

    def list_databases(self) -> list[dict[str, Any]]:
        """Search for databases the integration has access to."""
        results: list[dict[str, Any]] = []
        start_cursor: str | None = None
        while True:
            payload: dict[str, Any] = {
                "filter": {"value": "database", "property": "object"},
            }
            if start_cursor:
                payload["start_cursor"] = start_cursor

            resp = _request_with_backoff(
                lambda: httpx.post(
                    f"{NOTION_API_BASE}/search",
                    headers=self.headers,
                    json=payload,
                    timeout=30.0,
                )
            )
            resp.raise_for_status()
            data = resp.json()
            results.extend(data.get("results", []))
            if not data.get("has_more"):
                break
            start_cursor = data.get("next_cursor")
        return results

    def get_database(self, database_id: str) -> dict[str, Any]:
        resp = _request_with_backoff(
            lambda: httpx.get(
                f"{NOTION_API_BASE}/databases/{database_id}",
                headers=self.headers,
                timeout=30.0,
            )
        )
        resp.raise_for_status()
        return resp.json()

    def create_page(
        self,
        database_id: str,
        title: str,
        blocks: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Create a new page in a database with the given block content.

        Notion caps `children` at 100 blocks per request. We send the first
        chunk with the page-creation call, then append the rest via
        `PATCH /blocks/{page_id}/children` in further 100-block batches.
        """
        first_chunk = blocks[:NOTION_MAX_BLOCKS_PER_REQUEST]
        payload = {
            "parent": {"database_id": database_id},
            "properties": {
                "Name": {"title": [{"text": {"content": title[:NOTION_MAX_RICH_TEXT_CHARS]}}]},
            },
            "children": first_chunk,
        }
        resp = _request_with_backoff(
            lambda: httpx.post(
                f"{NOTION_API_BASE}/pages",
                headers=self.headers,
                json=payload,
                timeout=60.0,
            )
        )
        resp.raise_for_status()
        page = resp.json()

        # Append remaining blocks in 100-at-a-time batches.
        page_id = page["id"]
        remaining = blocks[NOTION_MAX_BLOCKS_PER_REQUEST:]
        for i in range(0, len(remaining), NOTION_MAX_BLOCKS_PER_REQUEST):
            batch = remaining[i : i + NOTION_MAX_BLOCKS_PER_REQUEST]
            patch_resp = _request_with_backoff(
                lambda b=batch: httpx.patch(
                    f"{NOTION_API_BASE}/blocks/{page_id}/children",
                    headers=self.headers,
                    json={"children": b},
                    timeout=60.0,
                )
            )
            patch_resp.raise_for_status()

        return page


# ─── markdown → Notion blocks ────────────────────────────────────────────────

def _rich_text(content: str) -> list[dict[str, Any]]:
    """Convert a string with inline markdown (bold, italic) to Notion rich_text.

    Notion caps each text object's `content` at 2000 chars. Long strings are
    split across multiple text objects in the same rich_text array (which
    renders identically to a single one). Bold/italic markers are stripped
    to plain text — annotations are a future improvement.
    """
    if not content:
        return []

    text = content.replace("**", "").replace("__", "").replace("*", "").replace("_", "")
    if len(text) <= NOTION_MAX_RICH_TEXT_CHARS:
        return [{"type": "text", "text": {"content": text}}]

    # Split into 2000-char slices, preferring word boundaries when possible.
    slices: list[str] = []
    while text:
        if len(text) <= NOTION_MAX_RICH_TEXT_CHARS:
            slices.append(text)
            break
        # Look for the last space within the limit so we don't cut a word.
        cut = text.rfind(" ", 0, NOTION_MAX_RICH_TEXT_CHARS)
        if cut <= 0:
            cut = NOTION_MAX_RICH_TEXT_CHARS
        slices.append(text[:cut])
        text = text[cut:].lstrip()

    return [{"type": "text", "text": {"content": s}} for s in slices]


def markdown_to_notion_blocks(markdown: str) -> list[dict[str, Any]]:
    """Convert markdown to Notion block objects.

    Handles: headings (# ## ###), bullet lists (- *), numbered lists (1. 2.),
    blockquotes (> ), paragraphs. Bold/italic inside lines are stripped to plain.
    """
    blocks: list[dict[str, Any]] = []
    lines = markdown.splitlines()
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i].rstrip()
        if not line:
            i += 1
            continue

        # Heading 1
        if line.startswith("# "):
            blocks.append(
                {
                    "object": "block",
                    "type": "heading_1",
                    "heading_1": {"rich_text": _rich_text(line[2:].strip())},
                }
            )
            i += 1
            continue

        # Heading 2
        if line.startswith("## "):
            blocks.append(
                {
                    "object": "block",
                    "type": "heading_2",
                    "heading_2": {"rich_text": _rich_text(line[3:].strip())},
                }
            )
            i += 1
            continue

        # Heading 3
        if line.startswith("### "):
            blocks.append(
                {
                    "object": "block",
                    "type": "heading_3",
                    "heading_3": {"rich_text": _rich_text(line[4:].strip())},
                }
            )
            i += 1
            continue

        # Bullet list
        if re.match(r"^[-*]\s+", line):
            items: list[str] = []
            while i < n and re.match(r"^[-*]\s+", lines[i]):
                items.append(re.sub(r"^[-*]\s+", "", lines[i]))
                i += 1
            for item in items:
                blocks.append(
                    {
                        "object": "block",
                        "type": "bulleted_list_item",
                        "bulleted_list_item": {"rich_text": _rich_text(item)},
                    }
                )
            continue

        # Numbered list
        if re.match(r"^\d+\.\s+", line):
            items: list[str] = []
            while i < n and re.match(r"^\d+\.\s+", lines[i]):
                items.append(re.sub(r"^\d+\.\s+", "", lines[i]))
                i += 1
            for item in items:
                blocks.append(
                    {
                        "object": "block",
                        "type": "numbered_list_item",
                        "numbered_list_item": {"rich_text": _rich_text(item)},
                    }
                )
            continue

        # Blockquote
        if line.startswith("> "):
            items: list[str] = []
            while i < n and lines[i].startswith("> "):
                items.append(lines[i][2:])
                i += 1
            blocks.append(
                {
                    "object": "block",
                    "type": "quote",
                    "quote": {"rich_text": _rich_text(" ".join(items))},
                }
            )
            continue

        # Divider (---)
        if line.strip() == "---":
            blocks.append(
                {"object": "block", "type": "divider", "divider": {}}
            )
            i += 1
            continue

        # Paragraph (default)
        content = line.strip()
        # Accumulate consecutive non-block lines into one paragraph
        para_lines: list[str] = [content]
        i += 1
        while i < n and lines[i].strip() and not _is_block_line(lines[i]):
            para_lines.append(lines[i].strip())
            i += 1
        blocks.append(
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {"rich_text": _rich_text(" ".join(para_lines))},
            }
        )

    return blocks


def _is_block_line(line: str) -> bool:
    """Return True if this line starts a known block element."""
    s = line.lstrip()
    return bool(
        s.startswith("# ")
        or s.startswith("## ")
        or s.startswith("### ")
        or re.match(r"^[-*]\s+", s)
        or re.match(r"^\d+\.\s+", s)
        or s.startswith("> ")
        or s == "---"
    )
