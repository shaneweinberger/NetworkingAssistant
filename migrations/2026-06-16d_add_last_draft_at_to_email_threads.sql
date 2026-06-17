-- Run this in the Supabase SQL editor.
-- Tracks when a Gmail draft was last saved for a thread, separately from
-- last_sent_at, so saving a draft no longer gets mistaken for sending.
alter table email_threads
  add column if not exists last_draft_at timestamptz;
