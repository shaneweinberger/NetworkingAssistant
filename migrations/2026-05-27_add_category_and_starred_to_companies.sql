-- Run this in the Supabase SQL editor.
alter table companies
  add column if not exists category text,
  add column if not exists starred boolean not null default false;

create index if not exists companies_category_idx on companies (category);
create index if not exists companies_starred_idx on companies (starred) where starred = true;
