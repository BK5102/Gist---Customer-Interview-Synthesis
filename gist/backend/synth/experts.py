# Expert recommendation step: identify domain-appropriate experts and generate expert-voiced insights
import json
import logging
import os

from anthropic import Anthropic

from synth.prompts import EXPERT_RECOMMENDATION_PROMPT, EXPERT_RECOMMENDATION_TOOL

MODEL = "claude-sonnet-4-6"
MIN_EXPERTS = 2

_log = logging.getLogger("gist.experts")

_RETRY_SUFFIX = (
    "\n\nIMPORTANT: Your previous response returned fewer than the required minimum of "
    f"{MIN_EXPERTS} experts. You MUST return at least {MIN_EXPERTS} distinct expert "
    "perspectives. Review the material again and add the missing experts now."
)


def _parse_experts(response) -> list[dict]:
    for block in response.content:
        if block.type == "tool_use" and block.name == "recommend_experts":
            experts = block.input.get("experts", [])
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


def generate_expert_recommendations(clusters: list[dict], insights: dict) -> list[dict]:
    """Identify 3-4 domain-appropriate experts and generate their expert-voiced insights.

    Uses extended thinking so the model reasons about domain before committing to expert roles.
    Retries once if fewer than MIN_EXPERTS are returned.
    Returns a list of dicts, each with keys: role, perspective, insights (list[str]).
    """
    synthesis_json = json.dumps(
        {"clusters": clusters, "insights": insights}, indent=2
    )
    prompt = EXPERT_RECOMMENDATION_PROMPT.format(synthesis_json=synthesis_json)

    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], max_retries=6)

    def _call(content: str) -> list[dict]:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            thinking={"type": "enabled", "budget_tokens": 8000},
            tools=[EXPERT_RECOMMENDATION_TOOL],
            tool_choice={"type": "tool", "name": "recommend_experts"},
            messages=[{"role": "user", "content": content}],
        )
        return _parse_experts(resp)

    result = _call(prompt)

    if len(result) < MIN_EXPERTS:
        _log.warning(
            "Expert step returned %d expert(s) (min %d); retrying once.",
            len(result), MIN_EXPERTS,
        )
        result = _call(prompt + _RETRY_SUFFIX)

    return result
