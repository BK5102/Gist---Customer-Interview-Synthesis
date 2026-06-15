# Markdown report formatter: clusters + insights -> human-readable synthesis
import json
import re
import sys
from pathlib import Path

from synth.cluster import cluster_themes_cached, run_extraction_on_folder
from synth.insights import generate_insights_cached


def _safe_str(value: object, fallback: str = "") -> str:
    """Coerce a value to a plain string safe for embedding in markdown.

    The LLM occasionally returns JSON-formatted strings in fields that the
    schema defines as plain strings. When detected, we attempt to extract a
    readable string from the parsed structure. Non-string scalars are
    stringified directly.
    """
    if isinstance(value, str):
        t = value.strip()
        if t.startswith(("{", "[")):
            try:
                parsed = json.loads(t)
                if isinstance(parsed, dict):
                    for key in ("text", "summary", "content", "description",
                                "headline", "explanation", "value"):
                        if isinstance(parsed.get(key), str) and parsed[key].strip():
                            return parsed[key].strip()
                    # Fall back to joining all string leaf values
                    parts = [str(v) for v in parsed.values() if isinstance(v, str) and v.strip()]
                    return " ".join(parts) if parts else fallback
                if isinstance(parsed, list):
                    parts = [str(i) for i in parsed if isinstance(i, str) and str(i).strip()]
                    return " ".join(parts) if parts else fallback
            except json.JSONDecodeError:
                # Regex fallback for truncated / malformed JSON strings (e.g.
                # when the LLM hits a token limit mid-response). Try to extract
                # a known text field by name before giving up and showing raw JSON.
                for key in ("text", "summary", "content", "description",
                            "headline", "explanation", "value"):
                    m = re.search(rf'"{key}"\s*:\s*"((?:[^"\\]|\\.)*)"', t)
                    if m:
                        return m.group(1)
        return t or fallback
    if isinstance(value, dict):
        for key in ("text", "summary", "content", "description",
                    "headline", "explanation", "value"):
            if isinstance(value.get(key), str) and value[key].strip():
                return value[key].strip()
        return fallback
    if value is None:
        return fallback
    return str(value).strip() or fallback


def _format_insight(insight) -> str:
    # The schema asks for {headline, explanation} but the model sometimes
    # returns a bare string. Accept either shape.
    if isinstance(insight, str):
        return _safe_str(insight)
    if not isinstance(insight, dict):
        return ""
    headline = _safe_str(insight.get("headline", ""))
    explanation = _safe_str(insight.get("explanation", ""))
    if headline and explanation:
        return f"**{headline}**\n\n{explanation}"
    return headline or explanation


def _format_cluster(cluster: dict) -> str:
    name = _safe_str(cluster.get("cluster_name"), "Unnamed cluster")
    category = _safe_str(cluster.get("category"), "uncategorized")
    participants = cluster.get("participants", [])
    summary = _safe_str(cluster.get("cluster_summary", ""))
    quotes = cluster.get("supporting_quotes", [])

    participants_str = ", ".join(participants) if participants else "none"
    header = (
        f"### {name}\n"
        f"*{category} — {len(participants)} participant"
        f"{'s' if len(participants) != 1 else ''}: {participants_str}*"
    )

    quote_lines = [
        f"- **{_safe_str(q.get('participant_id'), '?')}:** \u201c{_safe_str(q.get('quote', ''))}\u201d"
        for q in quotes
        if isinstance(q, dict)
    ]
    quotes_block = "\n".join(quote_lines) if quote_lines else "_No quotes._"

    return f"{header}\n\n{summary}\n\n**Supporting quotes:**\n{quotes_block}"


def _format_expert(expert: dict) -> str:
    role = _safe_str(expert.get("role", ""), "Expert")
    perspective = _safe_str(expert.get("perspective", ""))
    raw_insights = expert.get("insights", [])
    if not isinstance(raw_insights, list):
        raw_insights = []
    insight_lines = [
        f"{i + 1}. {_safe_str(ins)}"
        for i, ins in enumerate(raw_insights)
        if _safe_str(ins)
    ]

    parts = [f"### {role}"]
    if perspective:
        parts.append(f"*{perspective}*")
    if insight_lines:
        parts.append("\n".join(insight_lines))
    return "\n\n".join(parts)


def render_markdown(
    clusters: list[dict],
    insights: dict,
    expert_recommendations: list[dict] | None = None,
) -> str:
    """Render clusters + insights (+ optional expert perspectives) into a markdown report."""
    # Unique sources across all clusters
    source_set: set[str] = set()
    for c in clusters:
        for p in c.get("participants", []):
            source_set.add(p)
    sources_sorted = sorted(source_set)

    header = (
        "# Synthesis\n\n"
        f"Synthesized across {len(sources_sorted)} source"
        f"{'s' if len(sources_sorted) != 1 else ''}: "
        f"{', '.join(sources_sorted) if sources_sorted else 'none'}.\n"
        f"Surfaced {len(clusters)} theme cluster"
        f"{'s' if len(clusters) != 1 else ''}."
    )

    takeaways = [
        "## Key Takeaways",
        "### Strongest signal",
        _format_insight(insights.get("strongest_signal", {})),
        "### Contradicted assumption",
        _format_insight(insights.get("contradicted_assumption", {})),
        "### Biggest surprise",
        _format_insight(insights.get("biggest_surprise", {})),
    ]

    # Multi-source clusters first (desc by participant_count, then name),
    # then single-source clusters (by name).
    def sort_key(c: dict) -> tuple:
        pc = c.get("participant_count", 0)
        return (0 if pc > 1 else 1, -pc, c.get("cluster_name", ""))

    sorted_clusters = sorted(clusters, key=sort_key)

    themes_section = ["## Themes"]
    if not sorted_clusters:
        themes_section.append("_No clusters to display._")
    else:
        themes_section.extend(_format_cluster(c) for c in sorted_clusters)

    sections = [header, *takeaways, *themes_section]

    if expert_recommendations:
        expert_parts = ["## Expert Perspectives"]
        expert_parts.extend(
            _format_expert(e) for e in expert_recommendations if isinstance(e, dict)
        )
        if len(expert_parts) > 1:
            sections.extend(expert_parts)

    return "\n\n".join(sections) + "\n"


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
