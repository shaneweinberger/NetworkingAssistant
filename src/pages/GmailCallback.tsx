import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Rendered inside the OAuth popup window after Google redirects back.
 * Sends the auth code to the edge function, then notifies the opener and closes.
 */
export default function GmailCallback() {
  const [searchParams] = useSearchParams()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true

    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error || !code) {
      window.opener?.postMessage(
        { type: 'gmail-oauth-error', error: error ?? 'No authorization code received' },
        window.location.origin,
      )
      window.close()
      return
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
    const redirectUri = `${window.location.origin}/auth/gmail/callback`

    fetch(`${supabaseUrl}/functions/v1/gmail-oauth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ action: 'exchange', code, redirectUri }),
    })
      .then(r => r.json())
      .then((data: { error?: string }) => {
        if (data.error) {
          window.opener?.postMessage(
            { type: 'gmail-oauth-error', error: data.error },
            window.location.origin,
          )
        } else {
          window.opener?.postMessage({ type: 'gmail-oauth-success' }, window.location.origin)
        }
        window.close()
      })
      .catch(err => {
        window.opener?.postMessage(
          { type: 'gmail-oauth-error', error: (err as Error).message },
          window.location.origin,
        )
        window.close()
      })
  }, [])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
      color: '#666',
      fontSize: '14px',
    }}>
      Connecting Gmail…
    </div>
  )
}
