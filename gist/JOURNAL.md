# Journal

## Day 1 — 2026-04-16

### What I shipped
- Repo scaffold (backend/, frontend/, CLAUDE.md, BUILD_PLAN.md, .gitignore)
- Single-transcript extraction pipeline in backend/synth/
  - extract.py: calls Claude Opus 4.7 with tool-use, gets structured themes
  - verify.py: string-match check that extracted quotes appear verbatim in transcript
  - prompts.py: extraction prompt as a constant
- CLI entry point: `python -m synth.extract <path>`
- Ran against P1.txt (synthetic 1,455-word founder/customer interview)
- 14 verified themes extracted, 0 dropped as unverified
- Baseline output saved to eval/results/ for regression comparison later

### Key decisions (and why)
- **Tool-use over JSON mode.** JSON mode + schema-in-prompt is more prone to the
  model ignoring the schema mid-generation. Tool-use forces structured output at
  the API level — fewer retries, more reliable. The tool definition itself becomes
  the schema contract.
- **Quote verification as a hard post-check, not a prompt instruction.**
  Telling the model "don't paraphrase" in the prompt is unreliable; LLMs
  paraphrase anyway. The verify_quote() step normalizes both strings
  (lowercase, punctuation stripped, whitespace collapsed) and checks substring
  containment. Any theme whose quote doesn't appear verbatim gets dropped.
  This is the trust layer — the entire product is useless if a researcher can't
  trust quotes are real.
- **Per-interview extraction before cross-interview clustering.** Tried to keep
  the two stages separate so each can be evaluated independently. Makes
  debugging easier: if a cluster is wrong, I can tell whether the extraction
  or the clustering is the culprit.

### What surprised me
- Verification caught 0 bad quotes on P1.txt, which I didn't expect. Maybe test
  transcript doesn't stress the prompt enough. Will know more on Day 2 with
  more transcripts.
- The model caught an implicit feature request that wasn't stated as one and
  correctly categorized it as feature_request even though the speaker framed
  it as a complaint. 
- Two of the fourteen themes were duplicates. This is
  expected behavior. The clustering step on Day 2 should merge them. 

## Day 2 — 2026-04-23

### What I shipped
- Cross-transcript clustering (cluster.py) with SHA1-keyed disk cache of
  the full cluster list
- Founder insights via tool-use (insights.py): strongest signal,
  contradicted assumption, biggest surprise — each a headline + paragraph,
  also cached by input hash
- Markdown formatter (format.py) rendering clusters + insights into a
  single report. End-to-end CLI: `python -m synth.format <folder> <out.md>`
- Ran end-to-end on P1/P2/P3 → 36 clusters, 3 insights, rendered synthesis

### Key decisions (and why)
- **Cache by SHA1 of input, not mtime.** Each run costs 2+ Sonnet calls.
  Hashing the themes/clusters input means the cache is correct regardless
  of file timestamps and invalidates naturally when upstream output changes.
- **Cache insights only when well-formed.** Tool-use schema turned out not
  to be a hard guarantee — occasionally the model returned bare strings
  instead of `{headline, explanation}` dicts. A shape check gates the
  cache write so a degraded run doesn't lock in forever; the formatter
  tolerates both shapes on the read side so the pipeline still completes.
- **`load_dotenv(override=True)`.** The shell had ANTHROPIC_API_KEY set
  to an empty string, and dotenv's default is to not overwrite existing
  env vars — silently ignoring the real key. Forcing override makes .env
  authoritative for project secrets.

### What surprised me
- Tool-use schema enforcement is a strong prior, not a hard contract.
  Had assumed structured output was guaranteed.
- Clustering produced 36 groups from 42 themes — only 3 are
  multi-participant. The "don't drop singletons" rule is being taken very
  literally. Worth revisiting in Day 2 Hour 3 if eval shows over-splitting.
- Hit a 422 "context reduction is suggested" from Sonnet at 8k max_tokens
  during an API capacity spike — a softer rate-limit signal I hadn't seen
  before, and one the SDK doesn't retry by default.
