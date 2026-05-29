-- contact_column_configs was created before the `options` field was added to
-- the app. The column was missing, so upserts were silently failing and any
-- dropdown option edits made in Column Settings were lost on refresh.

alter table contact_column_configs
  add column if not exists options jsonb not null default '[]'::jsonb;

-- Backfill the default Status options for rows that were seeded without them.
-- Only updates rows where options is still empty so custom edits are preserved.
update contact_column_configs
set options = '[
  {"value": "Sent",     "color": "gray"},
  {"value": "Replied",  "color": "green"},
  {"value": "No reply", "color": "orange"}
]'::jsonb
where column_key = 'status'
  and options = '[]'::jsonb;
