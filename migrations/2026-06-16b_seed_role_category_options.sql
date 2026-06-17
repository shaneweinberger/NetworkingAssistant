-- Run this in the Supabase SQL editor.
-- Follow-up to 2026-06-16_add_role_category_to_contacts.sql: turns the
-- "Role Bucket" column into a dropdown seeded with starter buckets, so the
-- By Role view has Product Manager / Software Engineer pinned groups to
-- sort contacts into (anything else falls into "Unassigned").
update contact_column_configs
set type = 'dropdown',
    options = '[
      {"value": "Product Manager",   "color": "blue"},
      {"value": "Software Engineer", "color": "purple"}
    ]'::jsonb
where column_key = 'role_category'
  and options = '[]'::jsonb;
