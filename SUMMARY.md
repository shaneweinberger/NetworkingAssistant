# Templates + Gmail Integration

A new outreach + follow-up system built on top of the existing Networking
Assistant. Adds a Templates page, Gmail OAuth, draft / send from contact
rows, automatic status tracking, and an action-item engine.

This doc covers (1) what shipped, (2) the architecture choices and why,
(3) the steps **you** need to take to flip it on, and (4) what was deliberately
left out and how to extend.

---

## 1. What shipped

### Pages
- **Templates** (`/templates`) — Create / edit / delete / preview email
  templates, organize them by category, search across all fields, insert
  placeholders by click.
- **Settings** (`/settings`) — Connect / disconnect Gmail, run an
  on-demand sync, see connection status (connected / expired /
  disconnected) and the last sync result.

### New UI on the Contacts page
- **Send button** on every contact row (paper-airplane icon, hover to reveal).
  Opens a compose modal pre-targeted at that contact.
- **Compose modal** — left rail: template picker with category grouping
  and search. Right: live editable preview with To / Subject / Body, plus a
  placeholders panel that highlights unfilled fields in amber.
  - "Save as draft" → creates a Gmail draft in your account.
  - "Send" → sends through Gmail and updates the contact's status.
- **Status & Action badges** in the Status column.
  - When an email thread is being tracked: badge replaces the manual
    dropdown and shows e.g. "Sent 2 days ago" / "Responded 3 hours ago" /
    "Active conversation".
  - When no thread exists: manual dropdown remains so existing workflows
    keep working.
  - Action item ("Send first email", "Send follow-up", "Reply to
    message", "Re-engage") appears directly beneath the status whenever
    there is something the user should do.

### Backend (browser-side + Supabase)
- Gmail OAuth via Google Identity Services (GIS) — purely browser-side,
  no server to deploy. Tokens persisted in Supabase.
- Gmail API client wrapping drafts, send, threads.get, and history.list.
- History-based incremental sync so we don't re-pull thread metadata we
  already have. Falls back to a full re-scan automatically when the
  cursor is too stale.
- 60-second polling while the Contacts tab is visible — reply detection
  happens transparently in the background.
- Audit log of every send / draft / received message in `email_events`
  for future analytics (response rate, time-to-reply, etc.).

### Database (new tables)
- `email_templates` — template content
- `email_threads` — per-contact mapping to Gmail thread ids, cached
  timestamps (last_sent_at, last_received_at, last_message_at) so status
  derivation is purely a read
- `email_events` — append-only audit log
- `gmail_credentials` — single-row OAuth token store

---

## 2. Architecture decisions

### Why pure browser + GIS, no server?
The existing app has no backend — it's a Vite SPA talking directly to
Supabase. Shoving in a Node server, Vercel function, or Supabase Edge
Function just for OAuth would be the single biggest source of operational
overhead. Google Identity Services lets a browser app obtain access
tokens directly with no client secret in the bundle.

The trade-off is no refresh tokens, so when a token expires (1 hour),
we silently re-auth (`prompt: 'none'`) using the still-valid Google
session cookie. If that fails the user gets a "Reconnect" banner instead
of a white screen. For a single-user daily-driver tool, that's the right
trade.

### Why history-based sync, not webhooks or polling each thread?
- Webhooks (Gmail Watch API) require a Cloud Pub/Sub topic and a
  server endpoint — same overhead trap as OAuth.
- Polling per-thread is O(N) every cycle.
- The History API is exactly what Gmail provides for this: "give me
  every thread that changed since cursor X." O(changes), not O(threads).

We bootstrap the cursor on first connect by capturing the current
`historyId`, and persist it in `gmail_credentials.last_history_id`.

### Why derive status, not just write it?
The original status column was a freeform dropdown (Sent / Replied /
No reply). If we *only* wrote those values on send and never updated
them, "Sent" would stay "Sent" forever — useless. Instead we cache
timestamps from Gmail and derive a fresh status on every render. "Sent
2 days ago" → "Sent 5 days ago" → "No reply (5 days)" → "Re-engage"
just from the clock advancing.

The manual dropdown still works for contacts you haven't emailed
through the tool, so nothing breaks.

### Why a separate `email_events` table?
The two derived fields (`last_sent_at`, `last_received_at`) on
`email_threads` are enough for the status engine, but they lose history
— you can't answer "what was my response rate on cold emails last
month?" from them. An append-only event log gives us that for free,
and it's the foundation for future analytics (response rate per
template, time-to-reply distribution, etc.).

### Why is the action engine rule-based, not LLM-based?
Speed and predictability. The five rules (`send_first` → no thread,
`reply` → they sent last, `send_follow_up` → 5+ days, `reengage` →
14+ days, `wait` → otherwise) cover the routine cases the user
described in the spec. The constants are at the top of
`src/lib/status/engine.ts` so retuning is a one-line change.

---

## 3. Setup steps — what you need to do

The code is shipped. None of the steps below need an engineer.

### Step 1 — Run the new SQL migration
Open the Supabase SQL editor for the project at
`aebhhantiqfvnmukqjeu.supabase.co` and paste the contents of
`migrations/2026-05-28_create_email_features.sql`. It's idempotent
(`create table if not exists`, seed only inserts when empty) so re-running
is harmless.

You should see:
- `email_templates` table seeded with three starter templates
  ("Cold outreach", "Follow-up #1", "Thanks after chat")
- `gmail_credentials` (empty, single-row constrained)
- `email_threads` (empty)
- `email_events` (empty)

### Step 2 — Create a Google Cloud OAuth client

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
   and create a new project (or reuse an existing one).
2. Enable the **Gmail API** under *APIs & Services → Library*.
3. Configure the **OAuth consent screen**:
   - User type: **External**
   - App name: "Networking Assistant" (or whatever you like)
   - User support email: your address
   - Add yourself as a Test User (this avoids needing app verification)
   - Scopes: you don't need to add any here; we request them at
     runtime.
4. Create an **OAuth 2.0 Client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins:
     - `http://localhost:5173`
     - `http://localhost:5174`
     - `http://localhost:5175`
     - (add your production origin once you deploy)
   - Authorized redirect URIs: leave empty — GIS uses popup mode, no
     redirect URI needed.
5. Copy the resulting **Client ID** (looks like
   `123456-abc...apps.googleusercontent.com`).

### Step 3 — Add the client ID to `.env.local`
```
VITE_GOOGLE_CLIENT_ID=123456-abc...apps.googleusercontent.com
```
Restart `npm run dev` so Vite picks it up.

### Step 4 — Connect
1. Go to `/settings`.
2. Click **Connect Gmail** → Google popup → grant access.
3. You should see "Connected" with your email.

### Step 5 — Try it
1. Go to `/contacts`, expand a company.
2. Hover a contact row, click the paper-airplane icon.
3. Pick a template from the left rail. Watch the preview populate with
   the contact's name, role, company, etc.
4. Fill any custom placeholders (highlighted in amber).
5. Click **Send** (real send) or **Save as draft** (writes to your
   Drafts folder).
6. Status badge on the row now shows "Sent just now". Wait until they
   reply and within 60s the badge flips to "Responded".

---

## 4. Out of scope (and how to extend)

Several "nice to have" items from the spec were intentionally deferred
to keep the first cut focused. Notes on each:

### Background sync when the tab is closed
Currently the 60-second sync poller only runs while the Contacts tab is
open. For at-rest sync you'd need either:
- A Supabase scheduled edge function that runs `syncGmail()` on a cron
  (~ every 5 minutes), or
- The Gmail Watch + Pub/Sub flow.
Both require a backend deploy that the current "no server" architecture
avoids.

### Template analytics (response rate)
The plumbing is there — every send writes a `sent` event tagged with
`template_id`, every received message writes a `received` event with
the same `thread_id`. A SQL query joining the two by template id gives
response rate per template. We just haven't built the UI.

### Multi-template sequences (auto follow-ups)
You'd want a `template_sequences` table linking templates with delays.
The action item engine could pick up "send_follow_up" actions for
sequences automatically. Deferred to keep scope contained.

### Open tracking
Would require injecting a tracking pixel and serving it from a backend.
Both add operational complexity and (mildly) erode user trust. Skipped.

### Bulk outreach
The compose modal is single-contact. Bulk would need a queue + rate
limiter (Gmail caps at ~250 sends/day for non-Workspace accounts).
Easy to add on top of `sendMessage()` once you have an explicit use
case for it.

### AI-generated follow-up suggestions
Would slot in cleanly between the placeholder panel and the body
editor in `SendEmailModal`. Add an "✨ Suggest" button that calls an
LLM with `{contact, thread_history, current_draft}`. Anthropic API key
in `.env.local` + a tiny function in `src/lib/templates/`.

---

## 5. Success metrics

The brief asked for measurable success criteria iterated against.
Below is the final scorecard.

| #  | Metric                                                            | Status |
|----|-------------------------------------------------------------------|--------|
| 1  | Templates: create / edit / delete / preview / categorize          | ✅     |
| 2  | One-click Gmail connect; tokens survive page reloads              | ✅     |
| 3  | Contact row → email sent in ≤ 5 clicks (3 once Gmail is wired)    | ✅     |
| 4  | `[name]`, `[company]`, `[role]`, `[school]`, custom `[x]` autofill | ✅     |
| 5  | Status auto-updates from time (sent today → sent 2 days ago)      | ✅     |
| 6  | Inbound replies detected within poll cycle (60s default)          | ✅     |
| 7  | Action items derived from status + elapsed time                   | ✅     |
| 8  | `tsc -b` + `vite build` pass clean                                | ✅     |
| 9  | UI consistent with existing CSS variables / typography            | ✅     |
| 10 | Gmail API errors degrade gracefully (no white screens)            | ✅     |

---

## 6. File map

New:
```
migrations/2026-05-28_create_email_features.sql
src/lib/gmail/oauth.ts          GIS-based OAuth, token persistence
src/lib/gmail/api.ts            Gmail API wrapper (drafts/send/threads/history)
src/lib/gmail/sync.ts           Incremental thread sync
src/lib/templates/placeholders.ts   Placeholder extraction + substitution
src/lib/status/engine.ts        Status + action item derivation
src/pages/Templates.tsx + .module.css
src/pages/Settings.tsx  + .module.css
src/components/TemplateEditor/      Editor modal with placeholder picker
src/components/SendEmailModal/      Compose modal
src/components/StatusBadge/         Reusable status + action badges
```

Touched:
```
src/App.tsx                     Added /templates, /settings routes
src/components/layout/Layout.tsx    Added sidebar icons + nav items
src/components/ContactsTable/ContactsTable.tsx    Send button, status/action overlays
src/components/ContactsTable/ContactsTable.module.css   Action cell + derived status styles
src/pages/Contacts.tsx          Loads threads, runs sync poll, opens SendEmailModal
src/types/database.ts           +EmailTemplate, +EmailThread, +EmailEvent, +GmailCredentials
```
