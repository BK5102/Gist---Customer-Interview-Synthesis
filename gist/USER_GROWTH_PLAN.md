# Gist Real-User Strategy Plan

Status memory: deployment is complete for Gist, and the launch posts are complete on LinkedIn, X, and Substack. One week after shipping, there is no meaningful traffic yet. That is a distribution problem, not evidence that the product is too late or unwanted. The next phase is founder-led user recruitment: personally get the first 5-10 real users to try Gist with redacted, synthetic, or low-sensitivity customer interviews while security and retention controls are hardened.

The live app is:
https://gist-customer-interview-synthesis.vercel.app

## Goal

Bring in real users who run customer interviews and need faster synthesis:

- Solo founders doing customer discovery
- Indie hackers validating product ideas
- Product managers and UX researchers doing early discovery
- Startup accelerators, founder communities, and build-in-public circles

The first growth goal is learning, not scale: get 10 real users to upload real transcripts, produce at least one synthesis, and tell us what they trusted, distrusted, or still had to do manually.

Honest public/customer framing:

"I shipped the first usable version of Gist last week. It turns customer interview transcripts into traceable themes with verified quotes. I am looking for 5 founders, PMs, or researchers with 2-5 real customer calls. I will personally help run your first synthesis and use your feedback to improve the product."

Security-aware version:

"Customer interviews can contain sensitive company and customer information, so please start with redacted, synthetic, or low-sensitivity transcripts. I am using the first beta users to harden both product quality and security before asking teams to trust Gist with confidential research."

## North-Star Metric

Weekly activated users: unique users who create at least one synthesis from at least two transcripts/audio files in a 7-day period.

Supporting metrics:

- Signups
- First synthesis completed
- Time from signup to first completed synthesis
- Number of projects per user
- Number of transcripts uploaded per project
- Number of syntheses per project
- Notion connection rate
- Notion push rate
- Failed synthesis jobs
- Repeat usage within 7 days

## Where To Check Users And Usage Today

### Supabase Dashboard

Use Supabase as the source of truth for accounts and product usage.

- Users: `Authentication -> Users`
- Tables: `Table Editor -> projects`, `transcripts`, `syntheses`, `notion_connections`
- SQL queries: `SQL Editor`
- API/auth/database logs: `Logs`

Quick SQL checks:

```sql
-- Total registered users
select count(*) as total_users
from auth.users;

-- New users by day
select date_trunc('day', created_at) as day, count(*) as users
from auth.users
group by 1
order by 1 desc;

-- Activated users: users with at least one synthesis
select count(distinct p.user_id) as activated_users
from projects p
join syntheses s on s.project_id = p.id;

-- Activation funnel by user
select
  u.id,
  u.email,
  u.created_at as signed_up_at,
  count(distinct p.id) as projects,
  count(distinct t.id) as transcripts,
  count(distinct s.id) as syntheses,
  count(distinct nc.id) as notion_connected
from auth.users u
left join projects p on p.user_id = u.id
left join transcripts t on t.project_id = p.id
left join syntheses s on s.project_id = p.id
left join notion_connections nc on nc.user_id = u.id
group by u.id, u.email, u.created_at
order by u.created_at desc;

-- Daily syntheses
select date_trunc('day', created_at) as day, count(*) as syntheses
from syntheses
group by 1
order by 1 desc;

-- Notion conversion
select
  count(distinct u.id) as users,
  count(distinct nc.user_id) as notion_connected_users
from auth.users u
left join notion_connections nc on nc.user_id = u.id;
```

Current schema does not store Notion push events separately. It stores connections in `notion_connections`, but a successful push is only visible in backend logs unless you add an event table.

### Vercel Dashboard

Use Vercel for frontend traffic and deployment health.

- Deployments: confirm latest frontend is live
- Runtime logs: frontend errors and route issues
- Web Analytics: enable if not already enabled to see page views, referrers, top pages, devices, and countries
- Speed Insights: enable if performance becomes a conversion issue

Watch:

- Visits to `/`
- Visits to `/signup`
- Visits to `/login`
- Visits to `/projects`
- Drop-off between homepage and signup

### Railway Dashboard

Use Railway for backend health.

- Deployments: confirm latest backend is live
- Logs: synthesis errors, auth failures, Notion errors, CORS issues
- Metrics: CPU, memory, restarts
- Variables: verify production API keys and `CORS_ORIGINS`

Watch:

- 401/403 spikes after signup or login
- 500s during synthesis
- Job failures by stage: transcribing, extracting, clustering, insights
- Notion API errors
- Long-running requests or restarts

### GitHub

Use GitHub for developer/discovery signals.

- Repo traffic: `Insights -> Traffic`
- Stars, forks, watchers
- Issues opened by real users
- Referrers to the repo

### Launch Channel Dashboards

Use each post's native analytics for top-of-funnel signals.

- LinkedIn: impressions, profile views, reactions, comments, reposts, link clicks if available
- X: impressions, engagements, profile clicks, link clicks if available
- Substack: opens, clicks, new subscribers, replies

Add UTM parameters to future links so Vercel or analytics can attribute traffic:

```text
https://gist-customer-interview-synthesis.vercel.app?utm_source=linkedin&utm_medium=social&utm_campaign=launch
https://gist-customer-interview-synthesis.vercel.app?utm_source=x&utm_medium=social&utm_campaign=launch
https://gist-customer-interview-synthesis.vercel.app?utm_source=substack&utm_medium=newsletter&utm_campaign=launch
```

## Instrumentation To Add Next

Add a lightweight `events` table so usage is visible without digging through logs.

The production migration is in:

```text
backend/migrations/2026-05-21_events.sql
```

How to add it in Supabase:

1. Open Supabase dashboard.
2. Select the Gist production project.
3. Go to `SQL Editor`.
4. Open `backend/migrations/2026-05-21_events.sql` locally.
5. Paste the full SQL into a new query.
6. Click `Run`.
7. Confirm the table exists in `Table Editor -> events`.
8. Run this smoke check:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'events';
```

Expected result: one row named `events`.

Recommended events:

- `signup_completed`
- `project_created`
- `files_uploaded`
- `synthesis_started`
- `synthesis_completed`
- `synthesis_failed`
- `notion_connected`
- `notion_push_completed`
- `notion_push_failed`
- `copy_markdown_clicked`

Recommended columns:

- `id uuid`
- `user_id uuid`
- `event_name text`
- `properties jsonb`
- `created_at timestamptz`

Example properties:

- file count
- source types: text/audio
- transcript count
- synthesis duration
- failure stage
- model used
- estimated cost
- UTM source/campaign, if captured

Useful event queries once logging is wired:

```sql
-- Events by day and type
select
  date_trunc('day', created_at) as day,
  event_name,
  count(*) as events
from events
group by 1, 2
order by 1 desc, 3 desc;

-- Users who completed the core activation event
select count(distinct user_id) as activated_users
from events
where event_name = 'synthesis_completed';

-- Funnel counts
select
  count(distinct user_id) filter (where event_name = 'signup_completed') as signed_up,
  count(distinct user_id) filter (where event_name = 'project_created') as created_project,
  count(distinct user_id) filter (where event_name = 'synthesis_started') as started_synthesis,
  count(distinct user_id) filter (where event_name = 'synthesis_completed') as completed_synthesis,
  count(distinct user_id) filter (where event_name = 'notion_push_completed') as pushed_to_notion
from events;

-- Recent failures
select user_id, event_name, properties, created_at
from events
where event_name in ('synthesis_failed', 'notion_push_failed')
order by created_at desc
limit 50;
```

## 30-Day User Plan

### Week 1: Founder-Led Outreach

Target: 20 direct conversations, 5 real uploads.

Actions:

- Because there is currently no meaningful traffic, do not wait for organic discovery. Send direct messages and emails first.
- Reply to every comment on LinkedIn, X, and Substack with a specific question: "Do you have 2-5 customer calls I can help synthesize?"
- DM warm founder/product/research contacts with a personal ask.
- Offer a white-glove first synthesis: they send transcripts or call notes, you walk through the result with them.
- Post one short demo clip showing upload -> synthesis -> Notion.

Message angle:

"I built Gist to turn customer interview transcripts into traceable themes with verified quotes. I am looking for 5 founders or PMs with messy real interviews. I will personally help you run the first synthesis and use your feedback to shape the product."

### Week 2: Community Distribution

Target: 50 signups, 10 activated users.

Actions:

- Share in founder communities where self-promotion is allowed: Indie Hackers, relevant Slack/Discord groups, accelerator alumni groups, PM/research communities.
- Convert the Substack launch into a practical post: "How I synthesize 5 customer interviews in 10 minutes without losing quote traceability."
- Publish 2 anonymized before/after examples using synthetic or permissioned data.
- Ask every activated user what almost stopped them.

### Week 3: Tighten Activation

Target: improve signup -> first synthesis conversion.

Actions:

- Review Supabase funnel queries twice a week.
- Watch failed jobs in Railway logs.
- Add one sample project or sample transcript path if users hesitate because they do not have data ready.
- Improve empty states and error copy based on the top 3 observed failures.
- Add a feedback CTA after synthesis: "Was this useful?" with optional text.

### Week 4: Turn Learning Into Repeatability

Target: 3 repeat users and one crisp positioning wedge.

Actions:

- Interview activated users.
- Identify which segment gets value fastest: founders, PMs, researchers, or agencies.
- Write a case-study style post around one workflow.
- Add pricing/waitlist language only after there is repeat usage.
- Decide whether Phase 4 is analytics, collaboration, export polish, or higher synthesis quality based on observed behavior.

## Daily Operating Ritual

Spend 20 minutes each day checking:

1. Supabase users and activation funnel.
2. Railway errors and failed jobs.
3. Vercel traffic/referrers.
4. Replies/comments/DMs from launch channels.
5. One direct outreach batch.

Keep a simple log:

```text
Date:
New users:
Activated users:
Syntheses created:
Notion connections:
Top traffic source:
Main failure:
One user quote:
Next action:
```

## Immediate Next Actions

1. Run `backend/migrations/2026-05-21_events.sql` in Supabase SQL Editor.
2. Run the Supabase SQL checks and record the baseline, even if all numbers are zero.
3. Enable Vercel Web Analytics if it is not already enabled.
4. Add UTM-tagged links to future posts and profile links.
5. Wire event logging for synthesis/notion/copy events.
6. Personally recruit the first 5 real users instead of waiting for organic traffic.

## Security/Trust Constraint

The target audience will not casually upload confidential `.mp4` or `.txt` interview files to a random new tool. Growth depends on trust.

Before broad self-serve acquisition, follow `SECURITY_TRUST_PLAN.md`:

- Enable and verify Supabase RLS/auth settings.
- Seal Railway secrets and keep logs free of transcript/output content.
- Keep Vercel secrets out of the frontend and enable deployment protection for previews.
- Keep `STORE_TRANSCRIPTS=false` in production so raw uploaded transcript bodies are not saved.
- Keep `ENABLE_SYNTH_CACHE=false` in production so quote-bearing cache files are not written to disk.
- Keep `STORE_PLAINTEXT_SYNTHESES=false` in production so generated quote-bearing reports are not saved in plaintext.
- Run `backend/migrations/2026-05-21_scrub_transcript_content.sql` to remove raw transcript bodies saved by earlier builds.
- Run `backend/migrations/2026-05-21_scrub_plaintext_syntheses.sql` to remove plaintext synthesis reports saved by earlier builds.
- Run `backend/migrations/2026-05-21_encrypted_artifacts.sql` before adding browser-encrypted saved reports.
- Add a public security/privacy page.
- Add deletion and retention controls.
- Avoid asking for sensitive company data until the product can explain and enforce its data handling posture.
