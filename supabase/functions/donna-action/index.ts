// UI button handlers for action items.
// Verifies caller has the Supabase anon key (browser app), then performs
// the requested state transition on assistant_action_items.
import { makeServiceClient } from '../_shared/supabase.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

type Action = 'snooze' | 'dismiss' | 'done' | 'reopen'

interface RequestBody {
  action: Action
  item_id: string
  snooze_days?: number
  dismissal_reason?: string
}

function isAuthorized(req: Request): boolean {
  // We accept either anon or service key; service-role auth check happens via the
  // Supabase platform layer when verify_jwt is true. verify_jwt is false on this
  // function so we self-check anon key here.
  const auth = req.headers.get('Authorization') ?? ''
  const apikey = req.headers.get('apikey') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const bearer = auth.replace(/^Bearer\s+/i, '')
  return [bearer, apikey].some((v) => v && (v === anon || v === service))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, { status: 405 })
  if (!isAuthorized(req)) return json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return json({ ok: false, error: 'invalid json' }, { status: 400 })
  }
  if (!body.action || !body.item_id) {
    return json({ ok: false, error: 'action and item_id required' }, { status: 400 })
  }

  const db = makeServiceClient()
  const now = new Date().toISOString()

  switch (body.action) {
    case 'done': {
      const { error } = await db.from('assistant_action_items').update({
        status: 'done',
        resolved_at: now,
        updated_at: now,
      }).eq('id', body.item_id)
      if (error) return json({ ok: false, error: error.message }, { status: 500 })
      return json({ ok: true })
    }
    case 'dismiss': {
      // Capture the reason, then optionally auto-learn a denylist rule.
      const { data: item, error: loadErr } = await db
        .from('assistant_action_items')
        .select('id, gmail_thread_id, gmail_message_id, dismissal_reason')
        .eq('id', body.item_id)
        .maybeSingle()
      if (loadErr) return json({ ok: false, error: loadErr.message }, { status: 500 })

      const { error } = await db.from('assistant_action_items').update({
        status: 'dismissed',
        dismissal_reason: body.dismissal_reason ?? null,
        resolved_at: now,
        updated_at: now,
      }).eq('id', body.item_id)
      if (error) return json({ ok: false, error: error.message }, { status: 500 })

      // Auto-learn: if reason is "out of scope" and we have the sender's email,
      // add a deny rule for that email.
      if (body.dismissal_reason === 'out_of_scope' && item?.gmail_message_id) {
        await maybeLearnDenyRule(db, item.gmail_message_id)
      }
      return json({ ok: true })
    }
    case 'snooze': {
      const days = body.snooze_days ?? 1
      const until = new Date(Date.now() + days * 86400000).toISOString()
      const { error } = await db.from('assistant_action_items').update({
        status: 'snoozed',
        snooze_until: until,
        due_at: until,
        updated_at: now,
      }).eq('id', body.item_id)
      if (error) return json({ ok: false, error: error.message }, { status: 500 })
      return json({ ok: true, snooze_until: until })
    }
    case 'reopen': {
      const { error } = await db.from('assistant_action_items').update({
        status: 'open',
        resolved_at: null,
        snooze_until: null,
        dismissal_reason: null,
        updated_at: now,
      }).eq('id', body.item_id)
      if (error) return json({ ok: false, error: error.message }, { status: 500 })
      return json({ ok: true })
    }
    default:
      return json({ ok: false, error: 'unknown action' }, { status: 400 })
  }
})

async function maybeLearnDenyRule(
  db: ReturnType<typeof makeServiceClient>,
  gmailMessageId: string,
) {
  const { data: msg } = await db
    .from('email_messages')
    .select('from_email')
    .eq('gmail_message_id', gmailMessageId)
    .maybeSingle()
  if (!msg || !msg.from_email) return
  const email = msg.from_email.toLowerCase()

  // Check existing rules to avoid duplicates
  const { data: existing } = await db
    .from('assistant_scope_rules')
    .select('id')
    .eq('rule_type', 'deny')
    .eq('match_type', 'email')
    .eq('pattern', email)
    .maybeSingle()
  if (existing) return

  await db.from('assistant_scope_rules').insert({
    rule_type: 'deny',
    match_type: 'email',
    pattern: email,
    source: 'auto_learned',
    notes: 'learned from dismissal',
  })
}
