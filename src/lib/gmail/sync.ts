import { supabase } from '../supabase'
import type { EmailThread, GmailCredentials } from '../../types/database'
import { getThread, listHistory, getProfile, GmailAuthError } from './api'
import { loadCredentials } from './oauth'

interface ThreadDerivedTimes {
  message_count: number
  last_message_at: string | null
  last_sent_at: string | null
  last_received_at: string | null
  subject: string | null
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

  for (const m of t.messages) {
    const ts = Number(m.internalDate)
    if (Number.isNaN(ts)) continue
    if (subject == null && m.subject) subject = m.subject
    lastMessage = lastMessage == null ? ts : Math.max(lastMessage, ts)

    // Gmail labels SENT messages with the SENT label. As a fallback we look
    // at the From: header against the connected user's email.
    const isSent = m.labelIds.includes('SENT') || (ownEmail != null && m.from?.toLowerCase().includes(ownEmail.toLowerCase()) === true)
    if (isSent) {
      lastSent = lastSent == null ? ts : Math.max(lastSent, ts)
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
  }
}

/**
 * Inserts or updates an email_threads row to match Gmail's current state.
 * Used both when an outgoing send happens and during incremental sync.
 */
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

export interface SyncResult {
  updatedThreads: number
  scanned: number
  mode: 'incremental' | 'full' | 'bootstrap' | 'skipped'
  reconnectRequired?: boolean
  error?: string
}

/**
 * Top-level sync routine. Strategy:
 *
 * 1. If we have a `last_history_id`, use the History API to find changed
 *    threads incrementally (cheap).
 * 2. If we don't, or if Gmail says our history cursor is too old (404),
 *    fall back to scanning every tracked thread (still bounded by your
 *    own contact list size).
 *
 * Only threads we already track (i.e. ones we sent from a template) are
 * synced — we don't index the whole inbox. This keeps the API surface
 * small and predictable.
 */
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

  const trackedThreads = await loadAllTrackedThreads()
  const trackedById = new Map(trackedThreads.map(t => [t.gmail_thread_id, t]))
  const ownEmail = creds.email

  try {
    if (!creds.last_history_id) {
      // Bootstrap: capture the current historyId and scan all tracked threads
      // once. Subsequent runs will be incremental.
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
      if (!trackedById.has(threadId)) continue
      const t = trackedById.get(threadId)!
      const result = await upsertThreadForContact({
        contactId: t.contact_id,
        gmailThreadId: threadId,
        ownEmail,
      })
      if (result) {
        // Detect a newly-received message and log an email_event so the
        // audit log stays meaningful for response analytics.
        const prev = t.last_received_at ? new Date(t.last_received_at).getTime() : 0
        const next = result.last_received_at ? new Date(result.last_received_at).getTime() : 0
        if (next > prev) {
          await supabase.from('email_events').insert({
            contact_id: t.contact_id,
            thread_id: result.id,
            event_type: 'received',
            occurred_at: result.last_received_at,
          })
        }
        updated++
      }
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
