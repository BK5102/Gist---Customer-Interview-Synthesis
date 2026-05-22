-- Client-side encrypted storage for sensitive saved artifacts.
-- The backend/developer stores ciphertext only. The encryption key/passphrase
-- must stay in the user's browser and must never be sent to the server.

create table if not exists encrypted_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade,
  artifact_type text not null check (artifact_type in ('synthesis', 'transcript')),
  ciphertext text not null,
  iv text not null,
  salt text not null,
  kdf text not null default 'PBKDF2-SHA256',
  iterations int not null default 310000,
  algorithm text not null default 'AES-GCM',
  encrypted_data_key text,
  data_key_iv text,
  key_salt text,
  key_kdf text,
  key_iterations int,
  key_algorithm text,
  key_version text,
  created_at timestamptz default now()
);

alter table encrypted_artifacts
  add column if not exists encrypted_data_key text,
  add column if not exists data_key_iv text,
  add column if not exists key_salt text,
  add column if not exists key_kdf text,
  add column if not exists key_iterations int,
  add column if not exists key_algorithm text,
  add column if not exists key_version text;

create index if not exists encrypted_artifacts_user_id_idx
  on encrypted_artifacts(user_id);

create index if not exists encrypted_artifacts_project_id_idx
  on encrypted_artifacts(project_id);

create index if not exists encrypted_artifacts_created_at_idx
  on encrypted_artifacts(created_at desc);

alter table encrypted_artifacts enable row level security;

drop policy if exists "Users manage own encrypted artifacts" on encrypted_artifacts;
create policy "Users manage own encrypted artifacts" on encrypted_artifacts
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
