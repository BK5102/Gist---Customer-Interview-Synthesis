-- Persistent job store so syntheses survive Railway restarts.
-- Run in Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.jobs (
  id              text PRIMARY KEY,
  user_id         uuid NOT NULL,
  project_id      text,
  status          text NOT NULL DEFAULT 'queued',
  current         int,
  total           int,
  file_progress   jsonb,
  result          jsonb,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Only the owning user can read their own jobs.
-- Backend uses service-role key for all writes (bypasses RLS).
CREATE POLICY "jobs_owner_select" ON public.jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS jobs_user_status_idx ON public.jobs (user_id, status);
CREATE INDEX IF NOT EXISTS jobs_updated_idx    ON public.jobs (updated_at);
