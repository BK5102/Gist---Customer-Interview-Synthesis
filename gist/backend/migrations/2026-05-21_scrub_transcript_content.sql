-- Scrub any raw transcript content that was saved before raw transcript
-- retention was disabled by default.
--
-- Run this once in Supabase SQL Editor after deploying the code change.
-- This preserves transcript rows/metadata but removes the sensitive body text.

update transcripts
set content = '[raw transcript not retained]'
where content is not null
  and content <> '[raw transcript not retained]';

notify pgrst, 'reload schema';
