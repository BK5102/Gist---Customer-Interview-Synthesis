-- Tighten RLS on projects and notion_connections to SELECT-only.
--
-- All writes to these tables go through the backend service-role key
-- (which bypasses RLS). FOR ALL policies were dead weight that also
-- permitted direct client-side INSERT/UPDATE/DELETE via a crafted JWT.
--
-- Run in the Supabase SQL Editor.

-- projects
drop policy if exists "Users see own projects" on projects;

create policy "Users select own projects" on projects
  for select using (auth.uid() = user_id);

-- notion_connections
drop policy if exists "Users manage own notion connections" on notion_connections;

create policy "Users select own notion connections" on notion_connections
  for select using (auth.uid() = user_id);
