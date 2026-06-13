-- Run this in the Supabase SQL editor.
-- Gameplan configuration: companies per tier, conversation targets.
-- Single-row table (id is always 'main').

create table if not exists gameplan_config (
  id text primary key default 'main',
  config jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  constraint gameplan_config_single_row check (id = 'main')
);
