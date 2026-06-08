import { supabase } from '../supabase'
import type { GmailCredentials } from '../../types/database'

// Scopes:
// - gmail.compose: create drafts and send mail
// - gmail.readonly: list threads/messages, history sync (reply detection)
// - userinfo.email: identify which Gmail account is connected
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

// Treat tokens as expired this many ms before their stated expiry so we
// always refresh slightly early and avoid mid-request expirations.
const TOKEN_REFRESH_BUFFER_MS = 60_000

// In-memory token cache so we don't hit the DB or edge function on every call.
let cachedToken: { token: string; expiresAtMs: number } | null = null

// Coalesces concurrent refresh requests so we never fire more than one.
let inFlightRefresh: Promise<string | null> | null = null

function getClientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  if (!id) throw new Error('Missing VITE_GOOGLE_CLIENT_ID in .env.local')
  return id
}

function getEdgeFunctionUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string
  return `${url}/functions/v1/gmail-oauth`
}

function getAnonKey(): string {
  return import.meta.env.VITE_SUPABASE_ANON_KEY as string
}

async function callEdgeFunction(body: object): Promise<{ error?: string; [key: string]: unknown }> {
  const res = await fetch(getEdgeFunctionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getAnonKey()}`,
    },
    body: JSON.stringify(body),
  })
  return res.json() as Promise<{ error?: string; [key: string]: unknown }>
}

export function isGmailConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
}

export async function loadCredentials(): Promise<GmailCredentials | null> {
  const { data, error } = await supabase
    .from('gmail_credentials')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    console.warn('Failed to load Gmail credentials:', error.message)
    return null
  }
  return (data as GmailCredentials | null) ?? null
}

export async function clearCredentials(): Promise<void> {
  const creds = await loadCredentials()
  // Best-effort token revocation so Google removes our access.
  if (creds?.access_token) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(creds.access_token)}`, {
      method: 'POST',
    }).catch(() => { /* best-effort */ })
  }
  await supabase.from('gmail_credentials').delete().eq('id', 1)
  cachedToken = null
  inFlightRefresh = null
}

function isExpired(creds: GmailCredentials): boolean {
  if (!creds.expires_at) return true
  return new Date(creds.expires_at).getTime() - TOKEN_REFRESH_BUFFER_MS < Date.now()
}

/**
 * Opens a popup to Google's OAuth consent screen (Authorization Code flow).
 * The popup redirects to /auth/gmail/callback which calls the edge function to
 * exchange the code for tokens (including a refresh_token) and stores them.
 * Returns the updated credentials row.
 */
export async function connectGmail(): Promise<GmailCredentials> {
  const redirectUri = `${window.location.origin}/auth/gmail/callback`

  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',   // required to receive a refresh_token
    prompt: 'consent',        // always show consent so refresh_token is always returned
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

  return new Promise((resolve, reject) => {
    const popup = window.open(authUrl, 'gmail-oauth', 'width=520,height=640,popup=yes')
    if (!popup) {
      reject(new Error('Popup was blocked. Allow popups for this site and try again.'))
      return
    }

    let settled = false

    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'gmail-oauth-success' && event.data?.type !== 'gmail-oauth-error') return
      if (settled) return
      settled = true
      cleanup()

      if (event.data.type === 'gmail-oauth-error') {
        reject(new Error(event.data.error ?? 'OAuth failed'))
      } else {
        loadCredentials().then(creds => {
          if (creds) {
            cachedToken = null // clear stale cache so next call re-reads from DB
            resolve(creds)
          } else {
            reject(new Error('Credentials not found after OAuth'))
          }
        }).catch(reject)
      }
    }

    // Detect user closing the popup without completing the flow.
    const pollTimer = setInterval(() => {
      if (popup.closed && !settled) {
        settled = true
        cleanup()
        reject(new Error('Sign-in was cancelled'))
      }
    }, 500)

    function cleanup() {
      clearInterval(pollTimer)
      window.removeEventListener('message', messageHandler)
    }

    window.addEventListener('message', messageHandler)
  })
}

/**
 * Returns a valid access token, refreshing via the edge function if needed.
 * Returns null only if there are no credentials or the refresh_token is gone
 * (user must reconnect in that case).
 */
export async function getAccessToken(): Promise<string | null> {
  // Fast path: in-memory cache still valid.
  if (cachedToken && cachedToken.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cachedToken.token
  }

  const creds = await loadCredentials()
  if (!creds?.access_token) return null

  // DB token still valid — cache and return it.
  if (!isExpired(creds)) {
    const expiresAtMs = creds.expires_at ? new Date(creds.expires_at).getTime() : 0
    cachedToken = { token: creds.access_token, expiresAtMs }
    return creds.access_token
  }

  // No refresh token — cannot renew, user must reconnect.
  if (!creds.refresh_token) return null

  // Coalesce concurrent refresh attempts.
  if (inFlightRefresh) return inFlightRefresh

  inFlightRefresh = (async () => {
    try {
      const data = await callEdgeFunction({ action: 'refresh' })
      if (data.error || !data.access_token) {
        console.warn('Gmail token refresh failed:', data.error)
        return null
      }
      const expiresAtMs = new Date(data.expires_at as string).getTime()
      cachedToken = { token: data.access_token as string, expiresAtMs }
      return data.access_token as string
    } catch (err) {
      console.warn('Gmail token refresh request failed:', err)
      return null
    } finally {
      inFlightRefresh = null
    }
  })()

  return inFlightRefresh
}

export function tokenStatus(creds: GmailCredentials | null): 'disconnected' | 'connected' | 'expired' {
  if (!creds?.access_token) return 'disconnected'
  // If the token is expired but we have a refresh_token, we can auto-renew —
  // show as connected so the user isn't alarmed.
  if (isExpired(creds) && !creds.refresh_token) return 'expired'
  return 'connected'
}
