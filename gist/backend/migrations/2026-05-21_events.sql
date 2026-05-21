-- Phase 4 product analytics events.
-- Run this once in Supabase SQL Editor for the existing production database.

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists events_user_id_idx on events(user_id);
create index if not exists events_event_name_idx on events(event_name);
create index if not exists events_created_at_idx on events(created_at desc);

alter table events enable row level security;

drop policy if exists "Users see own events" on events;
create policy "Users see own events" on events
  for select using (auth.uid() = user_id);

-- The backend writes events with the service-role key, which bypasses RLS.
-- Do not add a client-side insert policy unless you intentionally want the
-- browser to write analytics events directly.

notify pgrst, 'reload schema';
