# Threads Board — what was built and what you need to do

The Threads Board is now live on the Home page. This doc summarizes every
change made and lists the manual steps you need to complete before the
feature works end-to-end.

---

## TL;DR — manual steps you must do

1. **Run the new SQL migration in Supabase** (creates two new tables).
2. **Open the Home page** — that's where the board lives.
3. (Optional) Click the gear icon on the board to retune the rules.

That's it. Everything else is automatic.

---

## 1. Run the SQL migration

A new migration was added at:

```
migrations/2026-06-07_create_threads_board.sql
```

It creates two tables and seeds one row. **Open the Supabase SQL editor and
paste the file's contents in, then run it.** Idempotent — safe to re-run.

What it does:
- `app_settings` — single-row table holding the configurable rules
  (`follow_up_after_days` default 5, `reengage_after_days` default 14).
  Seeded automatically if empty.
- `gmail_ignored_threads` — small cache used during incremental Gmail sync
  to avoid re-fetching irrelevant threads (newsletter notifications, etc.).

No changes to any existing tables.

---

## 2. What now appears on the Home page

The three placeholder stat cards on the Home page have been replaced with
a "Threads" board:

```
┌────────────────┬────────────────┬────────────────┐
│ SENT           │ FOLLOW-UP      │ REPLY          │
│ (waiting,      │ (≥N days,      │ (their turn —  │
│ no follow-up   │ no reply yet)  │ they replied   │
│ due yet)       │                │ last)          │
└────────────────┴────────────────┴────────────────┘
```

Column order is **Sent → Follow-up → Reply**, as you requested.

Each card shows:
- Contact name (with "1st outreach", "2nd outreach"… tag if this is a cold
  thread that has never received a reply; capped at "5+ outreach")
- Company + role (small, dimmer)
- Last-message subject (truncated)
- Relative time
- A "Follow up →" or "Reply →" CTA in the corresponding column

Empty columns show neutral text ("No follow-ups due", etc.). If Gmail isn't
connected, a banner appears across the top linking to Settings.

**Clicking any card opens the email composer in *reply mode*** — same Gmail
thread, subject prefilled with "Re: …", proper `In-Reply-To` headers so
Gmail and every other client thread it correctly.

---

## 3. The Rules modal (gear icon)

Top-right of the board header. Two configurable numbers:
- **Move to Follow-up after N days with no reply** (default 5)
- **Mark as Re-engage after N days with no reply** (default 14)

Validation: re-engage must be ≥ follow-up; both must be ≥ 1. Persisted to
`app_settings`. Changes apply immediately, no refresh needed.

---

## 4. Cold-outreach matching (Gmail → board)

The Gmail sync was widened so emails you send directly from Gmail (not
through the app's composer) also show up on the board.

### How it works
- **Incremental discovery:** when the 30s sync sees activity on a thread we
  don't track yet, it fetches the thread metadata, checks if the `To:`
  address matches a known contact, and creates an `email_threads` row if so.
  Threads that don't match any contact are cached in `gmail_ignored_threads`
  so we don't re-fetch them next poll.
- **Per-contact rescan:** when you add a new contact or edit their email
  address in the Contacts page, the app runs a one-shot Gmail query
  (`in:sent to:<email> newer_than:90d`) and creates thread rows for any
  matches. Happens automatically, in the background, no button to click.

### What this means for you
- **Add contact first, then email from Gmail** → tracked within 30s.
- **Email from Gmail first, then add contact** → tracked the moment you
  save the email field on the contact (per-contact rescan, 90-day window).
- **They reply** → detected within 30s on the next sync.

### Limitations (intentional, v1)
- Matches are exact (case-insensitive) on the primary `To:` address only.
  No alias / plus-tag (`shane+work@`) handling. No CC/BCC matching.
- If you cold-emailed someone who isn't in your contacts, nothing happens
  — we don't auto-create contacts.
- The 90-day lookback for per-contact rescan is hardcoded for now.

---

## 5. Polling

The Home page polls Gmail every **30 seconds** while it's open and the tab
is visible. The Contacts page still polls every 60s (unchanged). Polling
pauses automatically when the tab is backgrounded.

---

## Files added

```
migrations/2026-06-07_create_threads_board.sql   ← run this
src/lib/settings/rules.ts                        ← rules load/save
src/lib/threads/board.ts                         ← board bucketing logic
src/components/ThreadsBoard/ThreadsBoard.tsx
src/components/ThreadsBoard/ThreadsBoard.module.css
src/components/RulesModal/RulesModal.tsx
src/components/RulesModal/RulesModal.module.css
```

## Files changed

```
src/types/database.ts                ← added AppSettings, GmailIgnoredThread
src/lib/status/engine.ts             ← deriveAction/Status now take rules param
src/lib/gmail/api.ts                 ← reply-in-thread headers, listSentThreadsTo
src/lib/gmail/sync.ts                ← incremental discovery, rescanContact
src/components/SendEmailModal/SendEmailModal.tsx  ← reply mode
src/pages/Home.tsx                   ← threads board + 30s polling
src/pages/Contacts.tsx               ← triggers rescanContact on email edit
```

No existing tables were modified. No edge functions. No new third-party
dependencies. `npm run build` passes clean.

---

## Things to know about how it behaves

- **First load after deploy:** if you've never run `syncGmail()`, the very
  first call will bootstrap — capture the current Gmail history cursor and
  scan all threads currently in `email_threads`. After that, syncs are
  incremental and fast (~1 round-trip).
- **Past Gmail outreach to existing contacts is NOT auto-imported.** This
  is intentional per your request to keep manual control. To pull in past
  outreach for a specific contact, just re-save their email field on the
  Contacts page — that triggers the per-contact rescan. Or send any new
  email from the app to bootstrap the thread.
- **Contacts page badges** still use the historical defaults (5 / 14) and
  do NOT read the rules modal yet. They'll keep working correctly as long
  as you don't change the defaults in the Rules modal. If you do retune,
  the Home board will reflect the new rules but the Contacts page status
  badges will lag. (Easy follow-up if it bugs you.)
- **Outreach attempt count** is computed from `email_events` on each board
  load. For threads that were created before this feature shipped (i.e.
  no `sent` events were logged for them), the tag will not show. New
  outbound sends will populate the count going forward.

---

## Verifying it works end-to-end

1. Run the migration in Supabase.
2. Open the app, navigate to Home.
3. You should see the three columns with whatever threads you already have
   bucketed appropriately. If Gmail isn't connected, you'll see the banner.
4. Click a card → reply modal opens with "Re: …" subject and threadId set.
   Send a test message — it should appear in the same Gmail thread.
5. Click the gear icon → Rules modal opens. Change a value → save → board
   re-buckets immediately.
6. Add a new contact with an email you've previously emailed from Gmail
   directly → within a few seconds the thread should appear in the board.
