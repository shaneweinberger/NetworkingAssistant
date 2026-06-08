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

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'

// Treat tokens as expired this many ms before their stated expiry so we
// always refresh slightly early and avoid mid-request expirations.
const TOKEN_REFRESH_BUFFER_MS = 60_000

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            prompt?: 'consent' | 'select_account' | 'none' | ''
            callback: (response: TokenResponse) => void
            error_callback?: (error: { type: string; message?: string }) => void
          }) => TokenClient
          revoke: (accessToken: string, callback?: () => void) => void
        }
      }
    }
  }
}

interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: 'Bearer'
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: 'consent' | 'select_account' | 'none' | '' }) => void
}

let scriptPromise: Promise<void> | null = null

// In-memory token cache. Avoids re-hitting the DB (and potentially the popup
// refresh path) on every Gmail API call within a single page session.
let cachedToken: { token: string; expiresAtMs: number } | null = null

// Coalesces concurrent refresh requests so we never open more than one silent
// OAuth popup at a time, even if many gmailFetch calls fire in parallel.
let inFlightRefresh: Promise<string | null> | null = null

// Once silent refresh fails (e.g. user signed out of Google, scope changed,
// third-party cookies blocked), don't keep retrying it on every background
// sync — that's what causes the popup to flash repeatedly. Cleared when the
// user manually reconnects via connectGmail() or clears credentials.
let silentRefreshBlocked = false

function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('not in browser'))
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')))
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(script)
  })

  return scriptPromise
}

function getClientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  if (!id) {
    throw new Error(
      'Missing VITE_GOOGLE_CLIENT_ID in .env.local. ' +
      'Create an OAuth 2.0 Web client in Google Cloud Console and add it to your env file.',
    )
  }
  return id
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

async function saveCredentials(patch: Partial<GmailCredentials>): Promise<void> {
  const row = { id: 1, ...patch, updated_at: new Date().toISOString() }
  const { error } = await supabase
    .from('gmail_credentials')
    .upsert(row, { onConflict: 'id' })
  if (error) console.warn('Failed to save Gmail credentials:', error.message)
}

export async function clearCredentials(): Promise<void> {
  const creds = await loadCredentials()
  if (creds?.access_token && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(creds.access_token)
    } catch {
      // best-effort
    }
  }
  await supabase.from('gmail_credentials').delete().eq('id', 1)
  cachedToken = null
  silentRefreshBlocked = false
  inFlightRefresh = null
}

async function fetchUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const json = await res.json() as { email?: string }
    return json.email ?? null
  } catch {
    return null
  }
}

/**
 * Triggers the Google sign-in popup. `prompt: 'consent'` ensures the user
 * sees the scope screen on first connect; passing 'none' lets us silently
 * refresh expired tokens when the user is still signed into Google.
 */
async function requestToken(prompt: 'consent' | 'none'): Promise<TokenResponse> {
  await loadGisScript()
  const clientId = getClientId()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPES,
      callback: (response) => {
        if (response.error) reject(new Error(response.error_description || response.error))
        else resolve(response)
      },
      error_callback: (err) => reject(new Error(err.message || err.type || 'OAuth error')),
    })
    client.requestAccessToken({ prompt })
  })
}

export async function connectGmail(): Promise<GmailCredentials> {
  const response = await requestToken('consent')
  const email = await fetchUserEmail(response.access_token)
  const expiresAtMs = Date.now() + response.expires_in * 1000
  const expiresAt = new Date(expiresAtMs).toISOString()
  await saveCredentials({
    email,
    access_token: response.access_token,
    scope: response.scope,
    expires_at: expiresAt,
    connected_at: new Date().toISOString(),
  })
  cachedToken = { token: response.access_token, expiresAtMs }
  silentRefreshBlocked = false
  inFlightRefresh = null
  const creds = await loadCredentials()
  if (!creds) throw new Error('Failed to persist Gmail credentials')
  return creds
}

function isExpired(creds: GmailCredentials): boolean {
  if (!creds.expires_at) return true
  return new Date(creds.expires_at).getTime() - TOKEN_REFRESH_BUFFER_MS < Date.now()
}

/**
 * Returns a usable access token, refreshing silently if needed.
 * Returns null if the user has never connected, or if silent refresh fails
 * (in which case the caller should prompt the user to reconnect).
 */
export async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cachedToken.token
  }

  const creds = await loadCredentials()
  if (!creds || !creds.access_token) return null
  if (!isExpired(creds)) {
    const expiresAtMs = creds.expires_at ? new Date(creds.expires_at).getTime() : 0
    cachedToken = { token: creds.access_token, expiresAtMs }
    return creds.access_token
  }

  // Silent refresh previously failed — don't keep popping up the OAuth window
  // on every poll. The user must reconnect explicitly to clear this.
  if (silentRefreshBlocked) return null

  if (inFlightRefresh) return inFlightRefresh

  inFlightRefresh = (async () => {
    try {
      const response = await requestToken('none')
      const expiresAtMs = Date.now() + response.expires_in * 1000
      const expiresAt = new Date(expiresAtMs).toISOString()
      await saveCredentials({
        access_token: response.access_token,
        scope: response.scope,
        expires_at: expiresAt,
      })
      cachedToken = { token: response.access_token, expiresAtMs }
      return response.access_token
    } catch (err) {
      console.warn('Silent Gmail token refresh failed; user must reconnect.', err)
      silentRefreshBlocked = true
      return null
    } finally {
      inFlightRefresh = null
    }
  })()

  return inFlightRefresh
}

export function tokenStatus(creds: GmailCredentials | null): 'disconnected' | 'connected' | 'expired' {
  if (!creds || !creds.access_token) return 'disconnected'
  if (isExpired(creds)) return 'expired'
  return 'connected'
}
