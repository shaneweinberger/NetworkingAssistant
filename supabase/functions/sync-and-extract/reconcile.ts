// Action item reconciliation.
// Takes the current state of email_messages + extractions and decides which
// action_items should exist. Auto-resolves any items that have been overtaken
// by new activity.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const REPLY_NEEDED_AFTER_HOURS = 4 // they sent last → reply_needed after this much "soak time"
const FOLLOW_UP_AFTER_DAYS = 5     // you sent last with no reply → follow_up due
const CHASE_AFTER_DAYS = 14        // really old, suggest re-engagement

interface MessageRow {
  gmail_message_id: string
  gmail_thread_id: string
  direction: 'in' | 'out'
  from_email: string | null
  subject: string | null
  received_at: string
}

interface ExtractionRow {
  gmail_message_id: string
  summary: string | null
  asks: Array<{ text: string; by: string | null }>
  questions: Array<{ text: string }>
  deadlines: Array<{ text: string; when: string | null }>
}

interface ClassRow {
  gmail_message_id: string
  in_scope: boolean
  category: string | null
}

interface ActionItem {
  id: string
  kind: string
  status: string
  gmail_thread_id: string | null
  gmail_message_id: string | null
  due_at: string | null
}

export interface ReconcileResult {
  created: number
  resolved: number
  threads_seen: number
}

export async function reconcileForThreads(
  db: SupabaseClient,
  threadIds: string[],
): Promise<ReconcileResult> {
  if (threadIds.length === 0) return { created: 0, resolved: 0, threads_seen: 0 }

  // Load all messages for these threads
  const { data: msgs, error: mErr } = await db
    .from('email_messages')
    .select('gmail_message_id, gmail_thread_id, direction, from_email, subject, received_at')
    .in('gmail_thread_id', threadIds)
    .order('received_at', { ascending: true })
  if (mErr) throw new Error('load messages: ' + mErr.message)

  const messages = (msgs as MessageRow[]) ?? []
  const byThread = new Map<string, MessageRow[]>()
  for (const m of messages) {
    if (!byThread.has(m.gmail_thread_id)) byThread.set(m.gmail_thread_id, [])
    byThread.get(m.gmail_thread_id)!.push(m)
  }

  // Load in-scope classifications + extractions in one shot
  const messageIds = messages.map((m) => m.gmail_message_id)
  const { data: classData } = await db
    .from('email_message_classifications')
    .select('gmail_message_id, in_scope, category')
    .in('gmail_message_id', messageIds.length > 0 ? messageIds : ['__none__'])
  const classByMsg = new Map<string, ClassRow>()
  for (const c of (classData as ClassRow[] | null) ?? []) classByMsg.set(c.gmail_message_id, c)

  const { data: extData } = await db
    .from('email_message_extractions')
    .select('gmail_message_id, summary, asks, questions, deadlines')
    .in('gmail_message_id', messageIds.length > 0 ? messageIds : ['__none__'])
  const extByMsg = new Map<string, ExtractionRow>()
  for (const e of (extData as ExtractionRow[] | null) ?? []) extByMsg.set(e.gmail_message_id, e)

  // Load existing open action items for these threads
  const { data: existing } = await db
    .from('assistant_action_items')
    .select('id, kind, status, gmail_thread_id, gmail_message_id, due_at')
    .in('gmail_thread_id', threadIds)
    .eq('status', 'open')
  const existingByKey = new Map<string, ActionItem>()
  for (const a of (existing as ActionItem[] | null) ?? []) {
    existingByKey.set(`${a.kind}::${a.gmail_thread_id ?? ''}`, a)
  }

  // Load contact map (email -> contact id)
  const { data: contactRows } = await db.from('contacts').select('id, email').not('email', 'is', null)
  const contactByEmail = new Map<string, string>()
  for (const c of (contactRows as Array<{ id: string; email: string }> | null) ?? []) {
    if (c.email) contactByEmail.set(c.email.toLowerCase(), c.id)
  }

  const now = Date.now()
  let created = 0
  let resolved = 0

  for (const [threadId, msgsInThread] of byThread) {
    const lastMsg = msgsInThread[msgsInThread.length - 1]
    if (!lastMsg) continue

    // Is any message in-scope?
    const hasInScope = msgsInThread.some((m) => classByMsg.get(m.gmail_message_id)?.in_scope === true)
    if (!hasInScope) {
      // Auto-resolve any leftover items on a thread we now consider out of scope
      const r = await resolveOpenItemsForThread(db, threadId, 'out_of_scope', existingByKey)
      resolved += r
      continue
    }

    const category =
      msgsInThread
        .map((m) => classByMsg.get(m.gmail_message_id)?.category)
        .find((c) => c && c !== 'other') ?? null

    const otherParty = pickOtherParty(msgsInThread)
    const contactId = otherParty ? contactByEmail.get(otherParty) ?? null : null

    // ----- Rule: reply_needed -----
    // They sent last, you haven't responded, and enough time has passed.
    const lastReceivedMsg = lastInbound(msgsInThread)
    const lastSentMsg = lastOutbound(msgsInThread)
    const lastReceivedTs = lastReceivedMsg ? new Date(lastReceivedMsg.received_at).getTime() : 0
    const lastSentTs = lastSentMsg ? new Date(lastSentMsg.received_at).getTime() : 0

    if (lastReceivedTs > lastSentTs && (now - lastReceivedTs) >= REPLY_NEEDED_AFTER_HOURS * 3600 * 1000) {
      const ext = lastReceivedMsg ? extByMsg.get(lastReceivedMsg.gmail_message_id) : null
      const summary = composeReplySummary(otherParty, lastReceivedMsg, ext)
      const detail = composeReplyDetail(ext)
      created += await ensureItem(db, existingByKey, {
        kind: 'reply_needed',
        gmail_thread_id: threadId,
        gmail_message_id: lastReceivedMsg?.gmail_message_id ?? null,
        contact_id: contactId,
        category,
        summary,
        detail,
        urgency: urgencyFor(now - lastReceivedTs),
        due_at: new Date(now).toISOString(),
      })
      // Resolve stale follow_up / chase items now that they replied
      resolved += await resolveOpenItemsForThreadByKinds(db, threadId, ['follow_up_due', 'chase_response'], 'they_replied', existingByKey)
    } else {
      // Resolve any reply_needed if you've now sent
      if (lastSentTs > lastReceivedTs) {
        resolved += await resolveOpenItemsForThreadByKinds(db, threadId, ['reply_needed'], 'you_replied', existingByKey)
      }
    }

    // ----- Rule: follow_up_due -----
    // You sent last, no reply, FOLLOW_UP_AFTER_DAYS+ elapsed.
    if (lastSentTs > lastReceivedTs) {
      const elapsed = now - lastSentTs
      if (elapsed >= FOLLOW_UP_AFTER_DAYS * 86400 * 1000 && elapsed < CHASE_AFTER_DAYS * 86400 * 1000) {
        created += await ensureItem(db, existingByKey, {
          kind: 'follow_up_due',
          gmail_thread_id: threadId,
          gmail_message_id: lastSentMsg?.gmail_message_id ?? null,
          contact_id: contactId,
          category,
          summary: `Follow up with ${displayName(otherParty)} — ${daysBetween(lastSentTs, now)} days since you wrote.`,
          detail: lastSentMsg?.subject ?? null,
          urgency: 'med',
          due_at: new Date(now).toISOString(),
        })
      } else if (elapsed >= CHASE_AFTER_DAYS * 86400 * 1000) {
        // Switch to chase_response, resolve follow_up_due
        resolved += await resolveOpenItemsForThreadByKinds(db, threadId, ['follow_up_due'], 'aged_to_chase', existingByKey)
        created += await ensureItem(db, existingByKey, {
          kind: 'chase_response',
          gmail_thread_id: threadId,
          gmail_message_id: lastSentMsg?.gmail_message_id ?? null,
          contact_id: contactId,
          category,
          summary: `Re-engage ${displayName(otherParty)} — ${daysBetween(lastSentTs, now)} days of silence.`,
          detail: lastSentMsg?.subject ?? null,
          urgency: 'low',
          due_at: new Date(now).toISOString(),
        })
      }
    }
  }

  return { created, resolved, threads_seen: byThread.size }
}

function lastInbound(msgs: MessageRow[]): MessageRow | null {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].direction === 'in') return msgs[i]
  return null
}

function lastOutbound(msgs: MessageRow[]): MessageRow | null {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].direction === 'out') return msgs[i]
  return null
}

function pickOtherParty(msgs: MessageRow[]): string | null {
  // The "other party" is the from_email of the most recent inbound message,
  // or if none, the first one we have.
  const lastIn = lastInbound(msgs)
  if (lastIn?.from_email) return lastIn.from_email.toLowerCase()
  for (const m of msgs) {
    if (m.from_email) return m.from_email.toLowerCase()
  }
  return null
}

function displayName(email: string | null): string {
  if (!email) return 'them'
  const local = email.split('@')[0]
  return local.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function urgencyFor(ageMs: number): 'low' | 'med' | 'high' {
  const hours = ageMs / 3600000
  if (hours >= 48) return 'high'
  if (hours >= 12) return 'med'
  return 'low'
}

function daysBetween(a: number, b: number): number {
  return Math.floor((b - a) / 86400000)
}

function composeReplySummary(
  otherParty: string | null,
  lastReceivedMsg: MessageRow | null,
  ext: ExtractionRow | null | undefined,
): string {
  const name = displayName(otherParty)
  if (ext?.summary) return `Reply to ${name}: ${ext.summary}`
  if (lastReceivedMsg?.subject) return `Reply to ${name} re: ${lastReceivedMsg.subject}`
  return `Reply to ${name}`
}

function composeReplyDetail(ext: ExtractionRow | null | undefined): string | null {
  if (!ext) return null
  const parts: string[] = []
  if (ext.questions?.length) {
    parts.push('Q: ' + ext.questions.slice(0, 2).map((q) => q.text).join(' / '))
  }
  if (ext.asks?.length) {
    parts.push('Ask: ' + ext.asks.slice(0, 2).map((a) => a.text).join(' / '))
  }
  if (ext.deadlines?.length) {
    parts.push('Deadline: ' + ext.deadlines.slice(0, 1).map((d) => d.text).join(' / '))
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

interface EnsureItemArgs {
  kind: string
  gmail_thread_id: string
  gmail_message_id: string | null
  contact_id: string | null
  category: string | null
  summary: string
  detail: string | null
  urgency: 'low' | 'med' | 'high'
  due_at: string | null
}

async function ensureItem(
  db: SupabaseClient,
  existingByKey: Map<string, ActionItem>,
  args: EnsureItemArgs,
): Promise<number> {
  const key = `${args.kind}::${args.gmail_thread_id}`
  if (existingByKey.has(key)) {
    // Update the summary in case extraction improved
    await db.from('assistant_action_items')
      .update({
        summary: args.summary,
        detail: args.detail,
        urgency: args.urgency,
        category: args.category,
        contact_id: args.contact_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingByKey.get(key)!.id)
    return 0
  }
  const { error } = await db.from('assistant_action_items').insert({
    kind: args.kind,
    status: 'open',
    urgency: args.urgency,
    contact_id: args.contact_id,
    gmail_thread_id: args.gmail_thread_id,
    gmail_message_id: args.gmail_message_id,
    category: args.category,
    summary: args.summary,
    detail: args.detail,
    due_at: args.due_at,
  })
  if (error) {
    // unique conflict means we raced — ignore
    if (!error.message.includes('duplicate')) {
      console.warn('ensureItem failed:', error.message)
    }
    return 0
  }
  return 1
}

async function resolveOpenItemsForThread(
  db: SupabaseClient,
  threadId: string,
  reason: string,
  existingByKey: Map<string, ActionItem>,
): Promise<number> {
  const ids: string[] = []
  for (const [, item] of existingByKey) {
    if (item.gmail_thread_id === threadId && item.status === 'open') ids.push(item.id)
  }
  if (ids.length === 0) return 0
  await db.from('assistant_action_items').update({
    status: 'done',
    auto_resolved: true,
    dismissal_reason: reason,
    resolved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).in('id', ids)
  return ids.length
}

async function resolveOpenItemsForThreadByKinds(
  db: SupabaseClient,
  threadId: string,
  kinds: string[],
  reason: string,
  existingByKey: Map<string, ActionItem>,
): Promise<number> {
  const ids: string[] = []
  for (const [, item] of existingByKey) {
    if (item.gmail_thread_id === threadId && kinds.includes(item.kind)) ids.push(item.id)
  }
  if (ids.length === 0) return 0
  await db.from('assistant_action_items').update({
    status: 'done',
    auto_resolved: true,
    dismissal_reason: reason,
    resolved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).in('id', ids)
  return ids.length
}
