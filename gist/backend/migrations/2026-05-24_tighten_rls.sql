-- Tighten RLS on syntheses and transcripts to SELECT-only.
--
-- The backend writes these tables exclusively via the service-role key
-- (which bypasses RLS). Allowing INSERT/UPDATE/DELETE through a FOR ALL
-- policy means a compromised anon-key or crafted JWT could write arbitrary
-- rows directly to Supabase. Restricting to FOR SELECT closes that surface.
--
-- Run in the Supabase SQL Editor.

-- syntheses
drop policy if exists "Users see own syntheses" on syntheses;

create policy "Users select own syntheses" on syntheses
  for select using (
    exists (
      select 1 from projects
      where projects.id = syntheses.project_id
        and projects.user_id = auth.uid()
    )
  );

-- transcripts
drop policy if exists "Users see own transcripts" on transcripts;

create policy "Users select own transcripts" on transcripts
  for select using (
    exists (
      select 1 from projects
      where projects.id = transcripts.project_id
        and projects.user_id = auth.uid()
    )
  );
