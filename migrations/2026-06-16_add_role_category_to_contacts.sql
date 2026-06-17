-- Run this in the Supabase SQL editor.
alter table contacts
  add column if not exists role_category text;

create index if not exists contacts_role_category_idx on contacts (role_category);

-- Add a "Role Bucket" column to installs that already seeded
-- contact_column_configs (the in-app seeding only runs when that table is
-- empty, so existing rows wouldn't otherwise pick up the new column).
insert into contact_column_configs (column_key, label, type, visible, width, position, options, sortable, filterable)
select 'role_category', 'Role Bucket', 'dropdown', false, 150,
  (select coalesce(max(position), 0) + 1 from contact_column_configs),
  '[{"value": "Product Manager", "color": "blue"}, {"value": "Software Engineer", "color": "purple"}]'::jsonb,
  true, true
where not exists (
  select 1 from contact_column_configs where column_key = 'role_category'
);
