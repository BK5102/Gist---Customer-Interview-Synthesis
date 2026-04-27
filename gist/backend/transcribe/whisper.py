# Phase 1: audio transcription via Whisper.
# Supports two providers — Groq (free tier, OpenAI-compatible endpoint,
# whisper-large-v3) and OpenAI (whisper-1, paid). Prefers Groq when
# GROQ_API_KEY is set; falls back to OPENAI_API_KEY.
import os
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env", override=True)

# Whisper hosted-API hard cap is 25 MB on both providers. Small safety margin.
WHISPER_MAX_BYTES = 24 * 1024 * 1024


def _resolve_provider() -> tuple[str, str, str]:
    """Return (api_key, base_url, model) for whichever provider is configured.

    Groq wins if its key is present — it's faster, free, and uses
    whisper-large-v3 (better quality than OpenAI's whisper-1).
    """
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    if groq_key:
        return groq_key, "https://api.groq.com/openai/v1", "whisper-large-v3"

    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if openai_key:
        return openai_key, "https://api.openai.com/v1", "whisper-1"

    raise RuntimeError(
        "No transcription provider configured. Set GROQ_API_KEY (free, "
        "https://console.groq.com) or OPENAI_API_KEY in backend/.env."
    )


# Surfaced for diagnostic logging only — actual values resolve per-call so
# .env edits land without a restart.
MODEL = "whisper-large-v3 (groq) or whisper-1 (openai)"


def transcribe(audio_path: str | Path) -> str:
    """Transcribe an audio file on disk to plain text.

    Raises FileNotFoundError if the path doesn't exist, ValueError if the
    file exceeds Whisper's 25 MB cap (chunking is Day 5), and openai
    errors propagate as-is so the caller can map them to HTTP responses.
    """
    audio_path = Path(audio_path)
    if not audio_path.exists():
        raise FileNotFoundError(audio_path)

    size = audio_path.stat().st_size
    if size > WHISPER_MAX_BYTES:
        raise ValueError(
            f"{audio_path.name} is {size / 1_048_576:.1f} MB; Whisper API "
            f"limit is {WHISPER_MAX_BYTES / 1_048_576:.0f} MB. "
            "Split the file (phase-1 day 5 will add automatic chunking)."
        )

    api_key, base_url, model = _resolve_provider()
    client = OpenAI(api_key=api_key, base_url=base_url)
    with audio_path.open("rb") as fh:
        response = client.audio.transcriptions.create(
            model=model,
            file=fh,
            response_format="text",
        )

    # response_format="text" returns a bare str
    return str(response).strip()


def transcribe_bytes(audio_bytes: bytes, filename: str) -> str:
    """Transcribe in-memory audio bytes by writing to a temp file first.

    Whisper's SDK wants a file-like object with a real filename so it can
    sniff the format. NamedTemporaryFile gives us that without polluting
    the working directory.
    """
    suffix = Path(filename).suffix or ".mp3"
    if len(audio_bytes) > WHISPER_MAX_BYTES:
        raise ValueError(
            f"{filename} is {len(audio_bytes) / 1_048_576:.1f} MB; Whisper "
            f"API limit is {WHISPER_MAX_BYTES / 1_048_576:.0f} MB."
        )

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = Path(tmp.name)

    try:
        return transcribe(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python -m transcribe.whisper <audio-file>", file=sys.stderr)
        sys.exit(1)

    text = transcribe(sys.argv[1])
    print(text)
