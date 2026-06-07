# Gist Product Design Research

## Scope

This report studies three products that overlap with Gist's core workflow:

- Looppanel: qualitative research analysis and repository
- Dovetail: customer evidence repository and cited AI answers
- Grain: meeting capture, transcript review, summaries, and sharing

The goal is not to copy brand identity or proprietary assets. The goal is to
identify proven interface patterns and adapt them to Gist's narrower promise:
turn a research round into a private, quote-backed synthesis.

## Executive Summary

The three products solve different parts of the same information problem.

Looppanel is strongest at organizing analysis. It treats a project as a
workspace with views, filters, theme groups, and evidence cards. The user can
see how raw notes become a theme.

Dovetail is strongest at trust. Its AI answers visibly cite interviews, and
its presentation separates generated interpretation from source evidence. The
interface repeatedly answers the question, "Where did this claim come from?"

Grain is strongest at reading and navigation. Its meeting detail view places a
structured written summary beside media and participant activity. Metadata,
tabs, search, and actions stay close to the document title.

Gist should combine these strengths:

1. Project workspaces and analysis controls from Looppanel.
2. Inline provenance and evidence counts from Dovetail.
3. Split-pane report reading and compact metadata from Grain.

## Looppanel Analysis

### Positioning

Looppanel leads with a direct outcome: eliminate guesswork and build on user
insights. Its copy emphasizes speed without surrendering researcher control.
This is important because research software must not imply that AI replaces
judgment.

### Navigation

- The marketing navigation separates features, company, pricing, and resources.
- Product navigation is project-centered.
- A project title appears at the left.
- Discussion Guide, Calls, and Analysis are peers in a horizontal tab row.
- The selected tab uses a soft filled pill rather than a heavy underline.

### Analysis Board

- A secondary control row switches between Question View and Tag View.
- Filters for tags, calls, and questions are visible before the evidence.
- AI completion is represented as a status control, not a decorative banner.
- Theme groups use a tinted background that visually contains quote cards.
- Individual quotes remain white, creating a clear parent-child relationship.
- Every evidence card shows participant identity and a theme label.
- Cards use a masonry-like arrangement, which communicates volume without
  forcing equal-height content.

### Typography and Spacing

- The site uses Thicccboi, a rounded geometric sans serif.
- Product UI relies on medium weights and generous line height.
- Text hierarchy is created more through size and grouping than color.
- Controls are compact relative to marketing buttons.
- Product screenshots use approximately 12 to 20 pixel corner radii.

### Motion

- Marketing buttons use sliding internal elements.
- Product scenes use cursor movement, completion notices, and layered panels.
- Motion demonstrates a task finishing, such as auto-tagging, instead of adding
  unrelated decoration.

### What Gist Should Adopt

- Project-level tab structure.
- Filter and status toolbar above research output.
- Theme containers with evidence cards.
- Participant and source labels on every quote.
- AI progress described as an explicit workflow state.

### What Gist Should Avoid

- Blue and purple brand colors that conflict with Gist's green identity.
- Enterprise-scale navigation and feature breadth.
- Dense tag management that Gist does not yet support.

## Dovetail Analysis

### Positioning

Dovetail frames research as reusable customer intelligence. The page focuses on
organizational memory, evidence, access, and governance. Its strongest message
is that an AI answer is only useful when the original source remains attached.

### Navigation

- The header supports a broad product platform and uses large menu groups.
- Labels are concise and grouped by product, role, use case, and resources.
- Action buttons remain visually separate from navigation labels.
- The header theme changes over dark and light page sections.

### Evidence Presentation

- AI answers include small citation markers directly inside generated text.
- Hovering or selecting a marker reveals the interview source.
- The generated answer and source tooltip occupy the same reading context.
- Dark panels isolate intelligence features from surrounding marketing content.
- A subtle grid and grain texture creates depth without card clutter.
- Secondary controls are icon-first: filter, history, close, copy, feedback.

### Report and Sharing Presentation

- Report imagery uses strong document titles and simple breadcrumb context.
- Sharing appears as a focused overlay with people, groups, and permission
  levels.
- The report remains visible behind the overlay, preserving spatial context.
- AI document creation is shown as a conversation that resolves into an
  actionable command.

### Typography and Spacing

- Inter is the primary interface font.
- JetBrains Mono is used for uppercase technical labels.
- Headings use medium weight instead of extreme bold.
- Large text follows a 48 pixel line-height rhythm on desktop.
- Product panels use 8 pixel radii and restrained one-pixel outlines.

### Motion

- Hover citations reveal source context.
- Modal and overlay transitions are short, generally around 150 to 300 ms.
- Background grids and generated shapes create slow environmental movement.
- The useful interaction remains the focus.

### What Gist Should Adopt

- Citation-like evidence markers and source labels.
- A dark evidence rail beside the main synthesis.
- Compact uppercase metadata labels.
- Clear distinction between generated findings and verified quotes.
- Short, functional overlay and hover transitions.

### What Gist Should Avoid

- Dovetail's black, blue, and magenta campaign palette.
- Large enterprise mega-menus.
- Features that imply cross-workspace AI search before Gist supports it.

## Grain Analysis

### Positioning

Grain presents meeting capture as infrastructure for people and AI agents. Its
product story starts with capture, then transcript enrichment, then downstream
use. The marketing page repeatedly shows the actual interface.

### Navigation

- The navigation is 80 pixels high with 12 to 16 pixels of vertical padding.
- The logo is approximately 24 pixels high.
- Links use 14 pixel regular text.
- Login is a simple text action.
- The primary action is visually contained but not oversized.
- The navigation uses backdrop blur with no visible bottom border.

### Meeting Detail Layout

- The document title and metadata chips sit at the top of the workspace.
- Summary, Transcript, and Private notes are horizontal tabs.
- Search appears directly below the tabs.
- The primary content uses a two-column split.
- The left side is a readable report with action items and structured sections.
- The right side contains video, speaker timelines, clips, and comments.
- The two panes share one application frame instead of appearing as unrelated
  cards.

### Visual Density

- Controls are small and close to the content they affect.
- Metadata uses compact outlined chips.
- Dividers structure the page more than shadows.
- Most surfaces are white or near-white.
- The product frame has a dark top edge and a strong outer shadow.

### Motion

- Sections enter with opacity and translate transitions around 500 ms.
- Marquees move slowly, around 50 seconds per loop.
- Hover states are subtle opacity and color changes.
- Interactive media progress provides the most visible motion.

### What Gist Should Adopt

- Two-pane synthesis reading.
- Metadata chips under the title.
- Tabs close to the report title.
- Search or filter controls close to output.
- A single connected workspace frame instead of many floating cards.

### What Gist Should Avoid

- Video controls when the stored Gist synthesis has no retained media.
- Sales coaching and CRM concepts outside the research workflow.
- Grain's green and yellow gradients.

## Shared Principles

All three products share several patterns:

1. Product evidence is the hero visual.
2. Navigation is compact relative to the content.
3. Tabs establish task context before cards appear.
4. Metadata is visible but quiet.
5. AI output is paired with source context.
6. Motion explains state changes.
7. Empty space is purposeful and usually supports a readable document width.
8. Shadows are reserved for product frames, overlays, and elevated actions.

## Gist Design Direction

### Brand

- Primary background: white.
- Primary ink: deep neutral.
- Brand accent: dark green.
- Supporting tint: very light green.
- Errors remain red because they are semantic, not decorative.

### Navigation

- Keep a compact 64 pixel header.
- Use the Gist mark and wordmark at the left.
- Keep logged-out actions at the right.
- Use icon-first controls for signed-in navigation on small screens.
- Do not add horizontal scrolling.

### Landing Page

- Replace the abstract orbit as the dominant visual.
- Show a credible Gist workspace with:
  - project title and metadata
  - Summary, Evidence, and Sources tabs
  - a structured finding
  - participant quote cards
  - citation markers
  - a verification status
- Animate the citation marker, evidence highlight, and progress line.
- Keep the surrounding copy concise.

### Projects Page

- Present projects as workspaces, not generic cards.
- Add compact counts and recent synthesis information.
- Keep primary actions in a consistent toolbar.
- Use a connected list with quiet dividers.

### Synthesis Page

- Expand to the wide page container.
- Add title metadata chips.
- Add Summary, Evidence, and Sources tabs as visual context.
- Place the markdown report in the left pane.
- Place extracted quotes and provenance in a dark evidence rail on the right.
- Keep copy and export actions in the header toolbar.

### Private Saves

- Keep the current master-detail layout.
- Make the left rail denser and the selected state clearer.
- Treat the decrypted report as a document, not a generic card.

### Motion

- Use 180 to 500 ms transitions for controls and loaded content.
- Use slow ambient movement only inside product demonstrations.
- Use pulse or highlight motion for citation verification.
- Respect reduced-motion preferences.

## Sources

- https://www.looppanel.com/
- https://www.looppanel.com/landing-page/ai-ux-research
- https://help.looppanel.com/en/articles/8099624-how-to-analyze-data-on-looppanel
- https://dovetail.com/solutions/research-repository/
- https://docs.dovetail.com/academy/analyze-interviews-and-calls
- https://grain.com/
- https://grain.com/blog/how-user-interviews-uses-grain
