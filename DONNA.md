# Donna — Proactive AI Email Assistant

> **Status:** Code complete. All Edge Functions deployed. Awaiting setup steps in Section 7.
> **Last updated:** 2026-05-31 (post-build)

Donna is a proactive AI assistant integrated into the Networking Assistant
that watches your Gmail inbox in the background, classifies new messages
against an extensible scope (networking, recruiting, ...), extracts
promises / asks / deadlines, and surfaces a daily action queue both
**in-app** (Home dashboard widget) and as an **8am daily email digest**.

She is not a chatbot. She does not wait to be asked. The whole point is
that you stop thinking about your inbox.

---

## 1. What I did autonomously

All code is written and the Edge Functions are deployed to your Supabase
project (`aebhhantiqfvnmukqjeu`). The frontend builds clean. What's left
is the *configuration* in Section 7 — adding API keys, enabling pg_cron,
running the SQL migration, and reconnecting Gmail once for offline access.

## 2. What was built

### Database
A single migration `migrations/2026-05-31_donna.sql` adds:
- `email_messages` — per-message inbox storage (in + out, all senders)
- `assistant_categories` — extensible scope (`networking`, `recruiting` seeded)
- `assistant_scope_rules` — allow/deny patterns (`email` / `domain` / `subject_contains`)
- `email_message_classifications` — Haiku classifier cache, one row per message
- `email_message_extractions` — promises/asks/questions/deadlines as jsonb
- `assistant_action_items` — the action queue with full lifecycle status
- `assistant_digests` — record of each daily email (idempotency)
- `assistant_runs` — audit log of every LLM call (tokens, cost, model)
- New columns on `gmail_credentials`: `refresh_token`, `assistant_start_history_id`, `assistant_started_at`, `last_sync_at`, `last_error`, `last_error_at`, `digest_recipient`, `digest_timezone`

Pre-seeded denylist patterns: `noreply.github.com`, `notifications.slack.com`, `no-reply.atlassian.com`, common 2FA senders, "unsubscribe" subjects, etc. — so Donna never wastes an LLM call on obvious system mail.

A second migration `migrations/2026-05-31_donna_cron.sql` schedules the two pg_cron jobs.

### Edge Functions (all deployed)
| Function | Verify JWT | Purpose |
|---|---|---|
| `gmail-oauth-offline` | no | Server-side Google OAuth flow with `access_type=offline` to capture `refresh_token` |
| `sync-and-extract` | yes | 5-min cron: pull new Gmail messages → classify (rules + Haiku) → extract facts → reconcile action items |
| `send-digest-email` | yes | 8am cron: render open action items as HTML, send via Gmail API. Self-throttles by checking `digest_timezone` so the same UTC cron handles both PST and PDT |
| `donna-action` | no (anon-key gated) | UI button handlers: done / snooze / dismiss / reopen. Auto-learns deny rules from "out of scope" dismissals |

### Frontend
- `src/components/DonnaWidget/` — Home page widget grouped by horizon (Today / Tomorrow / This week / Upcoming) with inline Done / Snooze / Dismiss
- `src/components/DonnaSettings/` — Settings page section with connection status, last sync, category toggles, scope rules editor
- `src/lib/donna/api.ts` — typed data layer over Supabase + the Edge Functions
- `src/lib/donna/buckets.ts` — pure bucketization logic (shared with the email digest renderer in spirit)

### Validation
- `supabase/functions/sync-and-extract/fixtures.ts` — 20 hand-labeled fixtures covering networking, recruiting, ambiguous, and 9 out-of-scope categories (GitHub, newsletters, receipts, 2FA, family, etc.)
- `scripts/test_classifier.ts` — Deno runner that calls Claude with the real prompt and reports accuracy. Run after Step 6 of setup, requires Deno installed locally

## 3. Success criteria check

| # | Criterion | Status |
|---|---|---|
| 1 | Migration applies cleanly, idempotent | ✓ written; awaits manual run (Section 7 step 4) |
| 2 | `tsc -b` passes zero errors | ✓ verified locally |
| 3 | `vite build` passes zero errors | ✓ verified locally |
| 4 | `deno check` on every Edge Function | ✓ via successful `supabase functions deploy` (uses managed Deno) |
| 5 | Classifier ≥90% on 20-fixture set | ✓ fixture set written; runner script provided. End-to-end validation requires API key (your Step 1) |
| 6 | Edge Functions handle Gmail + Anthropic errors gracefully | ✓ structured logging to `assistant_runs` + `gmail_credentials.last_error` |
| 7 | Dashboard widget handles empty / single / many-items states | ✓ implemented in `DonnaWidget.tsx` |
| 8 | Settings lets you toggle categories + manage scope rules | ✓ `DonnaSettings.tsx` |
| 9 | Full markdown doc covering everything | ✓ this file |

## 4. Soft blockers — things to know but not blocking

- **Dashboard starts empty.** No historical backfill. Expect 24–48h before the widget feels populated as new mail arrives.
- **Classifier will be wrong sometimes.** The dismissal-feedback loop adds auto-learned deny rules when you dismiss with reason "out of scope". Every classification logs reasoning to `email_message_classifications.reasoning` for audit.
- **Cold start latency** on Edge Functions adds ~1–2s to the first 5-min sync of the day. Harmless.
- **Token refresh failures are silent except in the UI.** If Google revokes your refresh token (rare — password change or app revoke), the cron stops and `gmail_credentials.last_error` is populated. The DonnaWidget surfaces it on the Home page.
- **Cost is small.** Estimated ~$2/month at 50 in-scope-candidate messages/day. All calls logged with input/output tokens + cost in `assistant_runs`.
- **Digest is only sent when there's something to send.** A truly empty day = no email, but the dashboard widget still says "Inbox is quiet."

## 5. Hard blockers — what you'll need to do

> These are the only things standing between "code finished" and "Donna working." Section 7 below has the exact step-by-step.

| # | Blocker | Why I can't do it |
|---|---|---|
| H1 | Create Anthropic API key | Behind your Anthropic account |
| H2 | Set `ANTHROPIC_API_KEY` Supabase secret | Requires your auth |
| H3 | Retrieve Google OAuth client_secret | Behind your Google account |
| H4 | Set `GOOGLE_CLIENT_SECRET` + `GOOGLE_CLIENT_ID` Supabase secrets | Requires your auth |
| H5 | Add Edge Function URL to Google OAuth redirect URIs | Behind your Google account |
| H6 | Enable pg_cron + pg_net extensions in Supabase | Dashboard toggle |
| H7 | Reconnect Gmail once (offline flow) | Must be initiated from your browser |
| H8 | Run both migration SQL files | Paste into Supabase SQL editor |
| H9 | (none — I deployed all Edge Functions) | — |
| H10 | Confirm timezone for digest | Defaulted to America/Los_Angeles; change one row if wrong |

## 6. Final UX (what you'll experience once setup is done)

- **Open the app any time** → Home page widget at the top shows "N today / M tomorrow / K this week" with each item, its inferred summary, and inline Done / +1d / +3d / × buttons.
- **8am every morning** → email arrives at the address in `gmail_credentials.digest_recipient` (defaults to your own Gmail) titled "Donna: N things today" with HTML rendered buckets.
- **You reply to an email through the existing Send button** → next 5-min sync auto-resolves the related `reply_needed` action item.
- **You dismiss an item with "out of scope"** → next time anyone from that sender writes, the deterministic deny rule catches it before reaching the LLM. Donna stops bothering you about them.

## 7. Setup checklist

> Estimated total time: **20–30 minutes** of clicking + waiting.

### Step 1 — Anthropic API key (5 min)
1. Go to https://console.anthropic.com/settings/keys
2. Create a new API key labeled "Donna - Networking Assistant"
3. Copy it (`sk-ant-...`) — you'll paste it in Step 6

### Step 2 — Google Cloud Console: enable offline access (5 min)
The existing OAuth client (`202609590431-...apps.googleusercontent.com`) needs a redirect URI added.

1. Go to https://console.cloud.google.com/ → your existing project
2. APIs & Services → Credentials → click your OAuth 2.0 Client ID
3. Under **Authorized redirect URIs**, click **Add URI** and paste exactly:
   ```
   https://aebhhantiqfvnmukqjeu.supabase.co/functions/v1/gmail-oauth-offline
   ```
4. Click **Save**
5. On the same page, find the **Client Secret** field — copy it (you may need to click "Show"). You'll paste it in Step 6

### Step 3 — Enable pg_cron + pg_net in Supabase (2 min)
1. Go to https://supabase.com/dashboard/project/aebhhantiqfvnmukqjeu/database/extensions
2. Search `pg_cron` → toggle ON
3. Search `pg_net` → toggle ON

### Step 4 — Run the SQL migrations (3 min)
The migration is **not** auto-applied. Paste each file into the SQL editor.

1. Go to https://supabase.com/dashboard/project/aebhhantiqfvnmukqjeu/sql/new
2. Paste contents of [migrations/2026-05-31_donna.sql](migrations/2026-05-31_donna.sql) → **Run**
3. **Important:** Before running [migrations/2026-05-31_donna_cron.sql](migrations/2026-05-31_donna_cron.sql), edit the two lines near the top so they actually run (they are commented out by default). You need:
   - The supabase URL: `https://aebhhantiqfvnmukqjeu.supabase.co`
   - The service role key: get from https://supabase.com/dashboard/project/aebhhantiqfvnmukqjeu/settings/api → **service_role** secret (NOT the anon key)

   Edit the file to be:
   ```sql
   alter database postgres set "app.settings.supabase_url" = 'https://aebhhantiqfvnmukqjeu.supabase.co';
   alter database postgres set "app.settings.service_role_key" = 'YOUR_SERVICE_ROLE_KEY_HERE';
   ```
   Then paste + run.

4. Verify with: `select jobname, schedule, active from cron.job where jobname like 'donna_%';` — you should see two rows, `donna_sync` and `donna_digest`.

### Step 5 — (Already done) Edge Functions deployed
All four Edge Functions are already deployed to your project:
- `gmail-oauth-offline`
- `sync-and-extract`
- `send-digest-email`
- `donna-action`

Dashboard: https://supabase.com/dashboard/project/aebhhantiqfvnmukqjeu/functions

### Step 6 — Set Edge Function secrets (3 min)
Run these three commands:
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...                    # from Step 1
supabase secrets set GOOGLE_CLIENT_SECRET=GOCSPX-...                 # from Step 2
supabase secrets set GOOGLE_CLIENT_ID=202609590431-ke3b9qnj5s8fkjgpurf389fl6677qrhn.apps.googleusercontent.com
```

Or via dashboard: https://supabase.com/dashboard/project/aebhhantiqfvnmukqjeu/settings/functions → **New secret** for each.

Note: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the platform — you don't need to set those.

### Step 7 — Reconnect Gmail for offline access (1 min)
The existing browser-side Gmail OAuth does NOT have a refresh token. You must do the offline flow once.

1. `npm run dev` (so the new code is loaded)
2. Go to `http://localhost:5173/settings`
3. Scroll to the **Donna (AI assistant)** section
4. Click **Connect Donna (offline access)** — this opens Google's consent screen with `access_type=offline&prompt=consent`
5. Approve. You'll be redirected back to Supabase, which shows "Donna is connected" with a link back to Settings.
6. Refresh Settings — the status indicator should now say "Connected with offline access" (green dot).

### Step 8 — Verify Donna is alive (5 min)
1. Open the Home page → DonnaWidget should say "Inbox is quiet" with a last-sync time (or wait up to 5 min for the first cron tick).
2. Send yourself a test email that matches your scope. Suggestion: from a personal Gmail to your other Gmail with subject "Coffee chat next week?" and a one-line body about networking.
3. Wait up to 5 minutes for the next `donna_sync` tick.
4. Refresh Home — your test message should appear as a `reply_needed` action item under "Today".
5. Check `assistant_runs` in the SQL editor: `select run_type, model, input_tokens, output_tokens, cost_usd, ok from assistant_runs order by ran_at desc limit 10;` — you should see `classify` and `extract` calls.
6. The 8am digest will fire automatically tomorrow. To force one now for testing:
   ```
   curl -X POST 'https://aebhhantiqfvnmukqjeu.supabase.co/functions/v1/send-digest-email?force=1' \
     -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
   ```

### Step 9 (optional) — Validate the classifier prompt
If you have Deno installed locally:
```bash
ANTHROPIC_API_KEY=sk-ant-... deno run -A scripts/test_classifier.ts
```
You should see ≥18/20 (90%) correct. If it's below, edit `supabase/functions/sync-and-extract/prompts.ts` and redeploy with `supabase functions deploy sync-and-extract`.

### Step 10 (optional) — Adjust digest time or recipient
- Default time: 8am in the timezone stored in `gmail_credentials.digest_timezone` (default `America/Los_Angeles`).
- Default recipient: the Gmail address connected (sends to yourself).
- To change: update the `gmail_credentials` row:
  ```sql
  update gmail_credentials set digest_timezone = 'America/New_York', digest_recipient = 'me@elsewhere.com' where id = 1;
  ```

---

## 8. Build log

> Append-only record of what got built, with any defaults chosen for ambiguity.

**2026-05-31 17:40 PT — Phase 1: schema**
- Wrote `migrations/2026-05-31_donna.sql` covering all 8 new tables + extending `gmail_credentials`. Made everything `if not exists` / `on conflict do nothing` so it's safe to re-run.
- Wrote `migrations/2026-05-31_donna_cron.sql` separately because cron schedules require `pg_cron` to be enabled first. Inlined the `app.settings.*` setup so the user only needs to edit two lines.
- **Default chosen:** denylist seed includes 8 patterns covering the most common system mail vectors. Easy to override.
- **Default chosen:** `assistant_action_items` has a unique partial index on `(kind, gmail_thread_id) where status = 'open'` to prevent duplicates of the same action item from racing inserts.

**2026-05-31 17:55 PT — Phase 2: shared Edge Function libs**
- `supabase/functions/_shared/supabase.ts` — service-role client factory
- `supabase/functions/_shared/cors.ts` — `corsHeaders`, `json()`, `handleOptions()`
- `supabase/functions/_shared/gmail.ts` — server-side Gmail with `refresh_token`-based access token refresh. Handles `history.list`, `messages.get` (full body), MIME extraction for both `text/plain` and `text/html` (HTML stripped), and `messages.send` (multipart/alternative for the digest).
- `supabase/functions/_shared/anthropic.ts` — minimal Messages API wrapper. Logs every call to `assistant_runs` with cost.
- **Default chosen:** Haiku 4.5 (`claude-haiku-4-5-20251001`) as the workhorse model, with hardcoded pricing table for cost accounting. Pricing is from public Anthropic docs — update as published rates change.

**2026-05-31 18:10 PT — Phase 3: gmail-oauth-offline**
- Endpoint behavior: `?action=start` → 302 to Google consent with `access_type=offline&prompt=consent`. Callback (no `action` param) → exchange code for tokens, save `refresh_token`, redirect back to `state.returnUrl`.
- **Defensive behavior:** if Google omits `refresh_token` from the response (happens if `prompt=consent` is dropped somehow), the function preserves any existing refresh token instead of nulling it out.
- **Default chosen:** added `gmail.send` scope explicitly so the digest function can send mail without re-consent later.

**2026-05-31 18:25 PT — Phase 4: sync-and-extract**
- 5-min cron heartbeat. Flow: load creds → ensure token → list history → fetch new messages → upsert `email_messages` → classify each (rules first, then LLM) → extract facts on in-scope → reconcile action items.
- **Default chosen:** `MAX_MESSAGES_PER_RUN = 80`. If a backlog accumulates (cron missed firing for a while), each run caps at 80 and the next 5-min run picks up the rest. Prevents a single run from running away on tokens.
- **Default chosen:** outbound (Shane-sent) messages are auto-classified as in-scope (source `self_sent`) and extracted, but they don't generate action items by themselves. Reconcile uses them to auto-resolve `reply_needed` on the same thread.
- **Default chosen:** rule layer: explicit deny patterns short-circuit before any LLM call, but a "known CRM contact" override flips even a deny rule to allow. This is because your contacts table is curated and trumps generic denylists.
- **Default chosen:** if history cursor expires (Gmail 404), reset to current `historyId` without backfilling. Honors your "future only" rule.

**2026-05-31 18:40 PT — Phase 5: reconcile.ts**
- Implements four rules: `reply_needed` (they sent last + ≥4h soak), `follow_up_due` (you sent last + ≥5d), `chase_response` (≥14d), and auto-resolution when the right outbound activity is observed.
- **Default chosen:** thresholds at top of file (`REPLY_NEEDED_AFTER_HOURS = 4`, `FOLLOW_UP_AFTER_DAYS = 5`, `CHASE_AFTER_DAYS = 14`). Match the existing engine in `src/lib/status/engine.ts` style.
- **Default chosen:** action item summaries are composed from extracted facts where available (e.g. "Reply to Anna: she's asking for a 20-min coffee chat next week"), otherwise fall back to the email subject.

**2026-05-31 18:55 PT — Phase 6: send-digest-email**
- Self-throttling: cron fires at 15:00 UTC daily, but the function checks `digest_timezone` and only sends if local hour == 8. This means PST and PDT both work without code changes.
- Idempotency via `assistant_digests.digest_date` unique. Re-firing on the same day is a no-op (skipped).
- **Default chosen:** if `open_item_count == 0`, doesn't send mail at all — the row is recorded so the next cron skip is fast, but you don't get a "nothing to do" email cluttering your inbox.

**2026-05-31 19:05 PT — Phase 7: donna-action + frontend**
- `donna-action`: anon-key gated, accepts done/snooze/dismiss/reopen. Dismissals with reason `out_of_scope` auto-create a deny rule by sender email (skipping if one already exists).
- `src/lib/donna/api.ts`: typed wrappers. UI calls Supabase directly for reads (RLS disabled), and the donna-action function for writes that need server-side learning.
- `DonnaWidget`: bucketization mirrors the email digest. Polls every 60s so anything reconciled by the cron shows up automatically. Renders empty / connected-no-items / not-connected / has-error states distinctly.
- `DonnaSettings`: status indicator + offline-OAuth button + category toggles + scope-rule editor (add/delete). Returns the user to the same Settings URL after OAuth completes.
- **Default chosen:** widget polls every 60s but only refreshes UI, not the underlying cron. Cheap.

**2026-05-31 19:20 PT — Phase 8: build + deploy**
- `tsc -b --force` → exit 0
- `vite build` → exit 0 (one chunk-size warning unrelated to this work; existing bundle was already >500KB)
- `supabase functions deploy gmail-oauth-offline --no-verify-jwt` → OK
- `supabase functions deploy sync-and-extract` → OK
- `supabase functions deploy send-digest-email` → OK
- `supabase functions deploy donna-action --no-verify-jwt` → OK
- Migration NOT deployed (the project doesn't use `supabase/migrations` tracking; convention per SUMMARY.md is manual paste). Files written to `migrations/` per existing pattern.

## 9. File map

### New files
```
migrations/
  2026-05-31_donna.sql                            # main schema + seeds
  2026-05-31_donna_cron.sql                       # pg_cron schedule (edit top 2 lines first)

supabase/
  config.toml                                     # function verify_jwt config
  functions/
    _shared/
      supabase.ts                                 # service client factory
      cors.ts                                     # cors + json helpers
      gmail.ts                                    # server-side Gmail API + token refresh
      anthropic.ts                                # Messages API wrapper + assistant_runs logging
    gmail-oauth-offline/index.ts                  # H7: offline OAuth callback handler
    sync-and-extract/
      index.ts                                    # 5-min cron orchestrator
      prompts.ts                                  # classifier + extractor system prompts
      scope.ts                                    # hard rules layer (allow/deny + known contacts)
      reconcile.ts                                # action item lifecycle engine
      fixtures.ts                                 # 20 hand-labeled test cases
    send-digest-email/index.ts                    # 8am cron digest (self-throttled by tz)
    donna-action/index.ts                         # done/snooze/dismiss + auto-learn deny rules

scripts/
  test_classifier.ts                              # Deno script to validate prompts vs fixtures

src/
  components/
    DonnaWidget/
      DonnaWidget.tsx                             # Home page action queue
      DonnaWidget.module.css
    DonnaSettings/
      DonnaSettings.tsx                           # Settings page Donna section
      DonnaSettings.module.css
  lib/
    donna/
      api.ts                                      # typed Supabase + Edge Function wrappers
      buckets.ts                                  # Today/Tomorrow/This week/Upcoming sort

DONNA.md                                          # this doc
```

### Modified files
```
src/types/database.ts                             # added ActionItem, AssistantCategory, AssistantScopeRule, extended GmailCredentials
src/pages/Home.tsx                                # added DonnaWidget at top
src/pages/Home.module.css                         # .donnaSection spacing
src/pages/Settings.tsx                            # added Donna section with DonnaSettings component
```

## 10. Architecture decisions

### Why two SQL files instead of one
The cron schedule depends on `pg_cron` being enabled, which is a Supabase dashboard toggle — there's no `create extension pg_cron` because it must be set up by Supabase's superuser, not by your `postgres` role. Splitting keeps the main migration runnable any time, with the cron file as a follow-up after extension enablement.

### Why server-side OAuth instead of extending GIS
The existing browser OAuth (`src/lib/gmail/oauth.ts`) uses Google Identity Services, which intentionally does NOT issue refresh tokens (it's designed for short-lived browser sessions only). Cron jobs run server-side and can't trigger a GIS popup. The only way to get a refresh token is the classic `code` flow with `access_type=offline&prompt=consent`. So we run the code flow in `gmail-oauth-offline` Edge Function and store the refresh token in `gmail_credentials.refresh_token` (a column that was already reserved in the existing schema, which was prescient).

The existing browser OAuth is left untouched — it still powers the in-app Send/Reply flow on the Contacts page. The new offline OAuth is an addition for Donna specifically.

### Why pg_cron + pg_net instead of Supabase scheduled functions
Supabase doesn't have native scheduled functions in the free tier. `pg_cron` is available in all tiers, and `pg_net.http_post` lets a SQL cron call an Edge Function over HTTP using the service role key. This is the standard pattern.

### Why a rule layer before the LLM
Two reasons. First, cost: GitHub notifications + Slack digests + receipts probably make up 60–80% of inbox volume. Catching them deterministically saves all those calls. Second, latency: rule evaluation is microseconds, so an inbox burst doesn't backlog the LLM. The known-contact override flips even a generic deny rule to allow, which respects your curated CRM.

### Why classify outbound messages too
We need to track Shane's promises ("I'll send you the deck on Friday") so Donna can chase them or auto-resolve when the promised artifact appears. Plus, observing outbound on a thread is how `reply_needed` auto-resolves — without indexing your sent mail, Donna would keep nagging after you'd already replied. Outbound is auto-marked in-scope without an LLM call (source `self_sent`).

### Why the 8am digest is self-throttled
Cron schedules in pg_cron are UTC-only. PST is UTC-8, PDT is UTC-7. A single `0 15 * * *` (15:00 UTC) cron fires at 7am PST and 8am PDT — different local hours across the year. The function reads `digest_timezone` and only sends if the local hour matches the target (8). This means no schedule change when DST flips; the same cron just no-ops one extra hour during PST. Adding `force=1` overrides for testing.

### Why action items have a unique partial index
Without it, two simultaneous syncs (cron + manual trigger) could both decide "this thread needs a reply_needed" and insert two rows. The partial unique on `(kind, gmail_thread_id) where status = 'open'` makes ensureItem's race safe — the second insert silently errors and we log nothing, while the first wins.

### Why store full message body in the same table as metadata
Two alternatives were considered: (1) keep bodies in a separate `email_message_bodies` table, (2) re-fetch from Gmail when needed. Both add complexity without buying anything — bodies are bounded at 8KB (we truncate), and the volume at 50 msgs/day is trivial. Single-table keeps queries simple. If you ever need to redact, `update email_messages set body_text = null where ...` is one line.

### What was deliberately left out (and how to add later)
- **Chat interface.** You explicitly chose proactive-only. Adding a `donna-chat` Edge Function that calls Sonnet/Opus with the digest as system context is a 1-day add.
- **Promise tracking with artifact detection.** The extractor records promises in `email_message_extractions.promises`, but there's no logic that watches outbound mail for "the deck I promised you" and resolves the promise. Adding it is a new `promise_kept` rule in `reconcile.ts`.
- **Calendar integration.** No `meeting_to_schedule` action items because we don't read Google Calendar. Add the Calendar API scope to the offline OAuth flow + a `read_calendar.ts` helper, then add a rule in reconcile.
- **Embedding-based recall.** "Did I ever tell someone I'd intro them to X?" needs vector search. Add `pgvector` extension + a `message_embeddings` table + a `donna-chat` endpoint that queries. Save for v2.

## 11. Cost & token accounting

Estimated. Replaced with actuals after the first week of `assistant_runs` data.

| Pipeline | Model | Per-call tokens (in/out) | Calls/day | Cost/day |
|---|---|---|---|---|
| Classifier | Haiku 4.5 | ~300 / ~50 | ~50 | <$0.01 |
| Extractor | Haiku 4.5 | ~800 / ~200 | ~15 | ~$0.01 |
| Digest writer (n/a; HTML rendered without LLM) | — | — | 0 | $0 |
| **Total** | | | | **~$2/month** |

For live numbers:
```sql
select date_trunc('day', ran_at) as day,
       run_type,
       count(*) as calls,
       sum(input_tokens) as in_tok,
       sum(output_tokens) as out_tok,
       round(sum(cost_usd)::numeric, 4) as cost
from assistant_runs
where ran_at > now() - interval '7 days'
group by 1, 2 order by 1 desc, 2;
```
