-- Avatar storage bucket + RLS policies
-- Run in Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (avatars are not sensitive)
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- Each user can only write to a file named after their own user ID
CREATE POLICY "avatars_user_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = name
  );

CREATE POLICY "avatars_user_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = name
  );

CREATE POLICY "avatars_user_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = name
  );
