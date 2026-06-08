# Gmail OAuth Refactor — What Changed & Manual Setup Steps

## What Changed and Why

### The Problem (Before)

The app used Google's **implicit token grant** via the GIS library (`google.accounts.oauth2`). This flow:

- Only ever returned a short-lived **access token** (1-hour TTL)
- Tried to silently refresh by opening a hidden iframe to Google — this broke whenever third-party cookies were blocked (Chrome, Safari, Firefox all increasingly block them)
- Had a `refresh_token` column in the database that was **never populated**
- Result: every hour the token would expire, silent refresh would fail, and the app would stop syncing Gmail with no clear error

### The Fix (After)

Switched to the **Authorization Code flow**, which is the proper server-side OAuth pattern:

1. **"Connect Gmail"** opens a popup to Google's real consent screen (not the GIS library)
2. Google redirects the popup to `/auth/gmail/callback` with a short-lived `code`
3. The callback page sends that code to a **Supabase Edge Function** (`gmail-oauth`)
4. The edge function (which has the `GOOGLE_CLIENT_SECRET`) exchanges the code for both an `access_token` **and a `refresh_token`** and stores both in the database
5. When the access token expires, `getAccessToken()` calls the edge function's `refresh` action — which uses the stored `refresh_token` to get a new access token **server-side, with no browser popup or cookies required**

The refresh token is permanent (until the user revokes app access in their Google account). You will never see "Gmail authorization expired" again unless you explicitly disconnect and reconnect.

---

## Files Changed

| File | What Happened |
|---|---|
| `supabase/functions/gmail-oauth/index.ts` | **New.** Edge function — handles code exchange and token refresh |
| `src/lib/gmail/oauth.ts` | **Rewritten.** Removed GIS library; added popup OAuth flow and edge-function-backed refresh |
| `src/pages/GmailCallback.tsx` | **New.** Page rendered in the OAuth popup; exchanges code and closes |
| `src/App.tsx` | Added `/auth/gmail/callback` route outside the Layout |
| `src/main.tsx` | Bypass password gate for the callback URL |
| `src/pages/Settings.tsx` | Minor text updates |
| `src/lib/gmail/sync.ts` | Removed stale "ignored threads" skip (separate bug fix) |
| `src/pages/Home.tsx` | Added reconnect banner |

---

## Manual Steps Required

### Step 1 — Get Your Google Client Secret

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click on your OAuth 2.0 Client ID (`202609590431-ke3b9qnj5s8fkjgpurf389fl6677qrhn`)
3. Copy the **Client secret** (it looks like `GOCSPX-...`)

### Step 2 — Add the Callback URL to Google Cloud Console

Still in the OAuth client settings:

1. Under **Authorized redirect URIs**, click **Add URI**
2. Add: `http://localhost:5173/auth/gmail/callback`
3. If you ever deploy to production, also add: `https://your-production-domain.com/auth/gmail/callback`
4. Click **Save**

> **This step is critical.** Google will reject the OAuth flow with `redirect_uri_mismatch` if this URL isn't registered.

### Step 3 — Install the Supabase CLI (if not already installed)

```bash
brew install supabase/tap/supabase
```

Or see [Supabase CLI docs](https://supabase.com/docs/guides/cli).

### Step 4 — Link Your Project

```bash
supabase login
supabase link --project-ref aebhhantiqfvnmukqjeu
```

### Step 5 — Set the Secrets on Supabase

```bash
supabase secrets set GOOGLE_CLIENT_ID=202609590431-ke3b9qnj5s8fkjgpurf389fl6677qrhn.apps.googleusercontent.com
supabase secrets set GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET_FROM_STEP_1
```

### Step 6 — Deploy the Edge Function

```bash
supabase functions deploy gmail-oauth
```

You should see output like:
```
Deployed Function gmail-oauth (version: 1)
```

### Step 7 — Reconnect Gmail in the App

1. Open the app at `http://localhost:5173`
2. Go to **Settings**
3. If Gmail shows as connected (with the old token), click **Disconnect** first
4. Click **Connect Gmail**
5. A popup will open — sign in with your Google account and click **Allow**
6. The popup closes automatically and the status updates to **Connected**

The app will now auto-refresh tokens silently forever without any popups.

---

## Troubleshooting

**"Popup was blocked"** — Allow popups for `localhost:5173` in your browser settings (Chrome: click the blocked popup icon in the address bar → Always allow).

**"redirect_uri_mismatch"** — You haven't added `http://localhost:5173/auth/gmail/callback` to the Authorized Redirect URIs in Google Cloud Console (Step 2).

**Edge function 500 errors** — Run `supabase functions logs gmail-oauth` to see the server-side error. Most likely the secrets weren't set (Step 5).

**Token exchange fails with "invalid_grant"** — The auth code was already used or expired (they expire in ~10 minutes). Click Connect Gmail again to get a fresh code.
