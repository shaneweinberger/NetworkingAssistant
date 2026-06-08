-- Donna — proactive AI email assistant
-- Run this in the Supabase SQL editor.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
-- pg_cron must be enabled via the Supabase dashboard first (Database -> Extensions).
-- pg_net is used to call Edge Functions from the cron jobs.
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1. Extend gmail_credentials for offline-access OAuth + Donna bookkeeping
-- ---------------------------------------------------------------------------
alter table gmail_credentials
  add column if not exists assistant_start_history_id text,
  add column if not exists assistant_started_at timestamptz,
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz,
  add column if not exists digest_recipient text,
  add column if not exists digest_timezone text default 'America/Los_Angeles';

-- ---------------------------------------------------------------------------
-- 2. email_messages — per-message inbox storage (in + out, all senders)
-- ---------------------------------------------------------------------------
create table if not exists email_messages (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,
  gmail_thread_id text not null,
  direction text not null check (direction in ('in', 'out')),
  from_email text,
  from_name text,
  to_emails text[],
  cc_emails text[],
  subject text,
  snippet text,
  body_text text,
  received_at timestamptz not null,
  ingested_at timestamptz not null default now()
);
create index if not exists email_messages_thread_idx on email_messages (gmail_thread_id);
create index if not exists email_messages_received_idx on email_messages (received_at desc);
create index if not exists email_messages_from_idx on email_messages (from_email);
create index if not exists email_messages_direction_idx on email_messages (direction);

-- ---------------------------------------------------------------------------
-- 3. assistant_categories — extensible scope
-- ---------------------------------------------------------------------------
create table if not exists assistant_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into assistant_categories (name, description, enabled)
select * from (values
  ('networking', 'Networking, alumni outreach, professional relationship building, coffee chats, intros, mentorship', true),
  ('recruiting', 'Recruiter outreach, job opportunities, interviews, offers, hiring conversations, internship discussions', true)
) as seed(name, description, enabled)
where not exists (select 1 from assistant_categories);

-- ---------------------------------------------------------------------------
-- 4. assistant_scope_rules — allow/deny patterns
-- ---------------------------------------------------------------------------
create table if not exists assistant_scope_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null check (rule_type in ('allow', 'deny')),
  match_type text not null check (match_type in ('email', 'domain', 'subject_contains')),
  pattern text not null,
  source text not null default 'user' check (source in ('user', 'auto_learned')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists assistant_scope_rules_match_idx on assistant_scope_rules (rule_type, match_type, pattern);

-- Seed common denylist patterns so the classifier never wastes a call on these.
insert into assistant_scope_rules (rule_type, match_type, pattern, source, notes)
select * from (values
  ('deny', 'domain', 'mailer-daemon.googlemail.com', 'user', 'bounces'),
  ('deny', 'domain', 'noreply.github.com', 'user', 'github notifications'),
  ('deny', 'domain', 'no-reply.atlassian.com', 'user', 'jira'),
  ('deny', 'domain', 'notifications.slack.com', 'user', 'slack'),
  ('deny', 'email', 'no-reply@accounts.google.com', 'user', 'google security'),
  ('deny', 'email', 'noreply@stripe.com', 'user', 'stripe'),
  ('deny', 'subject_contains', 'unsubscribe', 'user', 'mass marketing'),
  ('deny', 'subject_contains', 'verification code', 'user', '2fa codes')
) as seed(rule_type, match_type, pattern, source, notes)
where not exists (select 1 from assistant_scope_rules);

-- ---------------------------------------------------------------------------
-- 5. email_message_classifications — Haiku cache, one row per message
-- ---------------------------------------------------------------------------
create table if not exists email_message_classifications (
  gmail_message_id text primary key references email_messages(gmail_message_id) on delete cascade,
  in_scope boolean not null,
  category text,
  confidence numeric(3,2),
  reasoning text,
  source text not null default 'llm' check (source in ('llm', 'rule_allow', 'rule_deny', 'self_sent')),
  model text,
  classified_at timestamptz not null default now()
);
create index if not exists classifications_inscope_idx on email_message_classifications (in_scope);
create index if not exists classifications_category_idx on email_message_classifications (category);

-- ---------------------------------------------------------------------------
-- 6. email_message_extractions — per-message structured facts
-- ---------------------------------------------------------------------------
create table if not exists email_message_extractions (
  gmail_message_id text primary key references email_messages(gmail_message_id) on delete cascade,
  promises jsonb not null default '[]'::jsonb,
  asks jsonb not null default '[]'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  deadlines jsonb not null default '[]'::jsonb,
  summary text,
  model text,
  extracted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. assistant_action_items — the queue
-- ---------------------------------------------------------------------------
create table if not exists assistant_action_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'reply_needed', 'follow_up_due', 'promise_kept', 'chase_response', 'review'
  )),
  status text not null default 'open' check (status in ('open', 'snoozed', 'done', 'dismissed')),
  urgency text not null default 'med' check (urgency in ('low', 'med', 'high')),
  contact_id uuid references contacts(id) on delete set null,
  gmail_thread_id text,
  gmail_message_id text,
  category text,
  summary text not null,
  detail text,
  due_at timestamptz,
  snooze_until timestamptz,
  auto_resolved boolean not null default false,
  dismissal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists action_items_status_idx on assistant_action_items (status);
create index if not exists action_items_due_idx on assistant_action_items (due_at);
create index if not exists action_items_thread_idx on assistant_action_items (gmail_thread_id);
create index if not exists action_items_contact_idx on assistant_action_items (contact_id);
-- One open action item per (kind, thread) so we don't re-create what we already have.
create unique index if not exists action_items_open_unique
  on assistant_action_items (kind, gmail_thread_id)
  where status = 'open' and gmail_thread_id is not null;

-- ---------------------------------------------------------------------------
-- 8. assistant_digests — record of each daily email sent (idempotency)
-- ---------------------------------------------------------------------------
create table if not exists assistant_digests (
  id uuid primary key default gen_random_uuid(),
  digest_date date not null unique,
  recipient text not null,
  open_item_count integer not null,
  body_html text,
  sent_at timestamptz not null default now(),
  gmail_message_id text
);

-- ---------------------------------------------------------------------------
-- 9. assistant_runs — audit log of LLM calls
-- ---------------------------------------------------------------------------
create table if not exists assistant_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10,6),
  duration_ms integer,
  ok boolean not null default true,
  error text,
  metadata jsonb,
  ran_at timestamptz not null default now()
);
create index if not exists assistant_runs_type_idx on assistant_runs (run_type);
create index if not exists assistant_runs_ran_idx on assistant_runs (ran_at desc);

-- ---------------------------------------------------------------------------
-- RLS — match the rest of the app (no auth layer, single-tenant).
-- ---------------------------------------------------------------------------
alter table email_messages disable row level security;
alter table assistant_categories disable row level security;
alter table assistant_scope_rules disable row level security;
alter table email_message_classifications disable row level security;
alter table email_message_extractions disable row level security;
alter table assistant_action_items disable row level security;
alter table assistant_digests disable row level security;
alter table assistant_runs disable row level security;
