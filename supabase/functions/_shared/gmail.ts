// Server-side Gmail API helpers.
// These run inside Edge Functions, with credentials read from gmail_credentials.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TOKEN_REFRESH_BUFFER_MS = 60_000

export interface GmailCredsRow {
  id: number
  email: string | null
  access_token: string | null
  refresh_token: string | null
  scope: string | null
  expires_at: string | null
  last_history_id: string | null
  assistant_start_history_id: string | null
  digest_recipient: string | null
  digest_timezone: string | null
}

export class GmailAuthError extends Error {
  constructor(msg = 'Gmail auth failed') {
    super(msg)
    this.name = 'GmailAuthError'
  }
}

export async function loadCreds(db: SupabaseClient): Promise<GmailCredsRow | null> {
  const { data, error } = await db.from('gmail_credentials').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error('Failed to load gmail_credentials: ' + error.message)
  return (data as GmailCredsRow | null) ?? null
}

function isExpired(creds: GmailCredsRow): boolean {
  if (!creds.expires_at) return true
  return new Date(creds.expires_at).getTime() - TOKEN_REFRESH_BUFFER_MS < Date.now()
}

async function refreshAccessToken(creds: GmailCredsRow, db: SupabaseClient): Promise<string> {
  if (!creds.refresh_token) {
    throw new GmailAuthError('No refresh_token stored. Reconnect Gmail with offline access.')
  }
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new GmailAuthError('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET env vars')
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: creds.refresh_token,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new GmailAuthError(`Token refresh failed: ${res.status} ${text}`)
  }
  const json = await res.json() as { access_token: string; expires_in: number; scope?: string }
  const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString()
  await db.from('gmail_credentials').update({
    access_token: json.access_token,
    expires_at: expiresAt,
    scope: json.scope ?? creds.scope,
    updated_at: new Date().toISOString(),
  }).eq('id', 1)
  return json.access_token
}

export async function getAccessToken(creds: GmailCredsRow, db: SupabaseClient): Promise<string> {
  if (creds.access_token && !isExpired(creds)) return creds.access_token
  return await refreshAccessToken(creds, db)
}

async function gmail(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(`${GMAIL_API}${path}`, { ...init, headers })
  if (res.status === 401 || res.status === 403) {
    const body = await res.text()
    throw new GmailAuthError(`Gmail ${res.status}: ${body.slice(0, 200)}`)
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gmail API ${res.status}: ${body.slice(0, 200)}`)
  }
  return res
}

export async function getProfile(token: string): Promise<{ emailAddress: string; historyId: string }> {
  const res = await gmail('/profile', token)
  return res.json()
}

export interface ListedHistoryEvent {
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>
}

export async function listHistory(token: string, startHistoryId: string): Promise<{
  messageIds: string[]
  newHistoryId: string
  needsFullSync: boolean
}> {
  try {
    const messageIds = new Set<string>()
    let pageToken: string | undefined
    let newHistoryId = startHistoryId
    do {
      const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded' })
      if (pageToken) params.set('pageToken', pageToken)
      const res = await gmail(`/history?${params.toString()}`, token)
      const json = await res.json() as {
        history?: ListedHistoryEvent[]
        nextPageToken?: string
        historyId?: string
      }
      for (const h of json.history ?? []) {
        for (const m of h.messagesAdded ?? []) {
          messageIds.add(m.message.id)
        }
      }
      if (json.historyId) newHistoryId = json.historyId
      pageToken = json.nextPageToken
    } while (pageToken)
    return { messageIds: Array.from(messageIds), newHistoryId, needsFullSync: false }
  } catch (err) {
    const msg = (err as Error).message
    // 404 from history.list = cursor is too old, caller should restart from getProfile().historyId
    if (msg.includes('404')) {
      return { messageIds: [], newHistoryId: startHistoryId, needsFullSync: true }
    }
    throw err
  }
}

export interface FullMessage {
  id: string
  threadId: string
  internalDate: string
  labelIds: string[]
  from: string | null
  to: string | null
  cc: string | null
  subject: string | null
  snippet: string
  bodyText: string
}

function header(headers: Array<{ name: string; value: string }> | undefined, name: string): string | null {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null
}

function base64UrlDecode(input: string): string {
  const fixed = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = fixed + '='.repeat((4 - fixed.length % 4) % 4)
  try {
    const bin = atob(padded)
    // Convert binary to UTF-8 string
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

interface MimePart {
  mimeType?: string
  body?: { data?: string }
  parts?: MimePart[]
}

function extractText(part: MimePart): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return base64UrlDecode(part.body.data)
  }
  if (part.parts) {
    // Prefer text/plain; fall back to first part text we find
    const plain = part.parts.find((p) => p.mimeType === 'text/plain')
    if (plain) return extractText(plain)
    for (const sub of part.parts) {
      const t = extractText(sub)
      if (t) return t
    }
  }
  // Fallback: strip HTML if we only have html
  if (part.mimeType === 'text/html' && part.body?.data) {
    const html = base64UrlDecode(part.body.data)
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  return ''
}

export async function getMessage(token: string, messageId: string): Promise<FullMessage | null> {
  try {
    const res = await gmail(`/messages/${messageId}?format=full`, token)
    const json = await res.json() as {
      id: string
      threadId: string
      internalDate: string
      labelIds?: string[]
      snippet?: string
      payload?: {
        headers?: Array<{ name: string; value: string }>
        mimeType?: string
        body?: { data?: string }
        parts?: MimePart[]
      }
    }
    const headers = json.payload?.headers
    const bodyText = extractText(json.payload ?? {}).slice(0, 8000)
    return {
      id: json.id,
      threadId: json.threadId,
      internalDate: json.internalDate,
      labelIds: json.labelIds ?? [],
      from: header(headers, 'From'),
      to: header(headers, 'To'),
      cc: header(headers, 'Cc'),
      subject: header(headers, 'Subject'),
      snippet: json.snippet ?? '',
      bodyText,
    }
  } catch (err) {
    if ((err as Error).message.includes('404')) return null
    throw err
  }
}

export function parseEmailAddress(value: string | null): { email: string | null; name: string | null } {
  if (!value) return { email: null, name: null }
  const angle = value.match(/^(.*)<([^>]+)>\s*$/)
  if (angle) {
    return { name: angle[1].trim().replace(/^"|"$/g, '') || null, email: angle[2].trim().toLowerCase() }
  }
  const plain = value.trim().toLowerCase()
  if (plain.includes('@')) return { email: plain, name: null }
  return { email: null, name: value }
}

export function parseEmailList(value: string | null): string[] {
  if (!value) return []
  // crude split on commas not inside angle brackets
  const parts = value.split(/,(?![^<]*>)/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    const { email } = parseEmailAddress(p)
    if (email) out.push(email)
  }
  return out
}

export async function sendRawMessage(token: string, args: {
  to: string
  subject: string
  htmlBody: string
  fromEmail?: string
}): Promise<{ id: string; threadId: string }> {
  // Build a multipart/alternative with HTML so digest renders nicely.
  const boundary = `donna_${crypto.randomUUID().replace(/-/g, '')}`
  const lines = [
    `To: ${args.to}`,
    args.fromEmail ? `From: ${args.fromEmail}` : null,
    `Subject: ${args.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    args.htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    args.htmlBody,
    '',
    `--${boundary}--`,
  ].filter((x): x is string => x != null)
  const raw = lines.join('\r\n')
  const utf8 = new TextEncoder().encode(raw)
  let binary = ''
  utf8.forEach((b) => { binary += String.fromCharCode(b) })
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const res = await gmail('/messages/send', token, {
    method: 'POST',
    body: JSON.stringify({ raw: b64 }),
  })
  return res.json()
}
