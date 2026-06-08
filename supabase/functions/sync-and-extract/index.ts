// Donna's 5-min cron heartbeat.
//
// Each run:
//   1. Pull new messages from Gmail via history.list since last_history_id
//   2. Persist them in email_messages (raw inbox state)
//   3. Apply scope rules + LLM classifier to new in-scope candidates
//   4. Run fact extractor on in-scope messages
//   5. Reconcile action items for affected threads
//
// Idempotent: rerunning with the same historyId is a no-op.
import { makeServiceClient } from '../_shared/supabase.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  loadCreds,
  getAccessToken,
  getProfile,
  listHistory,
  getMessage,
  parseEmailAddress,
  parseEmailList,
  GmailAuthError,
  type GmailCredsRow,
  type FullMessage,
} from '../_shared/gmail.ts'
import { callClaude, parseJson, HAIKU } from '../_shared/anthropic.ts'
import { loadScopeRules, loadKnownContactEmails, evaluateScope } from './scope.ts'
import {
  classifierSystemPrompt,
  classifierUserPrompt,
  extractorSystemPrompt,
  extractorUserPrompt,
  type Category,
} from './prompts.ts'
import { reconcileForThreads } from './reconcile.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const MAX_MESSAGES_PER_RUN = 80 // safety cap; if a backlog hits, we'll catch up on the next run

interface ClassifierResult {
  in_scope: boolean
  category: 'networking' | 'recruiting' | 'other' | null
  confidence: number
  reasoning: string
}

interface ExtractorResult {
  summary: string
  promises: Array<{ text: string; by: string | null }>
  asks: Array<{ text: string; by: string | null }>
  questions: Array<{ text: string }>
  deadlines: Array<{ text: string; when: string | null }>
}

interface SyncStats {
  new_messages: number
  classified: number
  in_scope: number
  extracted: number
  threads_reconciled: number
  action_items_created: number
  action_items_resolved: number
  mode: 'incremental' | 'bootstrap' | 'skipped'
  error?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const db = makeServiceClient()
  let stats: SyncStats = {
    new_messages: 0, classified: 0, in_scope: 0, extracted: 0,
    threads_reconciled: 0, action_items_created: 0, action_items_resolved: 0,
    mode: 'skipped',
  }

  try {
    const creds = await loadCreds(db)
    if (!creds) {
      stats.mode = 'skipped'
      stats.error = 'gmail not connected'
      return json({ ok: false, stats })
    }

    let token: string
    try {
      token = await getAccessToken(creds, db)
    } catch (err) {
      await recordError(db, (err as Error).message)
      stats.error = (err as Error).message
      return json({ ok: false, stats })
    }

    // Bootstrap if we don't have a history cursor yet
    if (!creds.last_history_id) {
      const profile = await getProfile(token)
      await db.from('gmail_credentials').update({
        last_history_id: profile.historyId,
        assistant_start_history_id: creds.assistant_start_history_id ?? profile.historyId,
        assistant_started_at: creds.assistant_start_history_id ? undefined : new Date().toISOString(),
        last_sync_at: new Date().toISOString(),
      }).eq('id', 1)
      stats.mode = 'bootstrap'
      return json({ ok: true, stats })
    }

    // Pull changes
    const history = await listHistory(token, creds.last_history_id)
    let messageIds = history.messageIds
    let newHistoryId = history.newHistoryId

    if (history.needsFullSync) {
      // Cursor was too old. Just reset to current and skip — we don't backfill.
      const profile = await getProfile(token)
      await db.from('gmail_credentials').update({
        last_history_id: profile.historyId,
        last_sync_at: new Date().toISOString(),
      }).eq('id', 1)
      stats.mode = 'bootstrap'
      stats.error = 'history cursor expired, reset without backfill'
      return json({ ok: true, stats })
    }

    stats.mode = 'incremental'

    if (messageIds.length === 0) {
      await db.from('gmail_credentials').update({
        last_history_id: newHistoryId,
        last_sync_at: new Date().toISOString(),
      }).eq('id', 1)
      return json({ ok: true, stats })
    }

    if (messageIds.length > MAX_MESSAGES_PER_RUN) {
      messageIds = messageIds.slice(0, MAX_MESSAGES_PER_RUN)
      stats.error = `capped at ${MAX_MESSAGES_PER_RUN} messages, will catch up next run`
    }

    // Filter out messages we already have
    const { data: existingRows } = await db
      .from('email_messages')
      .select('gmail_message_id')
      .in('gmail_message_id', messageIds)
    const existingSet = new Set((existingRows as Array<{ gmail_message_id: string }> | null ?? []).map((r) => r.gmail_message_id))
    const toFetch = messageIds.filter((id) => !existingSet.has(id))

    const ownEmail = (creds.email ?? '').toLowerCase()
    const newMessages: FullMessage[] = []
    for (const id of toFetch) {
      try {
        const m = await getMessage(token, id)
        if (m) newMessages.push(m)
      } catch (err) {
        console.warn('getMessage failed for', id, err)
      }
    }

    // Insert messages
    if (newMessages.length > 0) {
      const rows = newMessages.map((m) => {
        const from = parseEmailAddress(m.from)
        const direction: 'in' | 'out' = m.labelIds.includes('SENT') || (ownEmail && from.email === ownEmail) ? 'out' : 'in'
        return {
          gmail_message_id: m.id,
          gmail_thread_id: m.threadId,
          direction,
          from_email: from.email,
          from_name: from.name,
          to_emails: parseEmailList(m.to),
          cc_emails: parseEmailList(m.cc),
          subject: m.subject,
          snippet: m.snippet,
          body_text: m.bodyText,
          received_at: new Date(Number(m.internalDate)).toISOString(),
        }
      })
      const { error: insErr } = await db.from('email_messages').upsert(rows, { onConflict: 'gmail_message_id' })
      if (insErr) console.warn('insert email_messages:', insErr.message)
      stats.new_messages = rows.length
    }

    // Classify (in-scope decision) for each new message
    const categories = await loadCategories(db)
    const scopeRules = await loadScopeRules(db)
    const knownContactEmails = await loadKnownContactEmails(db)
    const sysPrompt = classifierSystemPrompt(categories)

    const inScopeMessages: FullMessage[] = []
    const inScopeDirections = new Map<string, 'in' | 'out'>()

    for (const m of newMessages) {
      const from = parseEmailAddress(m.from)
      const direction: 'in' | 'out' = m.labelIds.includes('SENT') || (ownEmail && from.email === ownEmail) ? 'out' : 'in'
      inScopeDirections.set(m.id, direction)

      // Outbound messages are always "in scope" for extraction (we want to capture promises Shane made),
      // but they don't generate action items by themselves — reconcile handles that.
      if (direction === 'out') {
        await db.from('email_message_classifications').upsert({
          gmail_message_id: m.id,
          in_scope: true,
          category: null,
          confidence: 1,
          reasoning: 'outbound from Shane',
          source: 'self_sent',
          model: null,
        }, { onConflict: 'gmail_message_id' })
        stats.classified++
        stats.in_scope++
        inScopeMessages.push(m)
        continue
      }

      // Hard rules first
      const decision = evaluateScope({ from: m.from, subject: m.subject }, scopeRules, knownContactEmails)
      if (decision.decided) {
        await db.from('email_message_classifications').upsert({
          gmail_message_id: m.id,
          in_scope: decision.in_scope!,
          category: decision.in_scope ? 'networking' : null,
          confidence: 1,
          reasoning: `${decision.source}: ${decision.matched_pattern}`,
          source: decision.source,
          model: null,
        }, { onConflict: 'gmail_message_id' })
        stats.classified++
        if (decision.in_scope) {
          stats.in_scope++
          inScopeMessages.push(m)
        }
        continue
      }

      // LLM classifier
      try {
        const { text } = await callClaude(db, {
          model: HAIKU,
          system: sysPrompt,
          user: classifierUserPrompt({ from: m.from, to: m.to, subject: m.subject, snippet: m.snippet }),
          maxTokens: 200,
          temperature: 0,
          jsonMode: true,
          runType: 'classify',
          metadata: { gmail_message_id: m.id },
        })
        const result = parseJson<ClassifierResult>(text)
        await db.from('email_message_classifications').upsert({
          gmail_message_id: m.id,
          in_scope: result.in_scope,
          category: result.category,
          confidence: clamp(result.confidence, 0, 1),
          reasoning: result.reasoning?.slice(0, 500) ?? null,
          source: 'llm',
          model: HAIKU,
        }, { onConflict: 'gmail_message_id' })
        stats.classified++
        if (result.in_scope) {
          stats.in_scope++
          inScopeMessages.push(m)
        }
      } catch (err) {
        console.warn('classifier failed for', m.id, err)
      }
    }

    // Extract facts for in-scope messages
    for (const m of inScopeMessages) {
      const direction = inScopeDirections.get(m.id) ?? 'in'
      try {
        const receivedAt = new Date(Number(m.internalDate)).toISOString()
        const { text } = await callClaude(db, {
          model: HAIKU,
          system: extractorSystemPrompt,
          user: extractorUserPrompt({
            direction,
            from: m.from,
            to: m.to,
            subject: m.subject,
            bodyText: m.bodyText,
            receivedAt,
          }),
          maxTokens: 800,
          temperature: 0,
          jsonMode: true,
          runType: 'extract',
          metadata: { gmail_message_id: m.id, direction },
        })
        const result = parseJson<ExtractorResult>(text)
        await db.from('email_message_extractions').upsert({
          gmail_message_id: m.id,
          summary: result.summary?.slice(0, 500) ?? null,
          promises: result.promises ?? [],
          asks: result.asks ?? [],
          questions: result.questions ?? [],
          deadlines: result.deadlines ?? [],
          model: HAIKU,
        }, { onConflict: 'gmail_message_id' })
        stats.extracted++
      } catch (err) {
        console.warn('extractor failed for', m.id, err)
      }
    }

    // Reconcile action items on all touched threads
    const threadIds = Array.from(new Set(newMessages.map((m) => m.threadId)))
    if (threadIds.length > 0) {
      const r = await reconcileForThreads(db, threadIds)
      stats.threads_reconciled = r.threads_seen
      stats.action_items_created = r.created
      stats.action_items_resolved = r.resolved
    }

    // Persist new cursor
    await db.from('gmail_credentials').update({
      last_history_id: newHistoryId,
      last_sync_at: new Date().toISOString(),
      last_error: null,
      last_error_at: null,
    }).eq('id', 1)

    return json({ ok: true, stats })
  } catch (err) {
    const msg = (err as Error).message
    console.error('sync-and-extract fatal:', err)
    if (err instanceof GmailAuthError) {
      await recordError(db, msg)
    } else {
      await recordError(db, msg)
    }
    stats.error = msg
    return json({ ok: false, stats }, { status: 500 })
  }
})

async function loadCategories(db: SupabaseClient): Promise<Category[]> {
  const { data } = await db.from('assistant_categories').select('name, description').eq('enabled', true)
  return ((data as Category[] | null) ?? []).map((c) => ({ name: c.name, description: c.description }))
}

async function recordError(db: SupabaseClient, message: string) {
  await db.from('gmail_credentials').update({
    last_error: message.slice(0, 1000),
    last_error_at: new Date().toISOString(),
  }).eq('id', 1)
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  return Math.max(min, Math.min(max, n))
}

// Suppress unused warnings for types used only by callers
export type { GmailCredsRow }
