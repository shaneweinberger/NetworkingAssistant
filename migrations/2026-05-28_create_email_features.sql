-- Run this in the Supabase SQL editor.
-- Schema for Templates + Gmail Integration feature.

-- 1. Email templates
create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  subject text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_templates_category_idx on email_templates (category);
create index if not exists email_templates_updated_idx on email_templates (updated_at desc);

-- 2. Gmail credentials. Single-row table because this app is single-tenant.
-- access_token is short-lived (~1h) and refreshed via Google Identity Services.
-- The refresh_token field is reserved for a future server-side OAuth flow.
create table if not exists gmail_credentials (
  id integer primary key default 1,
  email text,
  access_token text,
  refresh_token text,
  scope text,
  expires_at timestamptz,
  last_history_id text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gmail_credentials_single_row check (id = 1)
);

-- 3. Email threads: one row per (contact, gmail thread) association.
create table if not exists email_threads (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  gmail_thread_id text not null,
  subject text,
  message_count integer not null default 0,
  last_message_at timestamptz,
  last_sent_at timestamptz,
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A given Gmail thread should map to at most one contact. If the same thread
-- ever needs to map to multiple contacts in the future, drop this unique index.
create unique index if not exists email_threads_thread_id_uniq on email_threads (gmail_thread_id);
create index if not exists email_threads_contact_idx on email_threads (contact_id);
create index if not exists email_threads_last_msg_idx on email_threads (last_message_at desc);

-- 4. Email events: append-only audit log.
-- event_type: 'sent', 'received', 'draft_created', 'follow_up_sent'
create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  thread_id uuid references email_threads(id) on delete set null,
  gmail_message_id text,
  event_type text not null,
  template_id uuid references email_templates(id) on delete set null,
  subject text,
  occurred_at timestamptz not null default now()
);
create index if not exists email_events_contact_idx on email_events (contact_id);
create index if not exists email_events_occurred_idx on email_events (occurred_at desc);
create index if not exists email_events_type_idx on email_events (event_type);

-- This app has no auth layer; disable RLS to match the other tables.
-- If you later add auth, replace this with proper policies.
alter table email_templates disable row level security;
alter table gmail_credentials disable row level security;
alter table email_threads disable row level security;
alter table email_events disable row level security;

-- Seed a few starter templates if the table is empty so the user has something
-- to play with immediately. Safe to re-run; only inserts when no rows exist.
insert into email_templates (name, category, subject, body)
select * from (values
  (
    'Cold outreach',
    'Cold email',
    'Quick question about [company]',
    E'Hi [name],\n\nI hope you''re doing well. I came across your background at [company] and was really impressed by the work your team is doing on [custom].\n\nI''m exploring opportunities in [role]-type roles and would love to learn more about your experience there. Would you have 15-20 minutes for a quick chat in the coming weeks?\n\nThanks so much,\nShane'
  ),
  (
    'Follow-up #1',
    'Follow-up',
    'Re: Quick question about [company]',
    E'Hi [name],\n\nJust wanted to gently bump this in case it got buried. Totally understand if now isn''t a good time — happy to revisit whenever works for you.\n\nThanks again,\nShane'
  ),
  (
    'Thanks after chat',
    'Thank you',
    'Thanks for the chat!',
    E'Hi [name],\n\nThanks again for taking the time today — really enjoyed hearing about [custom] and your perspective on [company]''s direction.\n\nI''ll [custom] and circle back next week. Let me know if there''s anything I can do to be helpful in the meantime.\n\nBest,\nShane'
  )
) as seed(name, category, subject, body)
where not exists (select 1 from email_templates);
