# Phase 1: audio transcription via Whisper.
# Supports two providers — Groq (free tier, OpenAI-compatible endpoint,
# whisper-large-v3) and OpenAI (whisper-1, paid). Prefers Groq when
# GROQ_API_KEY is set; falls back to OPENAI_API_KEY.
#
# Files larger than the per-request hosted-API cap are sliced into
# fixed-duration chunks via ffmpeg (-c copy, no re-encode) and transcribed
# sequentially; the chunk transcripts are space-joined.
import math
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env", override=True)

# Whisper hosted-API hard cap is 25 MB on both providers. We chunk anything
# over CHUNK_TARGET_BYTES so each upload stays comfortably under the limit.
WHISPER_MAX_BYTES = 25 * 1024 * 1024
CHUNK_TARGET_BYTES = 20 * 1024 * 1024  # leave headroom for re-encode overhead

# Largest single upload we'll accept end-to-end. Files between
# CHUNK_TARGET_BYTES and this cap go through chunk-and-transcribe.
MAX_AUDIO_BYTES = 200 * 1024 * 1024  # ~3-4 hr of typical compressed audio


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


def _ffmpeg_path() -> str:
    """Locate the ffmpeg binary.

    Prefers the static binary shipped by imageio-ffmpeg so users don't
    need a system install; falls back to PATH for environments where
    ffmpeg is already installed (Docker images, CI, Linux servers).
    """
    try:
        from imageio_ffmpeg import get_ffmpeg_exe

        return get_ffmpeg_exe()
    except ImportError:
        return "ffmpeg"


# Surfaced for diagnostic logging only — actual values resolve per-call so
# .env edits land without a restart.
MODEL = "whisper-large-v3 (groq) or whisper-1 (openai)"


def _transcribe_one(audio_path: Path) -> str:
    """Transcribe a single file that's already small enough for the API."""
    api_key, base_url, model = _resolve_provider()
    client = OpenAI(api_key=api_key, base_url=base_url)
    with audio_path.open("rb") as fh:
        response = client.audio.transcriptions.create(
            model=model,
            file=fh,
            response_format="text",
        )
    return str(response).strip()


def _audio_duration_seconds(audio_path: Path) -> float:
    """Probe duration by parsing ffmpeg -i stderr output.

    ffmpeg writes file metadata to stderr in the form 'Duration: HH:MM:SS.ss'
    even when no output is requested. This avoids needing a separate ffprobe
    binary (imageio-ffmpeg ships only ffmpeg).
    """
    ffmpeg = _ffmpeg_path()
    result = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(audio_path)],
        capture_output=True,
        text=True,
    )
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", result.stderr)
    if not match:
        raise RuntimeError(
            f"Could not probe duration for {audio_path.name}; "
            f"ffmpeg stderr: {result.stderr[-300:]}"
        )
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _chunk_audio(audio_path: Path, max_bytes: int) -> list[Path]:
    """Slice audio into chunks each <= max_bytes (best effort).

    Uses ffmpeg with `-c copy` (stream copy, no re-encode) so chunking is
    fast and preserves quality. Caller is responsible for unlinking the
    returned temp paths.
    """
    ffmpeg = _ffmpeg_path()
    duration_sec = _audio_duration_seconds(audio_path)
    total_bytes = audio_path.stat().st_size

    # +1 chunk for ceiling math, +1 more so each chunk lands under max_bytes
    # even when the bitrate is non-uniform.
    n_chunks = max(2, math.ceil(total_bytes / max_bytes) + 1)
    chunk_sec = math.ceil(duration_sec / n_chunks)

    suffix = audio_path.suffix
    chunks: list[Path] = []
    try:
        for i in range(n_chunks):
            start = i * chunk_sec
            if start >= duration_sec:
                break
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp_path = Path(tmp.name)
            cmd = [
                ffmpeg,
                "-hide_banner",
                "-loglevel", "error",
                "-y",  # overwrite the temp file we just created
                "-ss", str(start),
                "-t", str(chunk_sec),
                "-i", str(audio_path),
                "-c", "copy",  # stream copy — no re-encode
                str(tmp_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0 or not tmp_path.exists() or tmp_path.stat().st_size == 0:
                tmp_path.unlink(missing_ok=True)
                raise RuntimeError(
                    f"ffmpeg chunking failed at {start}s: {result.stderr[-300:]}"
                )
            chunks.append(tmp_path)
    except Exception:
        for p in chunks:
            p.unlink(missing_ok=True)
        raise

    return chunks


def transcribe(audio_path: str | Path) -> str:
    """Transcribe an audio file on disk to plain text.

    Files <= CHUNK_TARGET_BYTES go straight to the hosted API. Larger
    files are split into chunks via ffmpeg (-c copy) and the transcripts are
    joined with spaces. Raises FileNotFoundError if the path doesn't exist
    and ValueError if the file exceeds MAX_AUDIO_BYTES even after chunking
    (a sanity guardrail, not an API limit).
    """
    audio_path = Path(audio_path)
    if not audio_path.exists():
        raise FileNotFoundError(audio_path)

    size = audio_path.stat().st_size
    if size > MAX_AUDIO_BYTES:
        raise ValueError(
            f"{audio_path.name} is {size / 1_048_576:.1f} MB; cap is "
            f"{MAX_AUDIO_BYTES / 1_048_576:.0f} MB. Split the file or "
            "transcode to a lower bitrate."
        )

    if size <= CHUNK_TARGET_BYTES:
        return _transcribe_one(audio_path)

    # Large file → chunk + transcribe each + join.
    chunks = _chunk_audio(audio_path, CHUNK_TARGET_BYTES)
    try:
        parts: list[str] = []
        for ch in chunks:
            parts.append(_transcribe_one(ch))
        return " ".join(p for p in parts if p).strip()
    finally:
        for ch in chunks:
            ch.unlink(missing_ok=True)


def transcribe_bytes(audio_bytes: bytes, filename: str) -> str:
    """Transcribe in-memory audio bytes by writing to a temp file first.

    Whisper's SDK wants a file-like object with a real filename so it can
    sniff the format. NamedTemporaryFile gives us that without polluting
    the working directory. Large inputs flow through chunking inside
    transcribe().
    """
    suffix = Path(filename).suffix or ".mp3"
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise ValueError(
            f"{filename} is {len(audio_bytes) / 1_048_576:.1f} MB; cap is "
            f"{MAX_AUDIO_BYTES / 1_048_576:.0f} MB."
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
