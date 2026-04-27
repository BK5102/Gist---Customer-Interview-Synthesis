# Per-transcript theme extraction via Claude tool-use
import json
import os
import sys
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

from synth.prompts import EXTRACT_THEMES_TOOL, EXTRACTION_PROMPT
from synth.verify import verify_quote

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env", override=True)

MODEL = "claude-sonnet-4-6"


def extract_from_text(
    transcript_text: str, participant_id: str
) -> tuple[list[dict], int]:
    """Extract verified themes from raw transcript text.

    Returns (verified_themes, dropped_count). No disk I/O, no caching —
    callers that want caching should wrap this.
    """
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], max_retries=6)
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        tools=[EXTRACT_THEMES_TOOL],
        tool_choice={"type": "tool", "name": "extract_themes"},
        messages=[
            {
                "role": "user",
                "content": EXTRACTION_PROMPT.format(
                    participant_id=participant_id,
                    transcript_text=transcript_text,
                ),
            }
        ],
    )

    themes: list[dict] = []
    for block in response.content:
        if block.type == "tool_use" and block.name == "extract_themes":
            themes = block.input.get("themes", [])
            break

    verified: list[dict] = []
    dropped = 0
    for theme in themes:
        if verify_quote(theme["quote"], transcript_text):
            verified.append(theme)
        else:
            dropped += 1

    return verified, dropped


def extract(transcript_path: str, participant_id: str) -> tuple[list[dict], int]:
    """Extract verified themes from a transcript file on disk."""
    transcript_text = Path(transcript_path).read_text(encoding="utf-8")
    return extract_from_text(transcript_text, participant_id)


if __name__ == "__main__":
    transcript_path = sys.argv[1]
    participant_id = Path(transcript_path).stem

    verified, dropped = extract(transcript_path, participant_id)

    print(json.dumps(verified, indent=2))
    print(f"Extracted {len(verified)} verified themes ({dropped} dropped as unverified).")
