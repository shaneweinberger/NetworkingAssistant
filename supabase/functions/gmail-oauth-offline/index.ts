// Server-side OAuth flow that captures a refresh_token.
//
// Flow:
//   1. Browser hits /gmail-oauth-offline?action=start&return=<url>
//      -> we 302 to Google's consent page (access_type=offline, prompt=consent)
//   2. Google redirects user back to /gmail-oauth-offline?code=...&state=...
//      -> we exchange code for tokens, save them, then 302 to <return>
//
// The redirect_uri registered in Google Cloud Console must be exactly:
//   https://<project>.supabase.co/functions/v1/gmail-oauth-offline
import { makeServiceClient } from '../_shared/supabase.ts'
import { corsHeaders } from '../_shared/cors.ts'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

function selfUrl(): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  return `${supabaseUrl}/functions/v1/gmail-oauth-offline`
}

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;max-width:560px;margin:60px auto;padding:0 24px;color:#0a0a0a;line-height:1.5}h1{font-size:24px;font-weight:600;letter-spacing:-0.02em;margin-bottom:12px}p{color:#6b6b6b}a{color:#0a0a0a;font-weight:500}</style>
</head><body>${body}</body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders } },
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const code = url.searchParams.get('code')
  const errParam = url.searchParams.get('error')

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    return htmlPage('Donna - misconfigured', `<h1>Setup needed</h1><p>Missing <code>GOOGLE_CLIENT_ID</code> or <code>GOOGLE_CLIENT_SECRET</code> in Edge secrets.</p>`)
  }

  // --- Step 1: initiate consent ---------------------------------------------
  if (action === 'start') {
    const returnUrl = url.searchParams.get('return') || '/'
    const state = btoa(JSON.stringify({ returnUrl, ts: Date.now() }))
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: selfUrl(),
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent', // force refresh_token issuance even if previously granted
      state,
    })
    return Response.redirect(`${AUTH_URL}?${params.toString()}`, 302)
  }

  // --- Step 2: Google redirected back with either code or error -------------
  if (errParam) {
    return htmlPage('Connection failed', `<h1>Google said no</h1><p>${escapeHtml(errParam)}</p><p><a href="javascript:history.back()">Go back</a></p>`)
  }

  if (code) {
    let returnUrl = '/'
    try {
      const state = url.searchParams.get('state')
      if (state) {
        const decoded = JSON.parse(atob(state)) as { returnUrl?: string }
        if (decoded.returnUrl) returnUrl = decoded.returnUrl
      }
    } catch {
      // ignore
    }

    // Exchange code -> tokens
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: selfUrl(),
    })
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!tokenRes.ok) {
      const t = await tokenRes.text()
      return htmlPage('Token exchange failed', `<h1>Token exchange failed</h1><pre>${escapeHtml(t.slice(0, 800))}</pre>`)
    }
    const tokens = await tokenRes.json() as {
      access_token: string
      refresh_token?: string
      expires_in: number
      scope: string
      token_type: string
    }

    // Get user email + bootstrap historyId
    const userinfoRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const userinfo = userinfoRes.ok ? await userinfoRes.json() : {}
    const email = (userinfo as { email?: string }).email ?? null

    const profileRes = await fetch(PROFILE_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = profileRes.ok ? await profileRes.json() : {}
    const historyId = (profile as { historyId?: string }).historyId ?? null

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    const db = makeServiceClient()
    const existing = await db.from('gmail_credentials').select('refresh_token, assistant_start_history_id').eq('id', 1).maybeSingle()
    const keepRefresh = existing.data?.refresh_token
    const keepStartHistory = existing.data?.assistant_start_history_id

    await db.from('gmail_credentials').upsert({
      id: 1,
      email,
      access_token: tokens.access_token,
      // Google only issues refresh_token on first consent unless prompt=consent forces it.
      // We force it above, but be defensive: preserve any existing token if Google omits one.
      refresh_token: tokens.refresh_token ?? keepRefresh ?? null,
      scope: tokens.scope,
      expires_at: expiresAt,
      last_history_id: historyId,
      assistant_start_history_id: keepStartHistory ?? historyId,
      assistant_started_at: new Date().toISOString(),
      digest_recipient: email,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
      last_error_at: null,
    }, { onConflict: 'id' })

    const safeReturn = returnUrl.startsWith('http') ? returnUrl : '/'
    return htmlPage('Donna connected', `<h1>Donna is connected</h1><p>Refresh token captured. You can close this tab and return to the app.</p><p><a href="${escapeHtml(safeReturn)}">Back to Settings &rarr;</a></p>`)
  }

  // Default landing
  return htmlPage('Donna OAuth', `<h1>Donna OAuth endpoint</h1><p>This is the callback URL. Open <code>/settings</code> in the app and click "Reconnect Gmail (with Donna)" to start the flow.</p>`)
})

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
