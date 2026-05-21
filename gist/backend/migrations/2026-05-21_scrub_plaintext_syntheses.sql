-- Scrub plaintext synthesis content saved before plaintext synthesis
-- persistence was disabled by default.
--
-- WARNING: this preserves synthesis rows/metadata but removes the saved report
-- body and theme JSON. Users will lose access to old saved synthesis content
-- unless they already copied/exported it.

update syntheses
set
  markdown_output = '[plaintext synthesis not retained]',
  themes_json = null
where markdown_output is not null
  and markdown_output <> '[plaintext synthesis not retained]';

notify pgrst, 'reload schema';
