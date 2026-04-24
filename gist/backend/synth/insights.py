# Founder-focused takeaways: strongest signal, contradictions, surprises
import hashlib
import json
import os
import sys
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

from synth.cluster import cluster_themes_cached, run_extraction_on_folder
from synth.prompts import INSIGHTS_PROMPT, INSIGHTS_TOOL

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
INSIGHTS_CACHE_DIR = REPO_DIR / "eval" / "results" / "insights"
load_dotenv(BACKEND_DIR / ".env", override=True)

MODEL = "claude-sonnet-4-6"


def _insights_well_formed(insights: dict) -> bool:
    """Insights are cacheable only when all three slots are populated dicts."""
    required = ("strongest_signal", "contradicted_assumption", "biggest_surprise")
    for key in required:
        slot = insights.get(key)
        if not isinstance(slot, dict):
            return False
        if not slot.get("headline") or not slot.get("explanation"):
            return False
    return True


def generate_insights_cached(clusters: list[dict]) -> dict:
    """Call generate_insights, caching only well-formed results by input hash."""
    clusters_json = json.dumps(clusters, indent=2, sort_keys=True)
    digest = hashlib.sha1(clusters_json.encode("utf-8")).hexdigest()[:12]
    INSIGHTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = INSIGHTS_CACHE_DIR / f"{digest}.json"

    if cache_path.exists():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        print(f"insights: loaded from cache ({digest})", file=sys.stderr)
        return cached

    insights = generate_insights(clusters)
    if _insights_well_formed(insights):
        cache_path.write_text(json.dumps(insights, indent=2), encoding="utf-8")
        print(f"insights: cached to {cache_path.name}", file=sys.stderr)
    else:
        print(
            "insights: result was malformed, not caching — will retry next run",
            file=sys.stderr,
        )
    return insights


def generate_insights(clusters: list[dict]) -> dict:
    """Generate 3 founder-focused insights from clustered themes.

    Returns a dict with keys strongest_signal, contradicted_assumption,
    biggest_surprise, each mapping to {"headline": str, "explanation": str}.
    """
    clusters_json = json.dumps(clusters, indent=2)

    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], max_retries=6)
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        tools=[INSIGHTS_TOOL],
        tool_choice={"type": "tool", "name": "generate_insights"},
        messages=[
            {
                "role": "user",
                "content": INSIGHTS_PROMPT.format(clusters_json=clusters_json),
            }
        ],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "generate_insights":
            print(
                f"[insights] stop_reason={response.stop_reason}",
                file=sys.stderr,
            )
            return block.input

    return {}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m synth.insights <folder_path>", file=sys.stderr)
        sys.exit(1)

    folder_path = sys.argv[1]
    all_themes = run_extraction_on_folder(folder_path)
    clusters = cluster_themes_cached(all_themes)
    insights = generate_insights_cached(clusters)

    print(json.dumps(insights, indent=2))
