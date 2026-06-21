import { supabase } from '../supabase'
import type { Contact, EmailThread, EmailEvent, Company } from '../../types/database'
import { deriveAction, type ActionKind } from '../status/engine'
import type { ThreadRules } from '../settings/rules'

export type BoardColumnKey = 'draft' | 'sent' | 'follow_up' | 'reply' | 'reengage'

export interface BoardCard {
  thread: EmailThread
  contact: Contact
  company: Pick<Company, 'name'> | null
  // Number of consecutive outgoing messages with no inbound reply between
  // them, for threads that have never received a reply. Used to render
  // "1st outreach", "2nd outreach", etc. Null when the thread has at least
  // one reply received (i.e. it's a normal back-and-forth conversation).
  outreachAttempt: number | null
  // The bucket this card belongs to.
  column: BoardColumnKey
  // True when the thread is past the re-engage threshold (sat in Follow-up
  // for ≥reengageAfterDays). Drives a small "Re-engage" tag on the card.
  isReengage: boolean
  // Most recent relevant timestamp for sorting within a column.
  sortAt: string | null
}

export interface BoardData {
  draft: BoardCard[]
  sent: BoardCard[]
  follow_up: BoardCard[]
  reply: BoardCard[]
  reengage: BoardCard[]
}

function bucketForAction(kind: ActionKind): BoardColumnKey | null {
  switch (kind) {
    case 'finish_draft': return 'draft'
    case 'reply': return 'reply'
    case 'send_follow_up': return 'follow_up'
    case 'reengage': return 'reengage'
    case 'wait': return 'sent'
    case 'send_first':
    case 'none':
      return null
  }
}

/**
 * For threads that have never received a reply, count consecutive outgoing
 * messages by walking email_events in chronological order. Returns a map
 * from thread_id (uuid) → attempt count. Threads that have any inbound
 * `received` event are omitted (no label needed).
 */
function computeOutreachAttempts(events: EmailEvent[]): Map<string, number> {
  // Group events per thread, sorted by occurred_at ascending.
  const byThread = new Map<string, EmailEvent[]>()
  for (const e of events) {
    if (!e.thread_id) continue
    if (!byThread.has(e.thread_id)) byThread.set(e.thread_id, [])
    byThread.get(e.thread_id)!.push(e)
  }

  const out = new Map<string, number>()
  for (const [threadId, list] of byThread) {
    list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    let attempts = 0
    let everReceived = false
    for (const ev of list) {
      if (ev.event_type === 'received') {
        everReceived = true
        break
      }
      if (ev.event_type === 'sent' || ev.event_type === 'follow_up_sent') {
        attempts++
      }
    }
    if (!everReceived && attempts > 0) out.set(threadId, attempts)
  }
  return out
}

export async function loadBoardData(rules: ThreadRules, now: number = Date.now()): Promise<BoardData> {
  const [{ data: threads }, { data: contactsData }, { data: companiesData }, { data: eventsData }] = await Promise.all([
    supabase.from('email_threads').select('*'),
    supabase.from('contacts').select('*'),
    supabase.from('companies').select('id, name'),
    supabase.from('email_events').select('id, contact_id, thread_id, gmail_message_id, event_type, template_id, subject, occurred_at'),
  ])

  const threadList = (threads as EmailThread[]) ?? []
  const contacts = (contactsData as Contact[]) ?? []
  const companies = (companiesData as Pick<Company, 'id' | 'name'>[]) ?? []
  const events = (eventsData as EmailEvent[]) ?? []

  const contactsById = new Map(contacts.map(c => [c.id, c]))
  const companiesById = new Map(companies.map(c => [c.id, c]))
  const outreachByThread = computeOutreachAttempts(events)

  const board: BoardData = { draft: [], sent: [], follow_up: [], reply: [], reengage: [] }

  for (const thread of threadList) {
    if (thread.closed_at) continue
    const action = deriveAction(thread, rules, now)
    const column = bucketForAction(action.kind)
    if (!column) continue

    const contact = contactsById.get(thread.contact_id) ?? null
    if (!contact) continue
    const company = contact.company_id ? companiesById.get(contact.company_id) ?? null : null
    const attempts = outreachByThread.get(thread.id) ?? null

    const sortAt = column === 'reply'
      ? thread.last_received_at
      : column === 'draft'
        ? thread.last_draft_at
        : thread.last_sent_at

    board[column].push({
      thread,
      contact,
      company,
      outreachAttempt: attempts,
      column,
      isReengage: action.kind === 'reengage',
      sortAt,
    })
  }

  // Sort: Reply + Follow-up + Re-engage = oldest first (most overdue at top).
  // Sent + Draft = newest first (fresh activity at top).
  board.reply.sort((a, b) => (a.sortAt ?? '').localeCompare(b.sortAt ?? ''))
  board.follow_up.sort((a, b) => (a.sortAt ?? '').localeCompare(b.sortAt ?? ''))
  board.reengage.sort((a, b) => (a.sortAt ?? '').localeCompare(b.sortAt ?? ''))
  board.sent.sort((a, b) => (b.sortAt ?? '').localeCompare(a.sortAt ?? ''))
  board.draft.sort((a, b) => (b.sortAt ?? '').localeCompare(a.sortAt ?? ''))

  return board
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfWeek(ms: number): number {
  const dayStart = startOfDay(ms)
  return dayStart - new Date(dayStart).getDay() * DAY_MS
}

export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const seconds = Math.floor((now - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 14) {
    const thisWeekStart = startOfWeek(now)
    const lastWeekStart = thisWeekStart - 7 * DAY_MS
    const thenDayStart = startOfDay(then)
    const weekday = WEEKDAY_NAMES[new Date(thenDayStart).getDay()]
    if (thenDayStart >= thisWeekStart) return weekday
    if (thenDayStart >= lastWeekStart) return `last ${weekday}`
  }
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  }
  const months = Math.floor(days / 30)
  return months === 1 ? '1 month ago' : `${months} months ago`
}

const ORDINAL_SUFFIX: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' }

export function outreachLabel(attempt: number): string {
  if (attempt >= 5) return '5+ outreach'
  const n = attempt % 100
  const suffix = (n >= 11 && n <= 13) ? 'th' : ORDINAL_SUFFIX[attempt % 10] ?? 'th'
  return `${attempt}${suffix} outreach`
}
