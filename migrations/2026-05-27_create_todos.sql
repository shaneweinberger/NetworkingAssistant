-- Run this in the Supabase SQL editor.
create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  content text not null default '',
  done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists todos_position_idx on todos (position);

-- This app has no auth layer; disable RLS to match the other tables.
-- If you later add auth, replace this with proper policies.
alter table todos disable row level security;
