# All LLM prompts and tool schemas — no prompt strings anywhere else in the codebase

EXTRACT_THEMES_TOOL = {
    "name": "extract_themes",
    "description": "Extract themes, quotes, and observations from a single customer interview transcript.",
    "input_schema": {
        "type": "object",
        "properties": {
            "themes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "theme": {
                            "type": "string",
                            "description": "Short 2-5 word label for the theme"
                        },
                        "category": {
                            "type": "string",
                            "enum": [
                                "pain_point",
                                "feature_request",
                                "workflow_description",
                                "jobs_to_be_done",
                                "emotional_moment",
                                "contradiction",
                                "surprising_statement"
                            ]
                        },
                        "summary": {
                            "type": "string",
                            "description": "One-sentence summary in your own words"
                        },
                        "quote": {
                            "type": "string",
                            "description": "VERBATIM quote from the transcript supporting this theme. Copy exactly — do not paraphrase."
                        },
                        "quote_context": {
                            "type": "string",
                            "description": "One sentence: what was being discussed when this was said"
                        }
                    },
                    "required": ["theme", "category", "summary", "quote", "quote_context"]
                }
            }
        },
        "required": ["themes"]
    }
}

EXTRACTION_PROMPT = """You are analyzing a single customer interview transcript for a founder
doing customer discovery. Your job is to extract meaningful themes
that would help the founder decide what to build.

Focus on:
- Pain points the participant describes (concrete, not vague)
- Specific workflows and how they currently work around problems
- Features or improvements the participant explicitly or implicitly requests
- Jobs-to-be-done — what the participant is trying to accomplish
- Emotional moments — frustration, delight, resignation
- Contradictions — where the participant says one thing but implies another
- Surprising statements — things that would make the founder rethink assumptions

Rules:
- Every quote MUST be verbatim from the transcript. Do not paraphrase.
- Aim for 8-15 themes per transcript. Skip fluff.
- Don't invent themes that weren't actually discussed.
- If the participant disagreed with themselves at different points, capture BOTH as separate themes with category "contradiction".

Call the extract_themes tool with your findings.

TRANSCRIPT (Participant: {participant_id}):
---
{transcript_text}
---
"""
