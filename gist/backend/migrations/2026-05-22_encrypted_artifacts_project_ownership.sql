alter table encrypted_artifacts enable row level security;

drop policy if exists "Users manage own encrypted artifacts" on encrypted_artifacts;

create policy "Users manage own encrypted artifacts" on encrypted_artifacts
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      project_id is null
      or exists (
        select 1
        from projects
        where projects.id = encrypted_artifacts.project_id
          and projects.user_id = auth.uid()
      )
    )
  );

notify pgrst, 'reload schema';
