-- Supabase schema for Gist Phase 2
-- Run this in the Supabase SQL Editor after creating your project.

-- Users come from Supabase auth.users automatically.

-- ─── projects ──────────────────────────────────────────────
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  created_at timestamptz default now()
);

alter table projects enable row level security;

create policy "Users see own projects" on projects
  for all using (auth.uid() = user_id);

-- ─── transcripts ───────────────────────────────────────────
create table transcripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  filename text not null,
  participant_label text,
  content text not null,
  source_type text check (source_type in ('text_upload', 'audio_upload')),
  audio_url text,
  duration_seconds int,
  created_at timestamptz default now()
);

alter table transcripts enable row level security;

create policy "Users see own transcripts" on transcripts
  for all using (
    exists (
      select 1 from projects
      where projects.id = transcripts.project_id
        and projects.user_id = auth.uid()
    )
  );

-- ─── syntheses ─────────────────────────────────────────────
create table syntheses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  markdown_output text not null,
  themes_json jsonb,
  transcript_ids uuid[],
  model_used text,
  cost_cents int,
  created_at timestamptz default now()
);

alter table syntheses enable row level security;

create policy "Users see own syntheses" on syntheses
  for all using (
    exists (
      select 1 from projects
      where projects.id = syntheses.project_id
        and projects.user_id = auth.uid()
    )
  );

-- ─── notion_connections (Phase 3) ──────────────────────────
create table notion_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique not null,
  access_token text not null,
  workspace_id text,
  workspace_name text,
  default_database_id text,
  created_at timestamptz default now()
);

alter table notion_connections enable row level security;

create policy "Users manage own notion connections" on notion_connections
  for all using (auth.uid() = user_id);

-- ─── oauth_states (Phase 3 — CSRF protection) ───────────────
-- Random nonces issued by GET /notion/auth and consumed by /notion/callback.
-- Without this, anyone who knows a user_id could complete an OAuth flow on
-- that user's behalf since `state` would be guessable.
create table oauth_states (
  state text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  provider text not null,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);

create index oauth_states_user_id_idx on oauth_states(user_id);
create index oauth_states_expires_idx on oauth_states(expires_at);

alter table oauth_states enable row level security;

-- Backend uses the service role for state writes/reads, so we don't need a
-- user-facing policy. This table never appears in client SELECTs.
