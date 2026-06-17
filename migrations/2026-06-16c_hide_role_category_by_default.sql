-- Run this in the Supabase SQL editor.
-- Role Bucket is now hidden by default on the By Company view — it's
-- revealed via a small toggle next to the "Role" column header instead of
-- always taking up space. (The By Role view is unaffected; it already
-- excludes this column from its layout entirely.)
update contact_column_configs
set visible = false
where column_key = 'role_category';
