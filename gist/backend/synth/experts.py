# Expert recommendation step: identify domain-appropriate experts and generate expert-voiced insights
import json
import os

from anthropic import Anthropic

from synth.prompts import EXPERT_RECOMMENDATION_PROMPT, EXPERT_RECOMMENDATION_TOOL

MODEL = "claude-sonnet-4-6"


def generate_expert_recommendations(clusters: list[dict], insights: dict) -> list[dict]:
    """Identify 2-4 domain-appropriate experts and generate their expert-voiced insights.

    Uses extended thinking so the model reasons about domain before committing to expert roles.
    Returns a list of dicts, each with keys: role, perspective, insights (list[str]).
    """
    synthesis_json = json.dumps(
        {"clusters": clusters, "insights": insights}, indent=2
    )

    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], max_retries=6)
    response = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        thinking={"type": "enabled", "budget_tokens": 8000},
        tools=[EXPERT_RECOMMENDATION_TOOL],
        tool_choice={"type": "tool", "name": "recommend_experts"},
        messages=[
            {
                "role": "user",
                "content": EXPERT_RECOMMENDATION_PROMPT.format(
                    synthesis_json=synthesis_json
                ),
            }
        ],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "recommend_experts":
            experts = block.input.get("experts", [])
            # Normalise: ensure each expert has exactly the expected keys
            result = []
            for e in experts:
                if not isinstance(e, dict):
                    continue
                role = str(e.get("role", "")).strip()
                perspective = str(e.get("perspective", "")).strip()
                raw_insights = e.get("insights", [])
                if not isinstance(raw_insights, list):
                    raw_insights = []
                insight_strs = [str(i).strip() for i in raw_insights if str(i).strip()]
                if role and insight_strs:
                    result.append(
                        {"role": role, "perspective": perspective, "insights": insight_strs}
                    )
            return result

    return []
