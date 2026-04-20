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

CLUSTER_THEMES_TOOL = {
    "name": "cluster_themes",
    "description": "Group semantically similar themes from multiple interviews.",
    "input_schema": {
        "type": "object",
        "properties": {
            "clusters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "cluster_name": {"type": "string"},
                        "cluster_summary": {"type": "string"},
                        "participant_count": {"type": "integer"},
                        "participants": {
                            "type": "array",
                            "items": {"type": "string"}
                        },
                        "category": {"type": "string"},
                        "supporting_quotes": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "participant_id": {"type": "string"},
                                    "quote": {"type": "string"}
                                },
                                "required": ["participant_id", "quote"]
                            }
                        }
                    },
                    "required": [
                        "cluster_name",
                        "cluster_summary",
                        "participant_count",
                        "participants",
                        "category",
                        "supporting_quotes"
                    ]
                }
            }
        },
        "required": ["clusters"]
    }
}

CLUSTER_THEMES_PROMPT = """You are synthesizing themes extracted from multiple customer interview
transcripts. Each theme below was pulled from a single participant's transcript
and carries a participant_id. Your job is to group themes that describe the
SAME underlying topic, even when participants worded them differently.

Rules:
- Group by semantic topic, not exact wording. "Indeed applicants are mostly
  fake" and "Half my applications are spam" belong in the same cluster about
  applicant quality.
- Preserve participant attribution. Every entry in supporting_quotes MUST
  carry the participant_id the quote came from. Do not strip or merge
  participants.
- participant_count is the number of DISTINCT participants in the cluster,
  not the number of quotes. If P1 contributes two quotes to one cluster,
  that still counts as one participant.
- The participants array is the deduplicated list of participant_ids in
  that cluster, in any order.
- DO NOT drop single-participant themes. A theme mentioned by only one
  participant becomes a single-participant cluster. Outliers are valuable —
  they surface signals the founder may want to investigate.
- DO NOT invent clusters. Every cluster must be backed by themes that
  actually appear in the input. Every quote in supporting_quotes must be
  copied from an input theme's quote field — do not rewrite, paraphrase,
  or synthesize new quotes.
- Handle contradictions by clustering, not splitting. If two participants
  make OPPOSING claims on the same topic (e.g., P2: "Indeed is 12% real"
  vs P3: "Indeed is 30% real"), keep them in ONE cluster about that topic.
  Set the category to "contradiction" and make the cluster_summary
  explicitly flag the disagreement (e.g., "Participants disagree on X:
  P2 says A, P3 says B"). For clusters without contradiction, use the
  dominant category from the member themes.
- cluster_name should be a short 2-6 word label. cluster_summary should
  be one or two sentences describing what the cluster is about and,
  where relevant, the shape of agreement or disagreement.

Call the cluster_themes tool with your findings.

THEMES (JSON array, each object includes participant_id):
---
{themes_json}
---
"""
