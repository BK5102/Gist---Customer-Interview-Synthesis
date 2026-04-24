# Markdown report formatter: clusters + insights -> human-readable synthesis
import json
import sys
from pathlib import Path

from synth.cluster import cluster_themes_cached, run_extraction_on_folder
from synth.insights import generate_insights_cached


def _format_insight(insight) -> str:
    # The schema asks for {headline, explanation} but the model sometimes
    # returns a bare string. Accept either shape.
    if isinstance(insight, str):
        return insight.strip()
    if not isinstance(insight, dict):
        return ""
    headline = str(insight.get("headline", "")).strip()
    explanation = str(insight.get("explanation", "")).strip()
    if headline and explanation:
        return f"**{headline}**\n\n{explanation}"
    return headline or explanation


def _format_cluster(cluster: dict) -> str:
    name = cluster.get("cluster_name", "Unnamed cluster")
    category = cluster.get("category", "uncategorized")
    participants = cluster.get("participants", [])
    summary = cluster.get("cluster_summary", "").strip()
    quotes = cluster.get("supporting_quotes", [])

    participants_str = ", ".join(participants) if participants else "none"
    header = (
        f"### {name}\n"
        f"*{category} — {len(participants)} participant"
        f"{'s' if len(participants) != 1 else ''}: {participants_str}*"
    )

    quote_lines = [
        f"- **{q.get('participant_id', '?')}:** \u201c{q.get('quote', '').strip()}\u201d"
        for q in quotes
    ]
    quotes_block = "\n".join(quote_lines) if quote_lines else "_No quotes._"

    return f"{header}\n\n{summary}\n\n**Supporting quotes:**\n{quotes_block}"


def render_markdown(clusters: list[dict], insights: dict) -> str:
    """Render clusters + insights into a single markdown report."""
    # Unique participants across all clusters
    participant_set: set[str] = set()
    for c in clusters:
        for p in c.get("participants", []):
            participant_set.add(p)
    participants_sorted = sorted(participant_set)

    header = (
        "# Interview Synthesis\n\n"
        f"Synthesized across {len(participants_sorted)} participant"
        f"{'s' if len(participants_sorted) != 1 else ''}: "
        f"{', '.join(participants_sorted) if participants_sorted else 'none'}.\n"
        f"Surfaced {len(clusters)} theme cluster"
        f"{'s' if len(clusters) != 1 else ''}."
    )

    takeaways = [
        "## Founder Takeaways",
        "### Strongest signal",
        _format_insight(insights.get("strongest_signal", {})),
        "### Contradicted assumption",
        _format_insight(insights.get("contradicted_assumption", {})),
        "### Biggest surprise",
        _format_insight(insights.get("biggest_surprise", {})),
    ]

    # Multi-participant clusters first (desc by participant_count, then name),
    # then single-participant clusters (by name).
    def sort_key(c: dict) -> tuple:
        pc = c.get("participant_count", 0)
        return (0 if pc > 1 else 1, -pc, c.get("cluster_name", ""))

    sorted_clusters = sorted(clusters, key=sort_key)

    themes_section = ["## Themes"]
    if not sorted_clusters:
        themes_section.append("_No clusters to display._")
    else:
        themes_section.extend(_format_cluster(c) for c in sorted_clusters)

    return "\n\n".join([header, *takeaways, *themes_section]) + "\n"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m synth.format <folder_path> [output.md]", file=sys.stderr)
        sys.exit(1)

    folder_path = sys.argv[1]
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None

    all_themes = run_extraction_on_folder(folder_path)
    print(f"Running clustering on {len(all_themes)} themes...", file=sys.stderr)
    clusters = cluster_themes_cached(all_themes)
    print(f"Running insights on {len(clusters)} clusters...", file=sys.stderr)
    insights = generate_insights_cached(clusters)

    markdown = render_markdown(clusters, insights)

    if output_path:
        output_path.write_text(markdown, encoding="utf-8")
        print(f"Wrote {output_path}", file=sys.stderr)
    else:
        print(markdown)
