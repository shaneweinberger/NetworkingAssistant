import { supabase } from '../supabase'
import type { Contact, EmailThread, GmailCredentials } from '../../types/database'
import { getThread, listHistory, getProfile, listSentThreadsTo, GmailAuthError } from './api'
import { loadCredentials } from './oauth'

interface ThreadDerivedTimes {
  message_count: number
  last_message_at: string | null
  last_sent_at: string | null
  last_received_at: string | null
  subject: string | null
  toAddresses: string[]
}

const EMAIL_ADDR_RE = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g

function extractEmails(value: string | null): string[] {
  if (!value) return []
  const m = value.match(EMAIL_ADDR_RE)
  return m ? m.map(s => s.toLowerCase()) : []
}

/**
 * Pulls thread metadata from Gmail and computes the timestamps we cache.
 * Returns null if the thread no longer exists (deleted by the user).
 */
async function deriveThreadTimes(gmailThreadId: string, ownEmail: string | null): Promise<ThreadDerivedTimes | null> {
  const t = await getThread(gmailThreadId)
  if (!t) return null

  let lastSent: number | null = null
  let lastReceived: number | null = null
  let lastMessage: number | null = null
  let subject: string | null = null
  const toAddresses = new Set<string>()

  for (const m of t.messages) {
    const ts = Number(m.internalDate)
    if (Number.isNaN(ts)) continue
    if (subject == null && m.subject) subject = m.subject
    lastMessage = lastMessage == null ? ts : Math.max(lastMessage, ts)

    const isSent = m.labelIds.includes('SENT') || (ownEmail != null && m.from?.toLowerCase().includes(ownEmail.toLowerCase()) === true)
    if (isSent) {
      lastSent = lastSent == null ? ts : Math.max(lastSent, ts)
      // Outgoing message — capture every To: address so we can match contacts.
      for (const addr of extractEmails(m.to)) toAddresses.add(addr)
    } else {
      lastReceived = lastReceived == null ? ts : Math.max(lastReceived, ts)
    }
  }

  return {
    message_count: t.messages.length,
    last_message_at: lastMessage != null ? new Date(lastMessage).toISOString() : null,
    last_sent_at: lastSent != null ? new Date(lastSent).toISOString() : null,
    last_received_at: lastReceived != null ? new Date(lastReceived).toISOString() : null,
    subject,
    toAddresses: Array.from(toAddresses),
  }
}

export async function upsertThreadForContact(args: {
  contactId: string
  gmailThreadId: string
  ownEmail: string | null
}): Promise<EmailThread | null> {
  const times = await deriveThreadTimes(args.gmailThreadId, args.ownEmail)
  if (!times) return null

  const row = {
    contact_id: args.contactId,
    gmail_thread_id: args.gmailThreadId,
    subject: times.subject,
    message_count: times.message_count,
    last_message_at: times.last_message_at,
    last_sent_at: times.last_sent_at,
    last_received_at: times.last_received_at,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('email_threads')
    .upsert(row, { onConflict: 'gmail_thread_id' })
    .select()
    .single()

  if (error) {
    console.warn('Failed to upsert email_thread:', error.message)
    return null
  }
  return data as EmailThread
}

async function saveHistoryCursor(historyId: string): Promise<void> {
  const { error } = await supabase
    .from('gmail_credentials')
    .update({ last_history_id: historyId, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) console.warn('Failed to save history cursor:', error.message)
}

async function loadAllTrackedThreads(): Promise<EmailThread[]> {
  const { data, error } = await supabase
    .from('email_threads')
    .select('*')
  if (error) {
    console.warn('Failed to load tracked threads:', error.message)
    return []
  }
  return (data as EmailThread[]) ?? []
}

async function loadContactsByEmail(): Promise<Map<string, Contact>> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .not('email', 'is', null)
  if (error) {
    console.warn('Failed to load contacts for thread matching:', error.message)
    return new Map()
  }
  const map = new Map<string, Contact>()
  for (const c of (data as Contact[]) ?? []) {
    if (c.email) map.set(c.email.toLowerCase(), c)
  }
  return map
}

async function loadIgnoredThreadIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('gmail_ignored_threads')
    .select('gmail_thread_id')
  if (error) {
    console.warn('Failed to load ignored thread cache:', error.message)
    return new Set()
  }
  return new Set((data as { gmail_thread_id: string }[]).map(r => r.gmail_thread_id))
}

async function markThreadIgnored(threadId: string): Promise<void> {
  const { error } = await supabase
    .from('gmail_ignored_threads')
    .upsert(
      { gmail_thread_id: threadId, seen_at: new Date().toISOString() },
      { onConflict: 'gmail_thread_id' },
    )
  if (error) console.warn('Failed to mark thread ignored:', error.message)
}

async function unmarkThreadIgnored(threadId: string): Promise<void> {
  const { error } = await supabase
    .from('gmail_ignored_threads')
    .delete()
    .eq('gmail_thread_id', threadId)
  if (error) console.warn('Failed to clear ignored thread:', error.message)
}

/**
 * Inspect a Gmail thread we haven't seen before. If any outgoing message in
 * it was addressed to a known contact, create an email_threads row for that
 * contact. Otherwise add the thread to the ignored cache so we don't re-scan
 * it next poll.
 */
async function discoverThread(
  threadId: string,
  ownEmail: string | null,
  contactsByEmail: Map<string, Contact>,
): Promise<EmailThread | null> {
  const times = await deriveThreadTimes(threadId, ownEmail)
  if (!times) return null

  let matched: Contact | null = null
  for (const addr of times.toAddresses) {
    const hit = contactsByEmail.get(addr)
    if (hit) { matched = hit; break }
  }

  if (!matched) {
    await markThreadIgnored(threadId)
    return null
  }

  const row = {
    contact_id: matched.id,
    gmail_thread_id: threadId,
    subject: times.subject,
    message_count: times.message_count,
    last_message_at: times.last_message_at,
    last_sent_at: times.last_sent_at,
    last_received_at: times.last_received_at,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('email_threads')
    .upsert(row, { onConflict: 'gmail_thread_id' })
    .select()
    .single()
  if (error) {
    console.warn('Failed to upsert discovered thread:', error.message)
    return null
  }
  return data as EmailThread
}

export interface SyncResult {
  updatedThreads: number
  scanned: number
  mode: 'incremental' | 'full' | 'bootstrap' | 'skipped'
  reconnectRequired?: boolean
  error?: string
}

export async function syncGmail(): Promise<SyncResult> {
  let creds: GmailCredentials | null
  try {
    creds = await loadCredentials()
  } catch {
    return { updatedThreads: 0, scanned: 0, mode: 'skipped', error: 'load credentials failed' }
  }
  if (!creds || !creds.access_token) {
    return { updatedThreads: 0, scanned: 0, mode: 'skipped' }
  }

  const [trackedThreads, contactsByEmail, ignoredIds] = await Promise.all([
    loadAllTrackedThreads(),
    loadContactsByEmail(),
    loadIgnoredThreadIds(),
  ])
  const trackedById = new Map(trackedThreads.map(t => [t.gmail_thread_id, t]))
  const ownEmail = creds.email

  try {
    if (!creds.last_history_id) {
      const profile = await getProfile()
      await fullScan(trackedThreads, ownEmail)
      await saveHistoryCursor(profile.historyId)
      return { updatedThreads: trackedThreads.length, scanned: trackedThreads.length, mode: 'bootstrap' }
    }

    const history = await listHistory(creds.last_history_id)
    if (history.needsFullSync) {
      await fullScan(trackedThreads, ownEmail)
      const profile = await getProfile()
      await saveHistoryCursor(profile.historyId)
      return { updatedThreads: trackedThreads.length, scanned: trackedThreads.length, mode: 'full' }
    }

    let updated = 0
    for (const threadId of history.threadIds) {
      const tracked = trackedById.get(threadId)
      if (tracked) {
        const result = await upsertThreadForContact({
          contactId: tracked.contact_id,
          gmailThreadId: threadId,
          ownEmail,
        })
        if (result) {
          const prev = tracked.last_received_at ? new Date(tracked.last_received_at).getTime() : 0
          const next = result.last_received_at ? new Date(result.last_received_at).getTime() : 0
          if (next > prev) {
            await supabase.from('email_events').insert({
              contact_id: tracked.contact_id,
              thread_id: result.id,
              event_type: 'received',
              occurred_at: result.last_received_at,
            })
          }
          updated++
        }
        continue
      }

      // Unknown thread — but skip if we already concluded it isn't relevant.
      if (ignoredIds.has(threadId)) continue

      const discovered = await discoverThread(threadId, ownEmail, contactsByEmail)
      if (discovered) updated++
    }
    await saveHistoryCursor(history.newHistoryId)
    return { updatedThreads: updated, scanned: history.threadIds.length, mode: 'incremental' }
  } catch (err) {
    if (err instanceof GmailAuthError) {
      return { updatedThreads: 0, scanned: 0, mode: 'skipped', reconnectRequired: true, error: err.message }
    }
    return { updatedThreads: 0, scanned: 0, mode: 'skipped', error: (err as Error).message }
  }
}

async function fullScan(threads: EmailThread[], ownEmail: string | null) {
  for (const t of threads) {
    await upsertThreadForContact({
      contactId: t.contact_id,
      gmailThreadId: t.gmail_thread_id,
      ownEmail,
    })
  }
}

/**
 * One-shot rescan for a single contact's email address. Used when a contact
 * is created/updated so any pre-existing outbound conversations with them
 * (sent directly from Gmail, before the contact existed in our DB) get
 * surfaced on the Threads Board.
 *
 * Best-effort: silently no-ops if Gmail isn't connected. Returns the number
 * of new threads pulled in.
 */
export async function rescanContact(contact: Contact, withinDays = 90): Promise<number> {
  if (!contact.email) return 0
  let creds: GmailCredentials | null
  try {
    creds = await loadCredentials()
  } catch {
    return 0
  }
  if (!creds?.access_token) return 0
  const ownEmail = creds.email

  try {
    const threadIds = await listSentThreadsTo(contact.email, withinDays)
    if (threadIds.length === 0) return 0

    let added = 0
    for (const threadId of threadIds) {
      const upserted = await upsertThreadForContact({
        contactId: contact.id,
        gmailThreadId: threadId,
        ownEmail,
      })
      if (upserted) {
        added++
        // If we previously ignored this thread (e.g. it wasn't to any contact
        // yet), clear the ignore cache so future polls keep tracking it.
        await unmarkThreadIgnored(threadId)
      }
    }
    return added
  } catch (err) {
    if (err instanceof GmailAuthError) return 0
    console.warn('rescanContact failed:', (err as Error).message)
    return 0
  }
}
