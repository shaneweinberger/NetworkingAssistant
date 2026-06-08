-- Run this in the Supabase SQL editor.
alter table todos add column if not exists due_date date null;
