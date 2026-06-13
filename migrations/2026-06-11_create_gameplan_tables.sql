-- Run this in the Supabase SQL editor.
-- SF Gameplan: progress state + activity history.

-- Current counts per company/role. One row per card (or per consulting role).
-- id format: 'tier1:Google', 'tier2:Ambience', 'consulting:Bain Toronto:consultants', etc.
create table if not exists gameplan_progress (
  id text primary key,
  out_count integer not null default 0 check (out_count >= 0),
  conv_count integer not null default 0 check (conv_count >= 0),
  updated_at timestamptz not null default now()
);

-- Individual activity events. One row per increment.
-- Decrement deletes the most recent matching row (by created_at).
-- Strip aggregates these rows by date to show daily activity.
create table if not exists gameplan_activity (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  type text not null check (type in ('out', 'conv')),
  company text not null,
  created_at timestamptz not null default now()
);

create index if not exists gameplan_activity_date_idx on gameplan_activity (date desc);
create index if not exists gameplan_activity_lookup_idx on gameplan_activity (company, type, created_at desc);
