-- Allows a thread card to be dismissed from the Threads Board without
-- deleting the underlying data. Closed threads are filtered out in
-- loadBoardData; re-opening requires a direct DB update or a future UI.
alter table email_threads
  add column if not exists closed_at timestamptz default null;
