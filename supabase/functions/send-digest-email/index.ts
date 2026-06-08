// Donna's daily 8am digest email.
//
// Runs from pg_cron at 15:00 UTC daily. The function itself checks whether
// "now" is within 1 hour of 8am in the configured user timezone; this lets
// the same cron schedule cover both PST and PDT without manual adjustment.
//
// Idempotent per-day: writes to assistant_digests with digest_date as a
// unique key, so a duplicate cron fire is a no-op.
import { makeServiceClient } from '../_shared/supabase.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { loadCreds, getAccessToken, sendRawMessage } from '../_shared/gmail.ts'

const TARGET_HOUR_LOCAL = 8

interface ActionItem {
  id: string
  kind: string
  status: string
  urgency: 'low' | 'med' | 'high'
  category: string | null
  summary: string
  detail: string | null
  due_at: string | null
  created_at: string
  gmail_thread_id: string | null
}

interface DigestBucket {
  label: string
  items: ActionItem[]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const db = makeServiceClient()
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'

  try {
    const creds = await loadCreds(db)
    if (!creds) return json({ ok: false, error: 'gmail not connected' })

    const tz = creds.digest_timezone || 'America/Los_Angeles'
    const recipient = creds.digest_recipient || creds.email
    if (!recipient) return json({ ok: false, error: 'no digest_recipient' })

    const now = new Date()
    const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now))
    if (!force && localHour !== TARGET_HOUR_LOCAL) {
      return json({ ok: true, skipped: `local hour ${localHour} != target ${TARGET_HOUR_LOCAL}` })
    }

    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now) // YYYY-MM-DD

    // Idempotency: skip if we already sent today
    const { data: existing } = await db.from('assistant_digests').select('id').eq('digest_date', localDate).maybeSingle()
    if (existing && !force) return json({ ok: true, skipped: 'already sent today' })

    // Load all open action items
    const { data: items, error } = await db
      .from('assistant_action_items')
      .select('*')
      .eq('status', 'open')
      .order('urgency', { ascending: false })
      .order('due_at', { ascending: true, nullsFirst: false })
    if (error) throw new Error('load action items: ' + error.message)

    const open = (items as ActionItem[] | null) ?? []
    const buckets = bucketize(open, tz)
    const html = renderHtml(buckets, open.length, localDate)
    const subject = open.length === 0
      ? 'Donna: nothing to do today'
      : `Donna: ${open.length} thing${open.length === 1 ? '' : 's'} today`

    const token = await getAccessToken(creds, db)
    let sent: { id: string; threadId: string } | null = null
    if (open.length > 0) {
      // Only send if there's actually something
      sent = await sendRawMessage(token, {
        to: recipient,
        fromEmail: creds.email ?? undefined,
        subject,
        htmlBody: html,
      })
    }

    await db.from('assistant_digests').upsert({
      digest_date: localDate,
      recipient,
      open_item_count: open.length,
      body_html: html,
      gmail_message_id: sent?.id ?? null,
    }, { onConflict: 'digest_date' })

    return json({ ok: true, sent: !!sent, open_item_count: open.length })
  } catch (err) {
    console.error('send-digest-email fatal:', err)
    return json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
})

function bucketize(items: ActionItem[], tz: string): DigestBucket[] {
  const now = new Date()
  const startOfToday = startOfDayInTz(now, tz)
  const startOfTomorrow = addDays(startOfToday, 1)
  const startOfDayAfter = addDays(startOfToday, 2)
  const startOfWeekEnd = addDays(startOfToday, 7)

  const today: ActionItem[] = []
  const tomorrow: ActionItem[] = []
  const thisWeek: ActionItem[] = []
  const upcoming: ActionItem[] = []

  for (const it of items) {
    const due = it.due_at ? new Date(it.due_at) : new Date(it.created_at)
    const ts = due.getTime()
    if (it.urgency === 'high' || ts < startOfTomorrow.getTime()) today.push(it)
    else if (ts < startOfDayAfter.getTime()) tomorrow.push(it)
    else if (ts < startOfWeekEnd.getTime()) thisWeek.push(it)
    else upcoming.push(it)
  }
  return [
    { label: 'Today', items: today },
    { label: 'Tomorrow', items: tomorrow },
    { label: 'This week', items: thisWeek },
    { label: 'Upcoming', items: upcoming },
  ].filter((b) => b.items.length > 0)
}

function startOfDayInTz(d: Date, tz: string): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d) // YYYY-MM-DD
  return new Date(`${ymd}T00:00:00`)
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000)
}

function renderHtml(buckets: DigestBucket[], totalOpen: number, date: string): string {
  const head = `<style>
body{font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;background:#f9f9f9;color:#0a0a0a;margin:0;padding:24px}
.box{max-width:600px;margin:0 auto;background:#fff;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden}
.head{padding:24px;border-bottom:1px solid #e8e8e8}
.head h1{margin:0;font-size:24px;font-weight:600;letter-spacing:-0.02em}
.head p{margin:8px 0 0;color:#6b6b6b;font-size:13px}
.bucket{padding:20px 24px;border-bottom:1px solid #e8e8e8}
.bucket:last-child{border-bottom:none}
.bucket h2{font-size:11px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:#a8a8a8;margin:0 0 12px}
.item{padding:12px 0;border-top:1px solid #f4f4f4}
.item:first-child{border-top:none}
.summary{font-size:14px;font-weight:500;margin:0 0 4px}
.detail{font-size:13px;color:#6b6b6b;margin:0}
.tag{display:inline-block;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;padding:2px 6px;border-radius:4px;margin-right:6px;vertical-align:1px}
.tag.high{background:#fff0f0;color:#cc0000}
.tag.med{background:#fff8e8;color:#aa6600}
.tag.low{background:#f4f4f4;color:#6b6b6b}
.kind{font-size:10px;color:#a8a8a8;text-transform:uppercase;letter-spacing:0.04em;margin-right:8px}
.foot{padding:16px 24px;color:#a8a8a8;font-size:12px;text-align:center;background:#f9f9f9}
.foot a{color:#0a0a0a;font-weight:500}
</style>`
  const head_block = `<div class="head"><h1>${totalOpen} thing${totalOpen === 1 ? '' : 's'} for today</h1><p>${date} · from Donna</p></div>`
  const buckets_html = buckets.map((b) => `
    <div class="bucket">
      <h2>${b.label}</h2>
      ${b.items.map(itemHtml).join('')}
    </div>`).join('')
  const foot = `<div class="foot">Open the app to act on these · <a href="https://localhost">View dashboard</a></div>`
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body><div class="box">${head_block}${buckets_html}${foot}</div></body></html>`
}

function itemHtml(item: ActionItem): string {
  const tag = `<span class="tag ${item.urgency}">${item.urgency}</span>`
  const kind = `<span class="kind">${kindLabel(item.kind)}</span>`
  const detail = item.detail ? `<p class="detail">${escapeHtml(item.detail)}</p>` : ''
  return `<div class="item"><p class="summary">${tag}${kind}${escapeHtml(item.summary)}</p>${detail}</div>`
}

function kindLabel(k: string): string {
  switch (k) {
    case 'reply_needed': return 'reply'
    case 'follow_up_due': return 'follow-up'
    case 'chase_response': return 're-engage'
    case 'promise_kept': return 'deliver'
    case 'review': return 'review'
    default: return k
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
