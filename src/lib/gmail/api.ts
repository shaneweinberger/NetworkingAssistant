import { getAccessToken } from './oauth'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export class GmailAuthError extends Error {
  constructor(message = 'Gmail is not connected') {
    super(message)
    this.name = 'GmailAuthError'
  }
}

export class GmailApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GmailApiError'
    this.status = status
  }
}

async function gmailFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  if (!token) throw new GmailAuthError()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(`${GMAIL_API}${path}`, { ...init, headers })
  if (res.status === 401 || res.status === 403) {
    const body = await res.text()
    throw new GmailAuthError(body || 'Gmail authorization rejected')
  }
  if (!res.ok) {
    const body = await res.text()
    throw new GmailApiError(res.status, `Gmail API ${res.status}: ${body.slice(0, 300)}`)
  }
  return res
}

// RFC 2822 message encoded as base64url (Gmail's required format).
// We keep it pure-text and let Gmail wrap; no MIME multipart needed.
function encodeRfc2822(args: { to: string; subject: string; body: string; fromEmail?: string | null }): string {
  const lines = [
    `To: ${args.to}`,
    args.fromEmail ? `From: ${args.fromEmail}` : null,
    `Subject: ${encodeSubject(args.subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    args.body,
  ].filter(Boolean) as string[]
  const raw = lines.join('\r\n')

  // Browser-safe base64url
  const utf8 = new TextEncoder().encode(raw)
  let binary = ''
  utf8.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Non-ASCII subjects need RFC 2047 encoded-word. Gmail also accepts plain
// UTF-8 if the message uses Content-Type: text/plain charset="UTF-8", but
// some clients render subjects oddly without explicit encoding.
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject
  const b64 = btoa(unescape(encodeURIComponent(subject)))
  return `=?UTF-8?B?${b64}?=`
}

export interface SendArgs {
  to: string
  subject: string
  body: string
  fromEmail?: string | null
}

export interface SentMessage {
  id: string
  threadId: string
}

export async function createDraft(args: SendArgs): Promise<SentMessage> {
  const raw = encodeRfc2822(args)
  const res = await gmailFetch('/drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { raw } }),
  })
  const json = await res.json() as { id: string; message: { id: string; threadId: string } }
  return { id: json.message.id, threadId: json.message.threadId }
}

export async function sendMessage(args: SendArgs): Promise<SentMessage> {
  const raw = encodeRfc2822(args)
  const res = await gmailFetch('/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw }),
  })
  const json = await res.json() as { id: string; threadId: string }
  return { id: json.id, threadId: json.threadId }
}

export interface ThreadMessage {
  id: string
  threadId: string
  internalDate: string // ms since epoch as a string per Gmail
  labelIds: string[]
  from: string | null
  to: string | null
  subject: string | null
}

export interface ThreadSummary {
  id: string
  messages: ThreadMessage[]
}

function header(headers: Array<{ name: string; value: string }> | undefined, name: string): string | null {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? null
}

export async function getThread(threadId: string): Promise<ThreadSummary | null> {
  try {
    const res = await gmailFetch(`/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)
    const json = await res.json() as {
      id: string
      messages: Array<{
        id: string
        threadId: string
        internalDate: string
        labelIds?: string[]
        payload?: { headers?: Array<{ name: string; value: string }> }
      }>
    }
    return {
      id: json.id,
      messages: json.messages.map(m => ({
        id: m.id,
        threadId: m.threadId,
        internalDate: m.internalDate,
        labelIds: m.labelIds ?? [],
        from: header(m.payload?.headers, 'From'),
        to: header(m.payload?.headers, 'To'),
        subject: header(m.payload?.headers, 'Subject'),
      })),
    }
  } catch (err) {
    if (err instanceof GmailApiError && err.status === 404) return null
    throw err
  }
}

/**
 * Returns the user's current profile incl. historyId for subsequent sync.
 */
export async function getProfile(): Promise<{ emailAddress: string; historyId: string; messagesTotal: number }> {
  const res = await gmailFetch('/profile')
  return res.json() as Promise<{ emailAddress: string; historyId: string; messagesTotal: number }>
}

export interface HistoryChange {
  threadId: string
}

/**
 * Incremental history sync. Returns the set of thread IDs that changed
 * since `startHistoryId`, plus the new historyId to persist.
 *
 * Gmail's history API can return a 404 if the historyId is too old (>= 1 week
 * since last poll), in which case the caller should fall back to a full
 * re-scan of tracked threads.
 */
export async function listHistory(startHistoryId: string): Promise<{
  threadIds: string[]
  newHistoryId: string
  needsFullSync: boolean
}> {
  try {
    const threadIds = new Set<string>()
    let pageToken: string | undefined = undefined
    let newHistoryId = startHistoryId
    do {
      const params = new URLSearchParams({
        startHistoryId,
        historyTypes: 'messageAdded',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const res = await gmailFetch(`/history?${params.toString()}`)
      const json = await res.json() as {
        history?: Array<{ messages?: Array<{ threadId: string }> }>
        nextPageToken?: string
        historyId?: string
      }
      for (const h of json.history ?? []) {
        for (const m of h.messages ?? []) threadIds.add(m.threadId)
      }
      if (json.historyId) newHistoryId = json.historyId
      pageToken = json.nextPageToken
    } while (pageToken)
    return { threadIds: Array.from(threadIds), newHistoryId, needsFullSync: false }
  } catch (err) {
    if (err instanceof GmailApiError && err.status === 404) {
      return { threadIds: [], newHistoryId: startHistoryId, needsFullSync: true }
    }
    throw err
  }
}
