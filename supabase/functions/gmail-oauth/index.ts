import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')!
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')!

  let body: { action?: string; code?: string; redirectUri?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // ── Exchange auth code for tokens (called once after Google consent screen) ─
  if (body.action === 'exchange') {
    if (!body.code || !body.redirectUri) {
      return json({ error: 'Missing code or redirectUri' }, 400)
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: body.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: body.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    const tokens = await tokenRes.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      error?: string
      error_description?: string
    }

    if (tokens.error || !tokens.access_token) {
      return json({ error: tokens.error_description ?? tokens.error ?? 'Token exchange failed' }, 400)
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const userInfo = await userRes.json() as { email?: string }

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
    const { error: dbError } = await supabase.from('gmail_credentials').upsert({
      id: 1,
      email: userInfo.email ?? null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      scope: tokens.scope ?? null,
      expires_at: expiresAt,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

    if (dbError) return json({ error: `DB write failed: ${dbError.message}` }, 500)
    return json({ success: true })
  }

  // ── Refresh an expired access token using the stored refresh token ──────────
  if (body.action === 'refresh') {
    const { data: creds, error: fetchError } = await supabase
      .from('gmail_credentials')
      .select('refresh_token')
      .eq('id', 1)
      .single()

    if (fetchError || !creds?.refresh_token) {
      return json({ error: 'No refresh token stored — user must reconnect' }, 400)
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: creds.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }).toString(),
    })
    const tokens = await tokenRes.json() as {
      access_token?: string
      expires_in?: number
      error?: string
      error_description?: string
    }

    if (tokens.error || !tokens.access_token) {
      return json({ error: tokens.error_description ?? tokens.error ?? 'Refresh failed' }, 400)
    }

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
    await supabase.from('gmail_credentials').update({
      access_token: tokens.access_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).eq('id', 1)

    return json({ access_token: tokens.access_token, expires_at: expiresAt })
  }

  return json({ error: 'Unknown action' }, 400)
})
