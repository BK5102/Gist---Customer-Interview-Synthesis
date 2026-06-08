-- Run in Supabase SQL editor: adds a free-text description field to projects.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text;
