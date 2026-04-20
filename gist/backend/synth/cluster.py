# Cross-transcript theme clustering
import json
import os
import sys
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

from synth.extract import extract
from synth.prompts import CLUSTER_THEMES_PROMPT, CLUSTER_THEMES_TOOL

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
CACHE_DIR = REPO_DIR / "eval" / "results" / "extractions"

load_dotenv(BACKEND_DIR / ".env")

MODEL = "claude-sonnet-4-6"


def run_extraction_on_folder(folder_path: str) -> list[dict]:
    """Run extract() on every .txt in folder, caching per-participant results.

    Cache path: eval/results/extractions/<participant_id>.json. A cache file
    is reused when it exists and its mtime is >= the source transcript's
    mtime. Every returned theme carries a participant_id.
    """
    folder = Path(folder_path)
    if not folder.is_dir():
        raise ValueError(f"Not a directory: {folder_path}")

    transcripts = sorted(folder.glob("*.txt"))
    if not transcripts:
        raise ValueError(f"No .txt transcripts found in {folder_path}")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    all_themes: list[dict] = []
    for transcript_path in transcripts:
        participant_id = transcript_path.stem
        cache_path = CACHE_DIR / f"{participant_id}.json"

        source_mtime = transcript_path.stat().st_mtime
        if cache_path.exists() and cache_path.stat().st_mtime >= source_mtime:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            themes = cached["themes"]
            print(
                f"{participant_id}: loaded {len(themes)} themes from cache",
                file=sys.stderr,
            )
        else:
            verified, dropped = extract(str(transcript_path), participant_id)
            themes = verified
            cache_path.write_text(
                json.dumps(
                    {"participant_id": participant_id, "themes": themes},
                    indent=2,
                ),
                encoding="utf-8",
            )
            print(
                f"{participant_id}: extracted {len(themes)} themes "
                f"({dropped} dropped)",
                file=sys.stderr,
            )

        for theme in themes:
            theme["participant_id"] = participant_id
        all_themes.extend(themes)

    return all_themes


def cluster_themes(all_themes: list[dict]) -> list[dict]:
    """Cluster themes across participants via a single Claude tool-use call."""
    themes_json = json.dumps(all_themes, indent=2)

    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        tools=[CLUSTER_THEMES_TOOL],
        tool_choice={"type": "tool", "name": "cluster_themes"},
        messages=[
            {
                "role": "user",
                "content": CLUSTER_THEMES_PROMPT.format(themes_json=themes_json),
            }
        ],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "cluster_themes":
            return block.input["clusters"]

    return []


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m synth.cluster <folder_path>", file=sys.stderr)
        sys.exit(1)

    folder_path = sys.argv[1]
    all_themes = run_extraction_on_folder(folder_path)
    clusters = cluster_themes(all_themes)

    print(json.dumps(clusters, indent=2))

    n = len(all_themes)
    m = len({t["participant_id"] for t in all_themes})
    k = len(clusters)
    j = sum(1 for c in clusters if c.get("participant_count") == 1)
    print(
        f"Clustered {n} themes from {m} participants into {k} clusters "
        f"({j} single-participant, {k - j} multi-participant).",
        file=sys.stderr,
    )
