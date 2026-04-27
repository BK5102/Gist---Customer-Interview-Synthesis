# Notion integration: OAuth + API client + markdown-to-blocks converter
import os
import re
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env", override=True)

NOTION_API_BASE = "https://api.notion.com/v1"
NOTION_OAUTH_AUTHORIZE = "https://api.notion.com/v1/oauth/authorize"
NOTION_OAUTH_TOKEN = "https://api.notion.com/v1/oauth/token"


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

    resp = httpx.post(
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

            resp = httpx.post(
                f"{NOTION_API_BASE}/search",
                headers=self.headers,
                json=payload,
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
            results.extend(data.get("results", []))
            if not data.get("has_more"):
                break
            start_cursor = data.get("next_cursor")
        return results

    def get_database(self, database_id: str) -> dict[str, Any]:
        resp = httpx.get(
            f"{NOTION_API_BASE}/databases/{database_id}",
            headers=self.headers,
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()

    def create_page(
        self,
        database_id: str,
        title: str,
        blocks: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Create a new page in a database with the given block content."""
        payload = {
            "parent": {"database_id": database_id},
            "properties": {
                "Name": {"title": [{"text": {"content": title}}]},
            },
            "children": blocks,
        }
        resp = httpx.post(
            f"{NOTION_API_BASE}/pages",
            headers=self.headers,
            json=payload,
            timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()


# ─── markdown → Notion blocks ────────────────────────────────────────────────

def _rich_text(content: str) -> list[dict[str, Any]]:
    """Convert a string with inline markdown (bold, italic) to Notion rich_text."""
    if not content:
        return []

    # Notion API supports **bold** and *italic* via annotations, but easiest
    # is to strip markdown and return plain text for now. We can improve later.
    text = content.replace("**", "").replace("__", "").replace("*", "").replace("_", "")
    return [{"type": "text", "text": {"content": text}}]


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
