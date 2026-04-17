# Quote verification — confirms extracted quotes appear verbatim in transcript
import re


def normalize(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def verify_quote(quote: str, transcript: str) -> bool:
    """Check that `quote` appears in `transcript` after normalization."""
    return normalize(quote) in normalize(transcript)
