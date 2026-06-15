# All LLM prompts and tool schemas — no prompt strings anywhere else in the codebase

EXTRACT_THEMES_TOOL = {
    "name": "extract_themes",
    "description": "Extract themes, quotes, and observations from a single document, transcript, or artifact.",
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
                                "key_finding",
                                "workflow_description",
                                "objective",
                                "emotional_moment",
                                "contradiction",
                                "surprising_statement",
                                "risk_signal",
                                "feature_request",
                                "jobs_to_be_done"
                            ]
                        },
                        "summary": {
                            "type": "string",
                            "description": "One-sentence summary in your own words"
                        },
                        "quote": {
                            "type": "string",
                            "description": "VERBATIM quote from the source supporting this theme. Copy exactly — do not paraphrase."
                        },
                        "quote_context": {
                            "type": "string",
                            "description": "One sentence: what was being discussed when this was said or written"
                        }
                    },
                    "required": ["theme", "category", "summary", "quote", "quote_context"]
                }
            }
        },
        "required": ["themes"]
    }
}

EXTRACTION_PROMPT = """You are analyzing a single document, transcript, or artifact. Your job
is to extract meaningful themes and findings that would help an expert
understand, evaluate, or act on this material.

The source may be any type of artifact: a legal deposition, witness statement,
client discovery call, user research interview, due diligence document, slide deck,
clinical intake, policy memo, field notes, or any other material.

Focus on:
- Pain points or problems explicitly described
- Key findings or facts that stand out
- Workflows, processes, or how things currently operate
- Goals or objectives the source is trying to achieve
- Emotional moments — frustration, concern, confidence, urgency
- Contradictions — where the source says one thing but implies another
- Surprising statements — things that would challenge an expert's assumptions
- Risk signals — potential liabilities, compliance concerns, or red flags
- Specific requests or recommendations made

Rules:
- Every quote MUST be verbatim from the source. Do not paraphrase.
- Aim for 8-15 themes. Skip filler, pleasantries, and off-topic content.
- Don't invent themes that aren't in the material.
- Use the category that best fits each theme. When in doubt, use key_finding.
- If the source contradicts itself at different points, capture BOTH as separate
  themes with category "contradiction".

Call the extract_themes tool with your findings.

SOURCE (ID: {participant_id}):
---
{transcript_text}
---
"""

CLUSTER_THEMES_TOOL = {
    "name": "cluster_themes",
    "description": "Group semantically similar themes from multiple sources.",
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

CLUSTER_THEMES_PROMPT = """You are synthesizing themes extracted from one or more documents,
transcripts, or artifacts. Each theme below was pulled from a single source
and carries a participant_id. Your job is to group themes that describe the
SAME underlying topic, even when sources worded them differently.

Rules:
- Group by semantic topic, not exact wording.
- Preserve source attribution. Every entry in supporting_quotes MUST
  carry the participant_id the quote came from. Do not strip or merge
  participant_ids.
- participant_count is the number of DISTINCT sources in the cluster,
  not the number of quotes. If P1 contributes two quotes to one cluster,
  that still counts as one source.
- The participants array is the deduplicated list of participant_ids in
  that cluster, in any order.
- DO NOT drop single-source themes. A theme mentioned in only one source
  becomes a single-source cluster. Outliers are valuable.
- DO NOT invent clusters. Every cluster must be backed by themes that
  actually appear in the input. Every quote in supporting_quotes must be
  copied from an input theme's quote field — do not rewrite, paraphrase,
  or synthesize new quotes.
- Handle contradictions by clustering, not splitting. If two sources
  make OPPOSING claims on the same topic, keep them in ONE cluster.
  Set the category to "contradiction" and make the cluster_summary
  explicitly flag the disagreement.
- cluster_name should be a short 2-6 word label. cluster_summary should
  be one or two sentences describing what the cluster is about and,
  where relevant, the shape of agreement or disagreement.

Call the cluster_themes tool with your findings.

THEMES (JSON array, each object includes participant_id):
---
{themes_json}
---
"""

INSIGHTS_TOOL = {
    "name": "generate_insights",
    "description": "Produce exactly three key takeaways from clustered themes across one or more sources.",
    "input_schema": {
        "type": "object",
        "properties": {
            "strongest_signal": {
                "type": "object",
                "properties": {
                    "headline": {
                        "type": "string",
                        "description": "One-sentence setup of the clearest pattern across sources.",
                    },
                    "explanation": {
                        "type": "string",
                        "description": "One paragraph. Reference specific source IDs. Say what the reader should act on or validate next.",
                    },
                },
                "required": ["headline", "explanation"],
            },
            "contradicted_assumption": {
                "type": "object",
                "properties": {
                    "headline": {
                        "type": "string",
                        "description": "One-sentence setup of a disagreement between sources or between stated and implied positions.",
                    },
                    "explanation": {
                        "type": "string",
                        "description": "One paragraph. Name the sources on each side. Explain where the reader's prior assumption likely breaks.",
                    },
                },
                "required": ["headline", "explanation"],
            },
            "biggest_surprise": {
                "type": "object",
                "properties": {
                    "headline": {
                        "type": "string",
                        "description": "One-sentence setup of the most unexpected finding or pattern.",
                    },
                    "explanation": {
                        "type": "string",
                        "description": "One paragraph. Reference the specific source ID(s). Explain why this is worth investigating.",
                    },
                },
                "required": ["headline", "explanation"],
            },
        },
        "required": ["strongest_signal", "contradicted_assumption", "biggest_surprise"],
    },
}

INSIGHTS_PROMPT = """You are helping an expert make sense of what the material reveals across
one or more sources. You have been given clusters of themes. Each cluster
groups semantically similar themes across sources and carries
participant_count, participants, category, cluster_summary, and
supporting_quotes (each quote tagged with participant_id).

Produce exactly 3 insights. Each insight is one sentence of setup
(headline) plus one paragraph of explanation.

1. STRONGEST SIGNAL: The clearest pattern. What should the reader
   act on or validate next, based on what was most consistently present?
   Prefer multi-source clusters. Name the sources.

2. CONTRADICTED ASSUMPTION: Where did sources disagree with each
   other, or where did what was stated contradict what was implied?
   This is where prior assumptions are likely to break. If a
   cluster has category "contradiction", that is a strong candidate.
   Name the sources on each side.

3. BIGGEST SURPRISE: The most unexpected finding or pattern — the
   thing an expert probably did NOT go into this material expecting.
   Single-source clusters are valid candidates.
   Name the source(s).

Rules:
- Be specific. Reference sources by their participant_id (e.g. P1, P2).
- Do not hedge. Do not say "it seems" or "perhaps".
- Do not invent insights that aren't supported by the clusters.
- Do not quote verbatim in the explanations — summarize in your own words.

Call the generate_insights tool with your findings.

CLUSTERS (JSON array):
---
{clusters_json}
---
"""

EXPERT_RECOMMENDATION_TOOL = {
    "name": "recommend_experts",
    "description": "Identify 2-4 domain-appropriate expert roles and provide their expert-voiced actionable insights on the synthesis.",
    "input_schema": {
        "type": "object",
        "properties": {
            "experts": {
                "type": "array",
                "minItems": 2,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "properties": {
                        "role": {
                            "type": "string",
                            "description": "Specific expert role title (e.g. 'Contract Lawyer', 'UX Researcher', 'Due Diligence Analyst'). Must be domain-specific — never generic like 'Expert' or 'Analyst'."
                        },
                        "perspective": {
                            "type": "string",
                            "description": "One sentence: the specific lens through which this expert reads this material and what they are most concerned with."
                        },
                        "insights": {
                            "type": "array",
                            "minItems": 3,
                            "maxItems": 3,
                            "items": {
                                "type": "string",
                                "description": "Actionable insight in first person, grounded in the synthesis findings. Direct, no hedging."
                            },
                            "description": "Exactly 3 actionable insights from this expert's perspective, each traceable to something in the synthesis."
                        }
                    },
                    "required": ["role", "perspective", "insights"]
                },
                "description": "2-4 domain-appropriate experts with perspectives and actionable insights."
            }
        },
        "required": ["experts"]
    }
}

EXPERT_RECOMMENDATION_PROMPT = """You are reviewing a synthesis of one or more documents, transcripts, or artifacts.

Your task: identify 2-4 expert roles who would have substantive, domain-specific views
on this material, then speak as each expert.

Step 1 — Determine the domain.
Read the clusters and insights carefully. What field or profession does this material
belong to? Examples: legal proceedings, product/UX research, financial due diligence,
clinical intake, investigative journalism, academic research, business strategy.

Step 2 — Select 2-4 specific expert roles.
Choose roles whose expertise is directly relevant to the content. Examples:
- Legal deposition → Contract Lawyer, Compliance Officer
- User research interviews → Product Manager, UX Researcher
- Due diligence calls → M&A Analyst, Risk Advisor
- Clinical notes → Attending Physician, Social Worker
- Policy document → Regulatory Affairs Specialist, Legal Counsel
Do NOT select generic roles like "Expert" or "Analyst". Be specific.

Step 3 — Speak as each expert.
For each expert:
- Write one sentence describing their specific lens on this material.
- Give exactly 3 actionable insights in first person, each grounded in the actual
  findings from the synthesis (reference specific themes or patterns).
- Be direct. No hedging. No generic advice that could apply to any situation.
- Every insight should tell the reader what to do next, what to investigate,
  or what decision to make based on what this material revealed.

Call the recommend_experts tool with your findings.

SYNTHESIS (clusters + key insights):
---
{synthesis_json}
---
"""
